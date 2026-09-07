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
import { AvaliadorDeBloqueio } from "./regra-bloqueio";

/**
 * Grupo de consumidores compartilhado pelos 3 workers.
 *
 * E o valor deste campo que faz o Kafka DIVIDIR o trabalho. Se cada worker
 * usasse um groupId diferente, todos receberiam TODAS as mensagens — seria
 * broadcast, e cada alerta seria processado tres vezes.
 */
const GRUPO_WORKERS = "workers-nids";

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

  const nome = `worker-${identificador}`;
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

  log("conectando ao Kafka...");
  await consumidor.connect();
  await consumidor.subscribe({ topic: TOPICO_ALERTAS, fromBeginning: true });
  log(`auditoria em ${auditoria.arquivo} | relogio de Lamport iniciado em L=${relogio.valor}`);
  log(`inscrito em "${TOPICO_ALERTAS}" | aguardando atribuicao de particoes...`);

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
          // Por enquanto o worker apenas REGISTRA a recomendacao. Consolidar o
          // lote e emitir o comando unico de bloqueio e papel do lider (R5).
          log(`${posicao} | >>> RECOMENDA BLOQUEIO de ${valor.payload.ipOrigem} (id=${valor.id})`);
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
        `ips monitorados=${avaliador.ipsMonitorados} | relogio final: L=${relogio.valor}`
    );
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
