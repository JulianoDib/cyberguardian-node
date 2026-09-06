/**
 * PONTO DE ENTRADA (Gateway) — R1.
 *
 * Servidor TCP puro que recebe alertas dos sensores, publica cada um na fila
 * do Kafka e devolve um ACK DE ENFILEIRAMENTO ao sensor.
 *
 * Fluxo de uma mensagem:
 *
 *   sensor --[quadro TCP]--> gateway --[envelope]--> Kafka
 *   sensor <--[quadro ACK]-- gateway <--[confirmacao]--
 *
 * Desacoplamento (R1/R2): o gateway NAO processa o alerta e nao conhece os
 * workers. A responsabilidade dele termina no enfileiramento — quem analisa e
 * decide bloqueio sao os workers, depois, de forma independente.
 *
 * Uso:  npm run build && npm run gateway
 */

import net from "node:net";
import { randomUUID } from "node:crypto";
import type { Producer } from "kafkajs";

import { codificarQuadro, DecodificadorDeQuadros, ErroDeFraming } from "../compartilhado/framing";
import { criarKafka, criarProdutor, TOPICO_ALERTAS } from "../compartilhado/kafka";
import { HOST_GATEWAY, PORTA_GATEWAY, TIMEOUT_OCIOSIDADE_MS } from "../compartilhado/rede";
import { ehAlertaAnomalia } from "../compartilhado/tipos";
import type { AlertaAnomalia, EnvelopeAlerta, RespostaGateway } from "../compartilhado/tipos";

/** Identificacao deste processo nos metadados e no Kafka. */
const ORIGEM = "gateway";

function log(mensagem: string): void {
  console.log(`[gateway] ${mensagem}`);
}

/**
 * Embrulha o alerta cru do sensor no envelope que trafega na fila.
 *
 * O sensor manda apenas o ALERTA; e o gateway que gera o identificador unico e
 * os metadados causais. Na Etapa 4 e aqui que o carimbo de Lamport passa a ser
 * calculado — por isso ele ja circula com valor 0.
 */
function montarEnvelope(alerta: AlertaAnomalia): EnvelopeAlerta {
  return {
    id: randomUUID(),
    payload: alerta,
    metadados: {
      // Quem colocou a mensagem na fila foi o gateway; o sensor de origem
      // continua identificado dentro do payload, em `sensorId`.
      origemId: ORIGEM,
      lamport: 0,
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
 * Nunca lanca: toda falha vira uma resposta de erro ao sensor. Isso mantem a
 * fila de processamento da conexao viva mesmo diante de um sensor com defeito.
 */
async function processarQuadro(
  socket: net.Socket,
  produtor: Producer,
  quadro: string,
  cliente: string
): Promise<void> {
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

  // --- 2) Enfileira ---
  const envelope: EnvelopeAlerta = montarEnvelope(valor);

  try {
    const resultado = await produtor.send({
      topic: TOPICO_ALERTAS,
      messages: [
        {
          // Chave = IP atacante: mantem todos os alertas do mesmo ataque na
          // mesma particao e, portanto, em ordem.
          key: envelope.payload.ipOrigem,
          value: JSON.stringify(envelope),
        },
      ],
    });

    const destino = resultado[0];
    const particao: number = destino?.partition ?? -1;
    const offset: string = destino?.baseOffset ?? destino?.offset ?? "?";

    log(
      `enfileirado ${envelope.id} | ${envelope.payload.ipOrigem} -> ` +
        `${envelope.payload.ipDestino} | ${envelope.payload.pacotesPorSegundo} pacotes/s ` +
        `| particao ${particao} offset ${offset}`
    );

    // --- 3) So agora o ACK: ele afirma "esta na fila", e o Kafka ja confirmou ---
    responder(socket, { tipo: "ACK", id: envelope.id, particao, offset });
  } catch (erro: unknown) {
    const detalhe: string = erro instanceof Error ? erro.message : String(erro);
    log(`FALHA ao enfileirar alerta de ${cliente}: ${detalhe}`);
    // Motivo generico para o sensor; o detalhe fica no log do servidor.
    responder(socket, { tipo: "ERRO", motivo: "falha ao enfileirar" });
  }
}

/** Trata uma conexao de sensor do inicio ao fim. */
function atenderConexao(socket: net.Socket, produtor: Producer): void {
  const cliente = `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? "?"}`;

  // Um decodificador POR CONEXAO: os bytes pela metade de um sensor nao podem
  // se misturar com os de outro.
  const decodificador = new DecodificadorDeQuadros();

  /**
   * SECAO CRITICA desta conexao.
   *
   * O tratamento de cada quadro e assincrono (espera o Kafka). Sem esta fila,
   * dois quadros chegando em sequencia teriam suas publicacoes disparadas em
   * paralelo e poderiam ser gravados FORA DE ORDEM na particao, destruindo a
   * ordenacao por atacante que a chave da mensagem garante.
   *
   * Encadear promessas serializa o processamento DENTRO da conexao, sem
   * bloquear as demais: conexoes diferentes seguem sendo atendidas em paralelo
   * pelo event loop.
   */
  let fila: Promise<void> = Promise.resolve();

  socket.setTimeout(TIMEOUT_OCIOSIDADE_MS);
  log(`sensor conectado: ${cliente}`);

  socket.on("data", (pedaco: Buffer) => {
    let quadros: string[];

    try {
      quadros = decodificador.receber(pedaco);
    } catch (erro: unknown) {
      // Violacao de protocolo (ex.: cabecalho anunciando quadro gigante).
      // Nao da para reencontrar o alinhamento do fluxo: derruba a conexao.
      const motivo: string =
        erro instanceof ErroDeFraming ? erro.message : "falha ao decodificar quadro";
      log(`protocolo violado por ${cliente}: ${motivo} — encerrando conexao`);
      responder(socket, { tipo: "ERRO", motivo });
      socket.destroy();
      return;
    }

    for (const quadro of quadros) {
      fila = fila
        .then(() => processarQuadro(socket, produtor, quadro, cliente))
        .catch((erro: unknown) => {
          // Rede de seguranca: mantem a fila viva mesmo diante do inesperado.
          log(`falha inesperada ao processar quadro de ${cliente}: ${String(erro)}`);
        });
    }
  });

  socket.on("timeout", () => {
    log(`conexao ociosa ha ${TIMEOUT_OCIOSIDADE_MS} ms: ${cliente} — encerrando`);
    socket.destroy();
  });

  socket.on("error", (erro: Error) => {
    // Ex.: o sensor sumiu no meio de uma escrita. Nao pode derrubar o gateway.
    log(`erro de socket com ${cliente}: ${erro.message}`);
  });

  socket.on("close", () => {
    log(`sensor desconectado: ${cliente}`);
  });
}

async function principal(): Promise<void> {
  const kafka = criarKafka(ORIGEM);
  const produtor = criarProdutor(kafka);

  log("conectando ao Kafka...");
  await produtor.connect();
  log("conectado ao Kafka.");

  const servidor = net.createServer((socket: net.Socket) => {
    atenderConexao(socket, produtor);
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

  // Encerramento gracioso: para de aceitar conexoes e fecha o produtor,
  // garantindo que nada fique pendente de envio.
  const encerrar = async (): Promise<void> => {
    log("encerrando...");
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
