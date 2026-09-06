/**
 * REGRA DE BLOQUEIO — a deteccao de DDoS que cada worker aplica de forma
 * INDEPENDENTE (R3).
 *
 * Duas camadas:
 *
 *   1. IMEDIATA (sem memoria): o alerta passou do limiar de pacotes/s?
 *      Se nao passou, e trafego normal e nem entra na contagem.
 *
 *   2. ACUMULADA (com memoria): entre os que passaram, quantos vieram do MESMO
 *      IP de origem nos ultimos 30 segundos? Chegando a 3, deixa de ser pico
 *      isolado e passa a caracterizar ataque sustentado -> BLOQUEAR.
 *
 * Fica isolada do worker de proposito: o worker cuida de CONSUMIR da fila, esta
 * classe cuida de DECIDIR. Sao responsabilidades diferentes.
 */

import type { AlertaAnomalia } from "../compartilhado/tipos";

/** Acima disto, o volume de pacotes por segundo e considerado um pico. */
export const LIMIAR_PACOTES_POR_SEGUNDO = 20_000;

/** Tamanho da janela deslizante de observacao, em milissegundos. */
export const JANELA_MS = 30_000;

/** Quantos picos do mesmo IP dentro da janela caracterizam ataque sustentado. */
export const PICOS_PARA_BLOQUEIO = 3;

/** Veredito sobre um alerta. */
export type Severidade = "NORMAL" | "SUSPEITO" | "BLOQUEAR";

export interface DecisaoBloqueio {
  readonly severidade: Severidade;
  readonly motivo: string;
  /** Quantos picos daquele IP havia na janela no momento da decisao. */
  readonly picosNaJanela: number;
}

export class AvaliadorDeBloqueio {
  /**
   * Historico de picos por IP de origem: para cada IP, os instantes (em ms) dos
   * picos recentes.
   *
   * Este Map e o UNICO estado mutavel do worker — e, portanto, a unica secao
   * critica de verdade que existe neste processo.
   *
   * Detalhe importante de arquitetura: a chave da mensagem no Kafka e o
   * `ipOrigem`, entao TODOS os alertas de um mesmo atacante caem sempre na
   * mesma particao e sao entregues sempre ao MESMO worker. Por isso esta
   * contagem local esta correta sem nenhuma coordenacao entre processos. Se as
   * mensagens fossem distribuidas em rodizio, nenhum worker teria a contagem
   * completa e seria necessario estado compartilhado.
   */
  private readonly historicoPorIp = new Map<string, number[]>();

  /** Quantos IPs distintos estao sendo observados (util para o log). */
  public get ipsMonitorados(): number {
    return this.historicoPorIp.size;
  }

  /**
   * Registra um pico e devolve quantos picos daquele IP ha na janela.
   *
   * ###################  SECAO CRITICA  ###################
   *
   * O padrao aqui e LER -> MODIFICAR -> ESCREVER sobre `historicoPorIp`.
   *
   * O metodo e SINCRONO de proposito: nao existe `await` entre a leitura e a
   * escrita. Como o JavaScript so troca de tarefa em pontos de espera, nada
   * consegue se intercalar no meio — a operacao e atomica por construcao.
   *
   * Se algum dia for preciso inserir um `await` aqui dentro (por exemplo, uma
   * gravacao em banco), a janela de corrida se abre: uma segunda mensagem
   * poderia ler o valor antigo nessa fresta e as duas escreveriam por cima uma
   * da outra. Nesse caso passaria a ser necessario serializar explicitamente.
   *
   * (Entre workers DIFERENTES nao ha disputa: sao processos separados, sem
   * memoria compartilhada, e cada particao pertence a um unico consumidor do
   * grupo. A exclusao mutua, ali, vem da arquitetura do Kafka.)
   *
   * #######################################################
   */
  private registrarPico(ipOrigem: string, agoraMs: number): number {
    const anteriores: number[] = this.historicoPorIp.get(ipOrigem) ?? [];

    // Descarta o que ja saiu da janela e acrescenta o pico atual.
    const naJanela: number[] = anteriores.filter(
      (instante) => agoraMs - instante <= JANELA_MS
    );
    naJanela.push(agoraMs);

    this.historicoPorIp.set(ipOrigem, naJanela);

    return naJanela.length;
  }

  /** Aplica as duas camadas da regra e devolve o veredito. */
  public avaliar(alerta: AlertaAnomalia, agoraMs: number): DecisaoBloqueio {
    // --- Camada 1: imediata ---
    if (alerta.pacotesPorSegundo <= LIMIAR_PACOTES_POR_SEGUNDO) {
      return {
        severidade: "NORMAL",
        motivo: `${alerta.pacotesPorSegundo} pacotes/s dentro do limiar de ${LIMIAR_PACOTES_POR_SEGUNDO}`,
        picosNaJanela: 0,
      };
    }

    // --- Camada 2: acumulada ---
    const picosNaJanela: number = this.registrarPico(alerta.ipOrigem, agoraMs);

    if (picosNaJanela >= PICOS_PARA_BLOQUEIO) {
      return {
        severidade: "BLOQUEAR",
        motivo:
          `${picosNaJanela} picos de ${alerta.ipOrigem} em ${JANELA_MS / 1000}s ` +
          `— ataque sustentado`,
        picosNaJanela,
      };
    }

    return {
      severidade: "SUSPEITO",
      motivo:
        `pico de ${alerta.pacotesPorSegundo} pacotes/s ` +
        `(${picosNaJanela}/${PICOS_PARA_BLOQUEIO} para bloqueio)`,
      picosNaJanela,
    };
  }
}
