/**
 * Parametros de rede do Ponto de Entrada (R1).
 *
 * Ficam num modulo proprio, e nao dentro do gateway, porque o simulador de
 * sensor tambem precisa deles. Importar do arquivo do servidor faria o modulo
 * do servidor ser EXECUTADO ao ser importado — que nao e o que queremos.
 */

/** Interface em que o gateway escuta. */
export const HOST_GATEWAY = "127.0.0.1";

/** Porta TCP do Ponto de Entrada. */
export const PORTA_GATEWAY = 5000;

/**
 * Tempo maximo de ociosidade de uma conexao, em milissegundos.
 *
 * Sem isso, um sensor que travasse (ou uma conexao meio-aberta, em que o outro
 * lado sumiu sem avisar) manteria socket e memoria presos para sempre. Faz
 * parte do criterio de "excecoes e timeouts robustos".
 */
export const TIMEOUT_OCIOSIDADE_MS = 30_000;
