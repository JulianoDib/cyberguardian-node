/**
 * PONTO DE ENTRADA (Gateway) — R1 + relogio de Lamport (R4).
 *
 * Servidor TCP puro que recebe alertas dos sensores, publica cada um na fila
 * do Kafka e devolve um ACK DE ENFILEIRAMENTO ao sensor.
 *
 *   sensor --[quadro TCP]--> gateway --[envelope]--> Kafka
 *   sensor <--[quadro ACK]-- gateway <--[confirmacao]--
 *
 * Desacoplamento (R1/R2): o gateway NAO processa o alerta e nao conhece os
 * workers. A responsabilidade dele termina no enfileiramento.
 *
 * RELOGIO DE LAMPORT (R4): o gateway tem UM relogio, do processo inteiro (nao
 * um por conexao). Tres eventos por alerta:
 *
 *   1. RECEBE-SENSOR : evento interno (o sensor nao tem relogio proprio)
 *   2. PUBLICA-FILA  : envio — este e o carimbo que viaja em metadados.lamport
 *   3. ENVIA-ACK     : envio
 *
 * NAO incrementam: quadros invalidos e respostas de erro. O contador mede
 * eventos de DOMINIO; lixo de protocolo nao e um alerta recebido.
 *
 * Uso:  npm run build && npm run gateway
 */

import net from "node:net";
import { randomUUID } from "node:crypto";
import type { Producer } from "kafkajs";

import { RegistradorAuditoria } from "../compartilhado/auditoria";
import { codificarQuadro, DecodificadorDeQuadros, ErroDeFraming } from "../compartilhado/framing";
import { criarKafka, criarProdutor, TOPICO_ALERTAS } from "../compartilhado/kafka";
import { RelogioLamport } from "../compartilhado/lamport";
import { HOST_GATEWAY, PORTA_GATEWAY, TIMEOUT_OCIOSIDADE_MS } from "../compartilhado/rede";
import { ehAlertaAnomalia } from "../compartilhado/tipos";
import type { AlertaAnomalia, EnvelopeAlerta, RespostaGateway } from "../compartilhado/tipos";

/** Identificacao deste processo nos metadados, no Kafka e na auditoria. */
const ORIGEM = "gateway";

/** Tudo que o tratamento de uma conexao precisa. */
interface ContextoGateway {
  readonly produtor: Producer;
  readonly relogio: RelogioLamport;
  readonly auditoria: RegistradorAuditoria;
}

function log(mensagem: string): void {
  console.log(`[${ORIGEM}] ${mensagem}`);
}

/**
 * Embrulha o alerta cru do sensor no envelope que trafega na fila.
 *
 * O sensor manda apenas o ALERTA; e o gateway que gera o identificador unico,
 * os metadados causais e o CARIMBO DE LAMPORT.
 */
function montarEnvelope(alerta: AlertaAnomalia, carimboLamport: number): EnvelopeAlerta {
  return {
    id: randomUUID(),
    payload: alerta,
    metadados: {
      origemId: ORIGEM,
      // Carimbo LOGICO: o valor ja incrementado pela regra de envio.
      lamport: carimboLamport,
      // Carimbo FISICO, para o contraste na demonstracao.
      emitidoEm: new Date().toISOString(),
      correlacaoId: randomUUID(),
      causaId: null,
    },
  };
}

/** Envia uma resposta enquadrada ao sensor, se o socket ainda estiver vivo. */
function responder(socket: net.Socket, resposta: RespostaGateway): void {
  if (socket.destroyed) {
    return;
  }
  socket.write(codificarQuadro(resposta));
}

/**
 * Processa UM quadro completo: valida, publica no Kafka e responde.
 *
 * Nunca lanca: toda falha vira uma resposta de erro ao sensor.
 */
async function processarQuadro(
  socket: net.Socket,
  contexto: ContextoGateway,
  quadro: string,
  cliente: string
): Promise<void> {
  const { produtor, relogio, auditoria } = contexto;

  // --- 1) O conteudo veio da rede: nao se confia nele ---
  let valor: unknown;
  try {
    valor = JSON.parse(quadro);
  } catch {
    log(`JSON invalido vindo de ${cliente}`);
    responder(socket, { tipo: "ERRO", motivo: "JSON invalido" });
    return;
  }

  if (!ehAlertaAnomalia(valor)) {
    log(`alerta fora do contrato, vindo de ${cliente}`);
    responder(socket, { tipo: "ERRO", motivo: "alerta fora do contrato esperado" });
    return;
  }

  // --- 2) LAMPORT, evento 1: recepcao do alerta ---
  // Evento INTERNO porque o sensor nao tem relogio: nao ha L_msg para compor.
  const antesDoRecebe = relogio.valor;
  const lamportRecebe = relogio.eventoInterno();
  auditoria.registrar({
    lamport: lamportRecebe,
    tipo: "RECEBE-SENSOR",
    calculo: `interno: ${antesDoRecebe}+1 = ${lamportRecebe}`,
    detalhe: `${valor.sensorId} ${valor.ipOrigem} -> ${valor.ipDestino}`,
    mensagemId: null,
  });

  // --- 3) LAMPORT, evento 2: envio para a fila ---
  // O carimbo e o valor POSTERIOR ao incremento; e ele que viaja na mensagem.
  const antesDoEnvio = relogio.valor;
  const carimbo = relogio.aoEnviar();
  const envelope: EnvelopeAlerta = montarEnvelope(valor, carimbo);

  try {
    const resultado = await produtor.send({
      topic: TOPICO_ALERTAS,
      messages: [
        {
          // Chave = IP atacante: mantem os alertas do mesmo ataque na mesma
          // particao e, portanto, em ordem.
          key: envelope.payload.ipOrigem,
          value: JSON.stringify(envelope),
        },
      ],
    });

    const destino = resultado[0];
    const particao: number = destino?.partition ?? -1;
    const offset: string = destino?.baseOffset ?? destino?.offset ?? "?";

    auditoria.registrar({
      lamport: carimbo,
      tipo: "PUBLICA-FILA",
      calculo: `envio: ${antesDoEnvio}+1 = ${carimbo}  [carimbo=${carimbo}]`,
      detalhe: `p${particao} off=${offset} ${envelope.payload.pacotesPorSegundo} pac/s`,
      mensagemId: envelope.id,
    });

    // --- 4) LAMPORT, evento 3: envio do ACK ---
    const antesDoAck = relogio.valor;
    const lamportAck = relogio.aoEnviar();

    // So agora o ACK: ele afirma "esta na fila", e o Kafka ja confirmou.
    responder(socket, { tipo: "ACK", id: envelope.id, particao, offset });

    auditoria.registrar({
      lamport: lamportAck,
      tipo: "ENVIA-ACK",
      calculo: `envio: ${antesDoAck}+1 = ${lamportAck}`,
      detalhe: `para ${cliente}`,
      mensagemId: envelope.id,
    });
  } catch (erro: unknown) {
    const detalhe: string = erro instanceof Error ? erro.message : String(erro);
    log(`FALHA ao enfileirar alerta de ${cliente}: ${detalhe}`);
    // Motivo generico para o sensor; o detalhe fica no log do servidor.
    responder(socket, { tipo: "ERRO", motivo: "falha ao enfileirar" });
  }
}

/** Trata uma conexao de sensor do inicio ao fim. */
function atenderConexao(socket: net.Socket, contexto: ContextoGateway): void {
  const cliente = `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? "?"}`;

  // Um decodificador POR CONEXAO: os bytes pela metade de um sensor nao podem
  // se misturar com os de outro.
  const decodificador = new DecodificadorDeQuadros();

  /**
   * SECAO CRITICA desta conexao.
   *
   * O tratamento de cada quadro e assincrono (espera o Kafka). Sem esta fila,
   * dois quadros chegando em sequencia teriam suas publicacoes disparadas em
   * paralelo e poderiam ser gravados FORA DE ORDEM na particao.
   *
   * Com o relogio de Lamport, a fila passou a proteger tambem o CONTADOR: sem
   * ela, dois quadros poderiam intercalar seus incrementos e os carimbos das
   * mensagens sairiam fora da ordem em que os alertas realmente chegaram.
   */
  let fila: Promise<void> = Promise.resolve();

  socket.setTimeout(TIMEOUT_OCIOSIDADE_MS);
  log(`sensor conectado: ${cliente}`);

  socket.on("data", (pedaco: Buffer) => {
    let quadros: string[];

    try {
      quadros = decodificador.receber(pedaco);
    } catch (erro: unknown) {
      // Violacao de protocolo: perdido o alinhamento do fluxo, nao ha como
      // reencontra-lo. Derruba a conexao.
      const motivo: string =
        erro instanceof ErroDeFraming ? erro.message : "falha ao decodificar quadro";
      log(`protocolo violado por ${cliente}: ${motivo} — encerrando conexao`);
      responder(socket, { tipo: "ERRO", motivo });
      socket.destroy();
      return;
    }

    for (const quadro of quadros) {
      fila = fila
        .then(() => processarQuadro(socket, contexto, quadro, cliente))
        .catch((erro: unknown) => {
          log(`falha inesperada ao processar quadro de ${cliente}: ${String(erro)}`);
        });
    }
  });

  socket.on("timeout", () => {
    log(`conexao ociosa ha ${TIMEOUT_OCIOSIDADE_MS} ms: ${cliente} — encerrando`);
    socket.destroy();
  });

  socket.on("error", (erro: Error) => {
    log(`erro de socket com ${cliente}: ${erro.message}`);
  });

  socket.on("close", () => {
    log(`sensor desconectado: ${cliente}`);
  });
}

async function principal(): Promise<void> {
  const kafka = criarKafka(ORIGEM);
  const produtor = criarProdutor(kafka);

  // UM relogio para o processo inteiro. Nao um por conexao: o relogio pertence
  // ao PROCESSO, e todos os eventos dele compartilham a mesma linha do tempo.
  const relogio = new RelogioLamport();
  const auditoria = new RegistradorAuditoria(ORIGEM);

  const contexto: ContextoGateway = { produtor, relogio, auditoria };

  log("conectando ao Kafka...");
  await produtor.connect();
  log("conectado ao Kafka.");
  log(`auditoria em ${auditoria.arquivo} | relogio de Lamport iniciado em L=${relogio.valor}`);

  const servidor = net.createServer((socket: net.Socket) => {
    atenderConexao(socket, contexto);
  });

  servidor.on("error", (erro: Error) => {
    log(`ERRO no servidor: ${erro.message}`);
    process.exitCode = 1;
  });

  await new Promise<void>((resolve) => {
    servidor.listen(PORTA_GATEWAY, HOST_GATEWAY, () => {
      resolve();
    });
  });

  log(`Ponto de Entrada ouvindo em ${HOST_GATEWAY}:${PORTA_GATEWAY} (Ctrl+C para sair)`);

  const encerrar = async (): Promise<void> => {
    log(`encerrando... relogio final: L=${relogio.valor}`);
    servidor.close();
    await produtor.disconnect();
    log("desconectado. Fim.");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void encerrar();
  });
}

principal().catch((erro: unknown) => {
  console.error("[gateway] FALHOU:", erro);
  process.exitCode = 1;
});
