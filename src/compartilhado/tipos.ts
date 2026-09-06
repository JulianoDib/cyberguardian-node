/**
 * Contrato das mensagens que trafegam pela fila (R2).
 *
 * Este arquivo e a FONTE DA VERDADE do formato das mensagens. Gateway, workers e
 * simulador de sensor dependem dele. Alterar aqui muda o contrato de todos.
 */

/** Protocolo de rede observado pelo sensor. */
export type Protocolo = "TCP" | "UDP" | "ICMP";

/**
 * PAYLOAD ESTRUTURADO (R2) — o alerta emitido por um SensorRede.
 *
 * "Estruturado" significa campos tipados e nomeados, e nao um texto solto:
 * o worker consegue ler `pacotesPorSegundo` como numero e aplicar a regra de
 * bloqueio sem precisar interpretar string.
 */
export interface AlertaAnomalia {
  /** Qual sensor observou o trafego (ex.: "sensor-datacenter-01"). */
  readonly sensorId: string;
  /** IP suspeito de originar o ataque. */
  readonly ipOrigem: string;
  /** IP alvo do trafego. */
  readonly ipDestino: string;
  readonly protocolo: Protocolo;
  /** Metrica principal da deteccao de DDoS: volume de pacotes por segundo. */
  readonly pacotesPorSegundo: number;
  readonly bytesPorSegundo: number;
  /** Momento da observacao no sensor, em ISO-8601. Apenas informativo. */
  readonly detectadoEm: string;
}

/**
 * METADADOS DE RASTREABILIDADE CAUSAL (R2).
 *
 * Respondem tres perguntas sobre cada mensagem:
 * quem gerou, em que ponto da linha do tempo logica, e por causa de que.
 */
export interface MetadadosCausais {
  /** Quem emitiu esta mensagem: "sensor-01", "gateway", "worker-2"... */
  readonly origemId: string;

  /**
   * CARIMBO DE LAMPORT (R4) — a posicao do evento na linha do tempo LOGICA.
   *
   * Ja declarado aqui de proposito para o contrato nao mudar na Etapa 4.
   * Ate la circula com valor 0 (placeholder); a partir da Etapa 4 passa a ser
   * atualizado pela regra L(e') = max(L(e), L(m)) + 1.
   */
  readonly lamport: number;

  /**
   * Relogio FISICO (ISO-8601), apenas para leitura humana no log.
   *
   * Atencao (ponto de defesa): este campo NAO serve para ordenar eventos entre
   * maquinas diferentes — relogios fisicos divergem entre si. Ordenar e o papel
   * do carimbo de Lamport acima. Os dois campos coexistem justamente para
   * evidenciar essa diferenca nos logs.
   */
  readonly emitidoEm: string;

  /**
   * Amarra todos os eventos de uma MESMA cadeia causal (o mesmo ataque):
   * alerta do sensor -> processamento no worker -> consolidacao do lider.
   * Permite reconstruir a historia completa filtrando por um unico valor.
   */
  readonly correlacaoId: string;

  /**
   * Id da mensagem que CAUSOU esta (a aresta causal explicita: "aconteceu depois
   * de, e por causa de"). `null` quando a mensagem inicia a cadeia — caso do
   * alerta original, que nasce da observacao do sensor e nao de outra mensagem.
   */
  readonly causaId: string | null;
}

/**
 * ENVELOPE — o que efetivamente e publicado na fila.
 *
 * Generico no payload para que a mesma estrutura sirva a outros tipos de
 * mensagem mais adiante (ex.: o registro de bloqueio consolidado pelo lider),
 * sem duplicar os metadados.
 */
export interface Envelope<TPayload> {
  /**
   * IDENTIFICADOR UNICO (R2). Gerado com crypto.randomUUID() do proprio Node.
   * E o que permite detectar mensagem duplicada — importante no R6, em que a
   * entrega e "pelo menos uma vez" (at-least-once) e reprocessamento pode ocorrer.
   */
  readonly id: string;

  /** O conteudo em si. */
  readonly payload: TPayload;

  /** Dados de controle e rastreabilidade. */
  readonly metadados: MetadadosCausais;
}

/** Atalho para o unico tipo de envelope em uso nesta etapa. */
export type EnvelopeAlerta = Envelope<AlertaAnomalia>;
