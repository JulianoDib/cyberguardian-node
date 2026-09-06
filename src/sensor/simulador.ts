/**
 * SIMULADOR DE SENSOR DE REDE — cliente TCP do Ponto de Entrada (R1).
 *
 * Representa a entidade SensorRede: um sensor espalhado por um datacenter que
 * observa trafego e emite AlertaAnomalia quando detecta volume suspeito.
 *
 * Envia os alertas em RAJADA, de proposito: e assim que o enquadramento e
 * exercitado de verdade (varios quadros grudados numa leitura so do gateway).
 *
 * Uso:  npm run build && npm run sensor
 *       npm run sensor -- 10                    (10 alertas)
 *       npm run sensor -- 10 sensor-filial-02   (10 alertas, outro sensor)
 */

import net from "node:net";

import { codificarQuadro, DecodificadorDeQuadros } from "../compartilhado/framing";
import { HOST_GATEWAY, PORTA_GATEWAY } from "../compartilhado/rede";
import type { AlertaAnomalia, Protocolo, RespostaGateway } from "../compartilhado/tipos";

const IPS_ATACANTES: readonly string[] = ["203.0.113.45", "198.51.100.9", "192.0.2.77"];
const IPS_ALVOS: readonly string[] = ["10.0.0.7", "10.0.0.12", "10.0.1.30"];
const PROTOCOLOS: readonly Protocolo[] = ["TCP", "UDP", "ICMP"];

/** Tempo maximo esperando as respostas antes de desistir. */
const LIMITE_ESPERA_MS = 15_000;

function log(mensagem: string): void {
  console.log(`[sensor] ${mensagem}`);
}

/**
 * Sorteia um item da lista.
 *
 * O `if (item === undefined)` nao e paranoia: com `noUncheckedIndexedAccess`
 * ligado, o TypeScript trata `lista[i]` como possivelmente indefinido e obriga
 * a checagem. E a tipagem rigorosa cobrando o preco dela.
 */
function sortear<T>(lista: readonly T[]): T {
  const item = lista[Math.floor(Math.random() * lista.length)];
  if (item === undefined) {
    throw new Error("lista de sorteio vazia");
  }
  return item;
}

function gerarAlerta(sensorId: string): AlertaAnomalia {
  return {
    sensorId,
    ipOrigem: sortear(IPS_ATACANTES),
    ipDestino: sortear(IPS_ALVOS),
    protocolo: sortear(PROTOCOLOS),
    // Volume alto o bastante para caracterizar suspeita de DDoS.
    pacotesPorSegundo: 10_000 + Math.floor(Math.random() * 40_000),
    bytesPorSegundo: 5_000_000 + Math.floor(Math.random() * 10_000_000),
    detectadoEm: new Date().toISOString(),
  };
}

async function principal(): Promise<void> {
  const quantidade: number = Number.parseInt(process.argv[2] ?? "5", 10);
  const sensorId: string = process.argv[3] ?? "sensor-datacenter-01";

  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new Error(`quantidade invalida: ${process.argv[2] ?? "(vazio)"}`);
  }

  const socket = net.connect(PORTA_GATEWAY, HOST_GATEWAY);
  const decodificador = new DecodificadorDeQuadros();

  /** Momento de envio de cada alerta, na ordem em que foram enviados. */
  const enviadoEm: number[] = [];
  const latencias: number[] = [];
  let respondidos = 0;
  let acks = 0;
  let erros = 0;

  let concluir: () => void = () => undefined;
  const todasRespondidas = new Promise<void>((resolve) => {
    concluir = resolve;
  });

  socket.on("error", (erro: Error) => {
    log(`ERRO de conexao: ${erro.message}`);
    log(`o gateway esta rodando em ${HOST_GATEWAY}:${PORTA_GATEWAY}?`);
    process.exitCode = 1;
    concluir();
  });

  socket.on("data", (pedaco: Buffer) => {
    for (const quadro of decodificador.receber(pedaco)) {
      const resposta = JSON.parse(quadro) as RespostaGateway;

      // As respostas chegam na MESMA ordem dos envios, porque o gateway
      // serializa o processamento de cada conexao. Por isso da para casar
      // resposta com envio pela posicao.
      const partida: number = enviadoEm[respondidos] ?? Date.now();
      const latencia: number = Date.now() - partida;
      respondidos++;
      latencias.push(latencia);

      // O campo `tipo` estreita o tipo: no ramo do ACK o TypeScript libera
      // `id`/`particao`/`offset`; no ramo do erro, so `motivo` existe.
      if (resposta.tipo === "ACK") {
        acks++;
        log(
          `ACK  #${respondidos} em ${latencia} ms | id=${resposta.id} ` +
            `particao=${resposta.particao} offset=${resposta.offset}`
        );
      } else {
        erros++;
        log(`ERRO #${respondidos} em ${latencia} ms | motivo=${resposta.motivo}`);
      }

      if (respondidos >= quantidade) {
        concluir();
      }
    }
  });

  await new Promise<void>((resolve) => {
    socket.on("connect", () => {
      resolve();
    });
  });
  log(`conectado ao gateway em ${HOST_GATEWAY}:${PORTA_GATEWAY} como "${sensorId}"`);
  log(`enviando ${quantidade} alerta(s) em rajada...`);

  // RAJADA: escreve tudo sem esperar resposta. E o caso que gruda quadros no
  // buffer do gateway — exatamente o que o framing existe para resolver.
  for (let i = 0; i < quantidade; i++) {
    const alerta = gerarAlerta(sensorId);
    enviadoEm.push(Date.now());
    socket.write(codificarQuadro(alerta));
    log(
      `enviado #${i + 1}: ${alerta.ipOrigem} -> ${alerta.ipDestino} ` +
        `(${alerta.protocolo}, ${alerta.pacotesPorSegundo} pacotes/s)`
    );
  }

  const limite = new Promise<never>((_, rejeitar) => {
    const temporizador = setTimeout(() => {
      rejeitar(new Error(`timeout: ${respondidos}/${quantidade} respostas em ${LIMITE_ESPERA_MS} ms`));
    }, LIMITE_ESPERA_MS);
    // unref: este temporizador nao deve segurar o processo vivo sozinho.
    temporizador.unref();
  });

  try {
    await Promise.race([todasRespondidas, limite]);
  } finally {
    socket.end();
  }

  if (latencias.length > 0) {
    const soma = latencias.reduce((a, b) => a + b, 0);
    const media = (soma / latencias.length).toFixed(1);
    log("-----------------------------------------------------");
    log(`enviados: ${quantidade} | ACK: ${acks} | ERRO: ${erros}`);
    log(`latencia (ms): min=${Math.min(...latencias)} max=${Math.max(...latencias)} media=${media}`);
    log("-----------------------------------------------------");
  }
}

principal().catch((erro: unknown) => {
  console.error("[sensor] FALHOU:", erro);
  process.exitCode = 1;
});
