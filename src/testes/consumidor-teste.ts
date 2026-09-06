/**
 * CONSUMIDOR DE TESTE — Etapa 1 / R2.
 *
 * Script de verificacao manual (nao e teste automatizado): fica ouvindo o
 * topico e imprime cada mensagem que chega. Encerra com Ctrl+C.
 *
 * Uso:  npm run build && npm run teste:consumidor
 *
 * ATENCAO: usa confirmacao AUTOMATICA de offset (padrao da biblioteca).
 * Na Etapa 3/6 os workers reais vao usar autoCommit: false + confirmacao
 * manual apos processar — e isso que o R6 exige para nao perder mensagem.
 */

import { criarKafka, TOPICO_ALERTAS } from "../compartilhado/kafka";
import type { EnvelopeAlerta } from "../compartilhado/tipos";

/** Identifica o GRUPO de consumidores. */
const GRUPO = "grupo-teste";

async function principal(): Promise<void> {
  const kafka = criarKafka("consumidor-teste");

  // Processos com o MESMO groupId dividem as particoes entre si
  // (Competing Consumers). Com groupIds diferentes, cada um receberia
  // TODAS as mensagens — isso seria broadcast, nao divisao de trabalho.
  const consumidor = kafka.consumer({ groupId: GRUPO });

  console.log("[consumidor] conectando ao broker em localhost:29092 ...");
  await consumidor.connect();
  console.log(`[consumidor] conectado. Grupo: ${GRUPO}`);

  // fromBeginning: true -> na PRIMEIRA vez que este grupo existe, le desde o
  // inicio do topico. Nas execucoes seguintes o grupo ja tem offset salvo e
  // recebe apenas o que for novo.
  await consumidor.subscribe({ topic: TOPICO_ALERTAS, fromBeginning: true });
  console.log(`[consumidor] inscrito no topico "${TOPICO_ALERTAS}". Aguardando mensagens (Ctrl+C para sair)...`);

  await consumidor.run({
    eachMessage: async ({ topic, partition, message }) => {
      const bruto: string | undefined = message.value?.toString();
      if (bruto === undefined) {
        console.warn("[consumidor] mensagem sem conteudo, ignorada.");
        return;
      }

      const envelope = JSON.parse(bruto) as EnvelopeAlerta;

      console.log("");
      console.log("[consumidor] ===== MENSAGEM RECEBIDA =====");
      console.log(`  topico/particao/offset : ${topic} / ${partition} / ${message.offset}`);
      console.log(`  chave                  : ${message.key?.toString() ?? "(sem chave)"}`);
      console.log(`  id                     : ${envelope.id}`);
      console.log(`  origem                 : ${envelope.metadados.origemId}`);
      console.log(`  lamport                : ${envelope.metadados.lamport}`);
      console.log(`  correlacaoId           : ${envelope.metadados.correlacaoId}`);
      console.log(`  causaId                : ${envelope.metadados.causaId ?? "null (inicio da cadeia)"}`);
      console.log(`  alerta                 : ${envelope.payload.ipOrigem} -> ${envelope.payload.ipDestino}`);
      console.log(`                           ${envelope.payload.protocolo}, ${envelope.payload.pacotesPorSegundo} pacotes/s`);
      console.log("[consumidor] =============================");
    },
  });

  // Encerramento gracioso: avisa o broker que esta saindo do grupo, para o
  // Kafka redistribuir as particoes imediatamente em vez de esperar timeout.
  const encerrar = async (): Promise<void> => {
    console.log("\n[consumidor] encerrando...");
    await consumidor.disconnect();
    console.log("[consumidor] desconectado. Fim.");
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void encerrar();
  });
}

principal().catch((erro: unknown) => {
  console.error("[consumidor] FALHOU:", erro);
  process.exitCode = 1;
});
