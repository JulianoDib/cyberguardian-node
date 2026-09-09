/**
 * WORKER — consumidor independente da fila de alertas (R3) + relogio de
 * Lamport (R4).
 *
 * Sobem 3 processos identicos, diferindo apenas pelo numero de identificacao.
 * Todos declaram o MESMO groupId, entao o Kafka reparte as 3 particoes entre
 * eles: cada mensagem e processada por exatamente um worker (Competing
 * Consumers). Os workers nao conversam entre si.
 *
 * RELOGIO DE LAMPORT (R4): cada worker tem o SEU relogio, independente dos
 * demais. Dois eventos por mensagem:
 *
 *   1. RECEBE-FILA : L = max(L_local, L_mensagem) + 1   <- a regra 3
 *   2. PROCESSA    : L = L + 1                          <- evento interno
 *
 * NAO incrementa: `commitOffsets`. E escrituracao de infraestrutura do Kafka,
 * nao evento de dominio — se contasse, o relogio passaria a medir mecanica de
 * biblioteca em vez de causalidade.
 *
 * Uso:  npm run build && npm run worker -- 1
 *       (em outros terminais: npm run worker -- 2 / npm run worker -- 3)
 */

import type { Consumer } from "kafkajs";

import { RegistradorAuditoria } from "../compartilhado/auditoria";
import { criarKafka, TOPICO_ALERTAS } from "../compartilhado/kafka";
import { ErroDeRelogio, RelogioLamport } from "../compartilhado/lamport";
import { ehEnvelopeAlerta } from "../compartilhado/tipos";
import { Bully } from "./bully";
import { RepositorioBloqueios } from "../compartilhado/repositorio";
import { Consolidador, EnviadorDeRecomendacoes } from "./consolidador";
import { AvaliadorDeBloqueio } from "./regra-bloqueio";

/**
 * Grupo de consumidores compartilhado pelos 3 workers.
 *
 * E o valor deste campo que faz o Kafka DIVIDIR o trabalho. Se cada worker
 * usasse um groupId diferente, todos receberiam TODAS as mensagens — seria
 * broadcast, e cada alerta seria processado tres vezes.
 */
const GRUPO_WORKERS = "workers-nids";

/**
 * INSTRUMENTACAO DE DEMONSTRACAO (R6) — desligada por padrao.
 *
 * Insere uma espera ENTRE processar e confirmar o offset. Serve para uma coisa
 * so: tornar demonstravel a garantia de "nao perder mensagem".
 *
 * Por que e necessaria: o codigo normal confirma o offset na linha seguinte ao
 * processamento, entao a janela em que uma mensagem esta "processada mas nao
 * confirmada" dura MICROSSEGUNDOS. Isso e bom em producao, mas impossivel de
 * acertar matando o processo na mao.
 *
 * Por que nao e trapaca: (a) sem a variavel de ambiente, o comportamento e
 * exatamente o de producao; (b) a espera SIMULA uma operacao lenta entre
 * processar e confirmar — que e literalmente o que a Etapa 7 vai inserir aqui
 * (gravacao em banco). Nao e um atraso fantasioso, e o futuro deste trecho.
 *
 * Uso:  ATRASO_COMMIT_MS=3000 npm run worker -- 3
 */
const ATRASO_COMMIT_MS: number = (() => {
  const bruto = Number.parseInt(process.env["ATRASO_COMMIT_MS"] ?? "0", 10);
  return Number.isInteger(bruto) && bruto > 0 ? bruto : 0;
})();

function esperar(ms: number): Promise<void> {
  return new Promise<void>((resolver) => {
    setTimeout(resolver, ms);
  });
}

function criarLog(nome: string): (mensagem: string) => void {
  return (mensagem: string): void => {
    console.log(`[${nome}] ${mensagem}`);
  };
}

/**
 * Confirma manualmente o processamento de uma mensagem (ACK MANUAL — R3/R6).
 *
 * ATENCAO ao `+ 1`: o Kafka guarda o offset da PROXIMA mensagem a ser lida, e
 * nao o da ultima processada. Commitar `message.offset` faria o worker reler a
 * mesma mensagem indefinidamente.
 *
 * `BigInt` porque offsets do Kafka sao inteiros de 64 bits e podem, em tese,
 * passar do maior inteiro seguro do JavaScript.
 */
async function confirmarOffset(
  consumidor: Consumer,
  topico: string,
  particao: number,
  offsetProcessado: string
): Promise<void> {
  const proximo: string = (BigInt(offsetProcessado) + 1n).toString();
  await consumidor.commitOffsets([
    { topic: topico, partition: particao, offset: proximo },
  ]);
}

async function principal(): Promise<void> {
  const identificador: string | undefined = process.argv[2];
  if (identificador === undefined || identificador.trim() === "") {
    throw new Error("informe o numero do worker. Ex.: npm run worker -- 1");
  }

  const meuId: number = Number.parseInt(identificador, 10);
  if (!Number.isInteger(meuId) || meuId < 1) {
    throw new Error(`id de worker invalido: "${identificador}". Use 1, 2 ou 3.`);
  }

  const nome = `worker-${meuId}`;
  const log = criarLog(nome);

  const kafka = criarKafka(nome);

  /**
   * ACK MANUAL: `autoCommit: false` e passado no `run()` mais abaixo.
   *
   * Com a confirmacao automatica (o padrao), a biblioteca salva o offset de
   * tempos em tempos, em segundo plano, SEM saber se o processamento terminou.
   * Se o worker morresse nessa janela, o Kafka consideraria a mensagem lida e
   * NUNCA mais a entregaria: perda silenciosa.
   */
  const consumidor: Consumer = kafka.consumer({ groupId: GRUPO_WORKERS });

  /** Estado local deste worker (ver a secao critica em regra-bloqueio.ts). */
  const avaliador = new AvaliadorDeBloqueio();

  /** Relogio logico DESTE worker. Comeca em 0, independente dos outros. */
  const relogio = new RelogioLamport();
  const auditoria = new RegistradorAuditoria(nome);

  /**
   * ELEICAO DE LIDER (R5).
   *
   * Convive com o consumo do Kafka no MESMO processo: ambos sao I/O assincrono
   * sobre o mesmo event loop, entao os heartbeats continuam fluindo enquanto o
   * `eachMessage` espera o commit.
   *
   * Risco a declarar: se o processamento fizesse trabalho SINCRONO pesado, ele
   * bloquearia o event loop e atrasaria os heartbeats — gerando falso positivo
   * de lider morto. No nosso caso o processamento e uma operacao de Map mais um
   * append pequeno, na casa dos microssegundos. E por isso que a margem do
   * timeout de sondagem e folgada (500 ms para uma latencia real de < 5 ms).
   */
  const bully = new Bully(meuId, relogio, auditoria, log);

  /**
   * CONSOLIDACAO (R5) — as duas metades do fluxo.
   *
   * `consolidador` so trabalha quando ESTE no e o lider; `enviador` manda as
   * recomendacoes ao lider (ou entrega localmente, se o lider for eu mesmo).
   */
  /**
   * PERSISTENCIA (Etapa 7). Usada apenas pelo consolidador — ou seja, so tem
   * efeito quando ESTE worker e o lider.
   */
  const repositorio = new RepositorioBloqueios(log);

  const consolidador = new Consolidador(meuId, relogio, auditoria, log, repositorio);
  const enviador = new EnviadorDeRecomendacoes(
    meuId,
    bully,
    consolidador,
    relogio,
    auditoria,
    log
  );

  bully.observar({
    aoReceberRecomendacao: (recomendacao) => {
      consolidador.receber(recomendacao);
    },
    aoMudarPapel: (souLider) => {
      // Assumiu a lideranca -> passa a fechar lotes. Deixou -> para na hora.
      if (souLider) {
        void consolidador.iniciar();
      } else {
        consolidador.parar();
      }
      // Recomendacoes acumuladas durante a eleicao saem agora que ha lider.
      void enviador.despachar();
    },
  });

  let processadas = 0;
  let bloqueios = 0;

  // Evidencia do Competing Consumers (R3): quais particoes o Kafka atribuiu a
  // ESTE worker. Subindo os 3, as particoes 0, 1 e 2 se dividem.
  consumidor.on(consumidor.events.GROUP_JOIN, (evento) => {
    const atribuidas: number[] = evento.payload.memberAssignment[TOPICO_ALERTAS] ?? [];
    log(`>>> GRUPO "${GRUPO_WORKERS}" | particoes atribuidas: [${atribuidas.join(", ")}]`);
  });

  consumidor.on(consumidor.events.REBALANCING, () => {
    log(">>> rebalanceamento em andamento (algum worker entrou ou saiu do grupo)");
  });

  try {
    await repositorio.verificarConexao();
  } catch (erro: unknown) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    log(`BANCO  AVISO: nao consegui falar com o banco agora (${detalhe}).`);
    log("BANCO  o worker segue; a persistencia so e usada se este no virar lider.");
  }

  log("conectando ao Kafka...");
  await consumidor.connect();
  await consumidor.subscribe({ topic: TOPICO_ALERTAS, fromBeginning: true });
  log(`auditoria em ${auditoria.arquivo} | relogio de Lamport iniciado em L=${relogio.valor}`);
  log(`inscrito em "${TOPICO_ALERTAS}" | aguardando atribuicao de particoes...`);
  if (ATRASO_COMMIT_MS > 0) {
    log(
      `>>> [DEMO] ATRASO_COMMIT_MS=${ATRASO_COMMIT_MS} ATIVO — janela artificial entre ` +
        `processar e confirmar o offset. Isto NAO e o comportamento padrao.`
    );
  }

  // Eleicao ANTES de comecar a consumir: o log da eleicao sai limpo, sem se
  // misturar com o processamento de alertas.
  await bully.iniciar();

  await consumidor.run({
    // >>> ACK MANUAL <<<
    autoCommit: false,

    eachMessage: async ({ topic, partition, message }) => {
      const posicao = `p${partition} off=${message.offset}`;

      // ---------------------------------------------------------------
      // ERROS PERMANENTES: reprocessar nao adianta.
      // Confirmamos assim mesmo, senao a mensagem TRAVA A PARTICAO — nenhuma
      // mensagem depois dela avancaria, em laco infinito de reentrega.
      // ---------------------------------------------------------------
      const bruto: string | undefined = message.value?.toString();

      if (bruto === undefined) {
        log(`${posicao} | DESCARTADA: mensagem sem conteudo`);
        await confirmarOffset(consumidor, topic, partition, message.offset);
        return;
      }

      let valor: unknown;
      try {
        valor = JSON.parse(bruto);
      } catch {
        log(`${posicao} | DESCARTADA: JSON invalido`);
        await confirmarOffset(consumidor, topic, partition, message.offset);
        return;
      }

      if (!ehEnvelopeAlerta(valor)) {
        log(`${posicao} | DESCARTADA: envelope fora do contrato`);
        await confirmarOffset(consumidor, topic, partition, message.offset);
        return;
      }

      // ---------------------------------------------------------------
      // LAMPORT, evento 1 — RECEPCAO (regra 3):
      //
      //     L = max(L_local, L_mensagem) + 1
      //
      // O `max` faz o relogio SALTAR se a mensagem vier de um processo que ja
      // viu mais eventos — e assim que a informacao causal se propaga. O `+1`
      // garante a desigualdade estrita em relacao ao envio.
      //
      // Guardamos o valor anterior ANTES de chamar, para o log poder exibir a
      // conta inteira e o avaliador conseguir conferir a regra na linha.
      // ---------------------------------------------------------------
      const lamportLocalAntes = relogio.valor;
      const lamportDaMensagem = valor.metadados.lamport;

      let lamportRecebe: number;
      try {
        lamportRecebe = relogio.aoReceber(lamportDaMensagem);
      } catch (erro: unknown) {
        // Carimbo invalido e problema PERMANENTE do dado: nao adianta reentregar.
        // (O validador de envelope ja deveria ter barrado; isto e a segunda
        // linha de defesa, para o relogio nunca ser contaminado.)
        const detalhe: string = erro instanceof ErroDeRelogio ? erro.message : String(erro);
        log(`${posicao} | DESCARTADA: ${detalhe}`);
        await confirmarOffset(consumidor, topic, partition, message.offset);
        return;
      }

      auditoria.registrar({
        lamport: lamportRecebe,
        tipo: "RECEBE-FILA",
        calculo: `max(local=${lamportLocalAntes}, msg=${lamportDaMensagem})+1 = ${lamportRecebe}`,
        detalhe: `${posicao} de ${valor.metadados.origemId}`,
        mensagemId: valor.id,
      });

      // ---------------------------------------------------------------
      // LAMPORT, evento 2 — PROCESSAMENTO (evento interno)
      // ---------------------------------------------------------------
      try {
        const lamportAntesDoProcessa = relogio.valor;
        const decisao = avaliador.avaliar(valor.payload, Date.now());
        const lamportProcessa = relogio.eventoInterno();

        processadas++;
        if (decisao.severidade === "BLOQUEAR") {
          bloqueios++;
        }

        auditoria.registrar({
          lamport: lamportProcessa,
          tipo: "PROCESSA",
          calculo: `interno: ${lamportAntesDoProcessa}+1 = ${lamportProcessa}`,
          detalhe:
            `${valor.payload.ipOrigem} ${valor.payload.pacotesPorSegundo} pac/s ` +
            `| ${decisao.severidade} | ${decisao.motivo}`,
          mensagemId: valor.id,
        });

        if (decisao.severidade === "BLOQUEAR") {
          // O worker apenas RECOMENDA. Quem consolida o lote e emite o comando
          // ao firewall e o LIDER — e so ele. Um worker que emitisse comando
          // por conta propria produziria as duplicatas que o tema proibe.
          log(`${posicao} | >>> RECOMENDA BLOQUEIO de ${valor.payload.ipOrigem} (id=${valor.id})`);

          // Falha ao entregar a recomendacao NAO impede a confirmacao do offset:
          // o alerta ja foi processado, e o enviador guarda a pendencia para
          // reenviar. Reprocessar a mensagem so geraria recomendacao duplicada.
          await enviador
            .enviar({
              alertaId: valor.id,
              ipOrigem: valor.payload.ipOrigem,
              sensorId: valor.payload.sensorId,
              pacotesPorSegundo: valor.payload.pacotesPorSegundo,
              detectadoPor: meuId,
              lamportDeteccao: lamportProcessa,
            })
            .catch((erro: unknown) => {
              log(`${posicao} | falha ao despachar recomendacao: ${String(erro)}`);
            });
        }
      } catch (erro: unknown) {
        // ERRO TRANSITORIO: NAO confirma o offset de proposito. A mensagem
        // continua pendente e sera reentregue numa proxima atribuicao desta
        // particao, em vez de se perder.
        const detalhe: string = erro instanceof Error ? erro.message : String(erro);
        log(`${posicao} | FALHA no processamento (offset NAO confirmado): ${detalhe}`);
        return;
      }

      // ---------------------------------------------------------------
      // Janela de demonstracao: a mensagem esta PROCESSADA e NAO CONFIRMADA.
      // Matar o processo aqui e o cenario exato que o R6 descreve.
      // ---------------------------------------------------------------
      if (ATRASO_COMMIT_MS > 0) {
        log(
          `${posicao} | [DEMO] processada, aguardando ${ATRASO_COMMIT_MS} ms antes de confirmar ` +
            `(janela de perda aberta)`
        );
        await esperar(ATRASO_COMMIT_MS);
      }

      // ---------------------------------------------------------------
      // So agora o ACK: o offset avanca DEPOIS do processamento concluido.
      // Nao e evento de Lamport (ver cabecalho do arquivo).
      // ---------------------------------------------------------------
      await confirmarOffset(consumidor, topic, partition, message.offset);
      log(`${posicao} | offset confirmado -> ${BigInt(message.offset) + 1n}`);
    },
  });

  const encerrar = async (): Promise<void> => {
    log(
      `encerrando... processadas=${processadas} bloqueios=${bloqueios} ` +
        `ips monitorados=${avaliador.ipsMonitorados} | relogio final: L=${relogio.valor} ` +
        `| papel: ${bully.souLider ? "LIDER" : `seguidor de ${String(bully.lider)}`} ` +
        `| bloqueios emitidos: ${consolidador.totalRegistros}`
    );
    // Fecha o canal de coordenacao: os pares passam a receber ECONNREFUSED
    // imediatamente, em vez de esperar o timeout de sondagem.
    consolidador.parar();
    bully.parar();
    await repositorio.fechar();
    // Sair do grupo avisando o broker faz o Kafka redistribuir as particoes
    // imediatamente, em vez de esperar o tempo de expiracao da sessao.
    await consumidor.disconnect();
    log("desconectado. Fim.");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void encerrar();
  });
}

principal().catch((erro: unknown) => {
  console.error("[worker] FALHOU:", erro);
  process.exitCode = 1;
});
