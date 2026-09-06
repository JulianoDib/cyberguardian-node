/**
 * PRODUTOR DE TESTE — Etapa 1 / R2.
 *
 * Script de verificacao manual (nao e teste automatizado): publica UM alerta
 * no topico e encerra. Serve para provar que a fila recebe mensagens.
 *
 * Uso:  npm run build && npm run teste:produtor
 */

import { randomUUID } from "node:crypto";
import { criarKafka, criarProdutor, TOPICO_ALERTAS } from "../compartilhado/kafka";
import type { AlertaAnomalia, EnvelopeAlerta } from "../compartilhado/tipos";

/** Monta um alerta ficticio dentro do envelope definido em compartilhado/tipos.ts. */
function montarEnvelope(): EnvelopeAlerta {
  const agora: string = new Date().toISOString();

  const payload: AlertaAnomalia = {
    sensorId: "sensor-datacenter-01",
    ipOrigem: "203.0.113.45",
    ipDestino: "10.0.0.7",
    protocolo: "TCP",
    pacotesPorSegundo: 18_500,
    bytesPorSegundo: 9_400_000,
    detectadoEm: agora,
  };

  return {
    id: randomUUID(),
    payload,
    metadados: {
      origemId: payload.sensorId,
      // Placeholder: passa a ser calculado pela regra de Lamport na Etapa 4.
      lamport: 0,
      emitidoEm: agora,
      correlacaoId: randomUUID(),
      // null porque o alerta INICIA a cadeia causal: nasce da observacao do
      // sensor, nao de outra mensagem.
      causaId: null,
    },
  };
}

async function principal(): Promise<void> {
  const kafka = criarKafka("produtor-teste");
  const produtor = criarProdutor(kafka);

  console.log("[produtor] conectando ao broker em localhost:29092 ...");
  await produtor.connect();
  console.log("[produtor] conectado.");

  const envelope: EnvelopeAlerta = montarEnvelope();

  const resultado = await produtor.send({
    topic: TOPICO_ALERTAS,
    messages: [
      {
        // A CHAVE define a particao: hash(chave) -> particao.
        // Usando o IP de origem, todos os alertas do mesmo atacante caem na
        // MESMA particao e portanto sao entregues EM ORDEM ao mesmo worker.
        // (O Kafka so garante ordem dentro de uma particao.)
        key: envelope.payload.ipOrigem,
        value: JSON.stringify(envelope),
      },
    ],
  });

  const destino = resultado[0];
  console.log("[produtor] mensagem publicada:");
  console.log(`           id          = ${envelope.id}`);
  console.log(`           chave       = ${envelope.payload.ipOrigem}`);
  console.log(`           topico      = ${TOPICO_ALERTAS}`);
  console.log(`           particao    = ${destino === undefined ? "?" : destino.partition}`);
  console.log(`           lamport     = ${envelope.metadados.lamport}  (placeholder ate a Etapa 4)`);

  await produtor.disconnect();
  console.log("[produtor] desconectado. Fim.");
}

principal().catch((erro: unknown) => {
  console.error("[produtor] FALHOU:", erro);
  process.exitCode = 1;
});
