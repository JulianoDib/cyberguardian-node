/**
 * Parametros de rede do sistema.
 *
 * Ficam num modulo proprio, e nao dentro do gateway ou do worker, porque varios
 * processos precisam deles. Importar do arquivo do servidor faria o modulo do
 * servidor ser EXECUTADO ao ser importado.
 */

// ---------------------------------------------------------------------------
// Ponto de Entrada (R1)
// ---------------------------------------------------------------------------

/** Interface em que o gateway escuta. */
export const HOST_GATEWAY = "127.0.0.1";

/** Porta TCP do Ponto de Entrada. */
export const PORTA_GATEWAY = 5000;

/**
 * Tempo maximo de ociosidade de uma conexao de sensor, em milissegundos.
 *
 * Sem isso, um sensor que travasse (ou uma conexao meio-aberta, em que o outro
 * lado sumiu sem avisar) manteria socket e memoria presos para sempre.
 */
export const TIMEOUT_OCIOSIDADE_MS = 30_000;

// ---------------------------------------------------------------------------
// Canal de coordenacao entre os workers — algoritmo Bully (R5)
// ---------------------------------------------------------------------------

/** Interface do canal de coordenacao. */
export const HOST_COORDENACAO = "127.0.0.1";

export interface EnderecoWorker {
  readonly id: number;
  readonly porta: number;
}

/**
 * COMPOSICAO DO GRUPO — descoberta estatica.
 *
 * Nao e simplificacao: o Bully EXIGE que cada no conheca a lista completa de
 * participantes e seus IDs, senao nao sabe a quem enviar ELECTION. Essa e uma
 * limitacao real do algoritmo — o Ring, em comparacao, precisa conhecer apenas
 * o proprio sucessor.
 */
export const WORKERS: readonly EnderecoWorker[] = [
  { id: 1, porta: 5101 },
  { id: 2, porta: 5102 },
  { id: 3, porta: 5103 },
];

/** Endereco de um worker pelo id, ou undefined se nao estiver na composicao. */
export function enderecoDoWorker(id: number): EnderecoWorker | undefined {
  return WORKERS.find((worker) => worker.id === id);
}

// --- Deteccao de falha do lider ---

/** Intervalo entre sondagens de vida do lider. */
export const INTERVALO_HEARTBEAT_MS = 1000;

/**
 * Tempo maximo esperando resposta de uma mensagem de coordenacao.
 *
 * A latencia real em localhost fica abaixo de 5 ms — a margem e de ~100x.
 */
export const TIMEOUT_RESPOSTA_MS = 500;

/**
 * Falhas CONSECUTIVAS de sondagem para declarar o lider morto.
 *
 * E a principal protecao contra falso positivo: um blip isolado nao conta, e
 * qualquer resposta bem-sucedida zera o contador. Detecao no pior caso: ~3 s.
 */
export const FALHAS_PARA_ELEICAO = 3;

// --- Tempos da eleicao ---

/** Espera por um OK apos enviar ELECTION aos ids maiores. */
export const TIMEOUT_OK_MS = 1000;

/**
 * Espera por um COORDINATOR depois de ter recebido um OK.
 *
 * PRECISA ser maior que TIMEOUT_OK_MS: se fosse menor, este no reiniciaria a
 * eleicao antes de o no maior ter tempo de concluir a dele. E um erro classico
 * de implementacao do Bully.
 */
export const TIMEOUT_COORDINATOR_MS = 2500;

// --- Consolidacao do lote (R5) ---

/**
 * De quanto em quanto tempo o lider fecha o lote de anomalias.
 *
 * Fechar em lote (e nao a cada recomendacao) e o que permite DEDUPLICAR por IP:
 * varias recomendacoes do mesmo atacante viram UM unico comando de bloqueio.
 */
export const INTERVALO_CONSOLIDACAO_MS = 5000;
