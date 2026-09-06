/**
 * Conexao com o broker Kafka — configuracao unica, usada por todos os processos.
 */

import { Kafka, Partitioners, logLevel } from "kafkajs";
import type { Producer } from "kafkajs";

/**
 * Endereco do broker visto DE FORA do Docker.
 *
 * Corresponde ao listener EXTERNO do docker-compose.yml, que o broker anuncia
 * como "localhost:29092". Processos rodando dentro da rede do Docker usariam
 * "kafka:9092" — o outro listener.
 */
export const BROKERS: readonly string[] = ["localhost:29092"];

/** Topico dos alertas de anomalia (criado com 3 particoes na Parte 1). */
export const TOPICO_ALERTAS = "alertas-anomalia";

/**
 * Cria um cliente Kafka.
 *
 * @param clientId identificacao deste processo perante o broker. Aparece nos
 *   logs do servidor e ajuda a saber quem esta conectado (util no R3, com
 *   varios workers simultaneos).
 */
export function criarKafka(clientId: string): Kafka {
  return new Kafka({
    clientId,
    brokers: [...BROKERS],
    // WARN: esconde o ruido informativo da biblioteca, mas deixa visivel
    // qualquer problema real de conexao ou de protocolo.
    logLevel: logLevel.WARN,
  });
}

/**
 * Cria um produtor.
 *
 * O particionador e declarado EXPLICITAMENTE em vez de deixar no padrao:
 *  - `DefaultPartitioner` calcula a particao por hash da chave da mensagem, do
 *    mesmo modo que o cliente Java oficial do Kafka. E o que garante que a
 *    chave `ipOrigem` sempre caia na mesma particao (ordem por atacante).
 *  - A alternativa `LegacyPartitioner` existe so por compatibilidade com a
 *    versao 1 da kafkajs; nao ha motivo para usa-la em codigo novo.
 *
 * Declarar aqui tambem evita o aviso que a biblioteca emite quando a opcao
 * fica ausente (ela avisa apenas se `createPartitioner == null`).
 */
export function criarProdutor(kafka: Kafka): Producer {
  return kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
  });
}
