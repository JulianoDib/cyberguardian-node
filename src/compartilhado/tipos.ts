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

// ---------------------------------------------------------------------------
// RESPOSTAS DO GATEWAY AO SENSOR — protocolo do Ponto de Entrada (R1)
// ---------------------------------------------------------------------------

/**
 * ACK DE ENFILEIRAMENTO: o alerta ja esta na fila do Kafka.
 *
 * So e enviado DEPOIS que o broker confirma a gravacao. Um ACK enviado antes
 * disso poderia mentir para o sensor se a publicacao falhasse em seguida.
 */
export interface AckEnfileiramento {
  readonly tipo: "ACK";
  /** Id do envelope gerado pelo gateway (o sensor nao o conhecia antes). */
  readonly id: string;
  /** Particao em que o Kafka gravou — util para evidenciar o R3 nos logs. */
  readonly particao: number;
  /** Posicao da mensagem dentro da particao. */
  readonly offset: string;
}

/** Recusa: o alerta NAO foi enfileirado. */
export interface ErroGateway {
  readonly tipo: "ERRO";
  readonly motivo: string;
}

/**
 * Uniao DISCRIMINADA pelo campo `tipo`.
 *
 * Ao testar `resposta.tipo === "ACK"`, o TypeScript estreita o tipo sozinho e
 * libera o acesso a `id`/`particao`/`offset`; no ramo do erro, so `motivo`
 * existe. Isso torna impossivel ler um campo que nao esta ali.
 */
export type RespostaGateway = AckEnfileiramento | ErroGateway;

// ---------------------------------------------------------------------------
// VALIDACAO DE ENTRADA NAO CONFIAVEL
// ---------------------------------------------------------------------------

const PROTOCOLOS_VALIDOS: readonly string[] = ["TCP", "UDP", "ICMP"];

/**
 * Confirma que um valor vindo da rede tem mesmo o formato de AlertaAnomalia.
 *
 * `JSON.parse` devolve algo sem nenhuma garantia de formato: um sensor com
 * defeito pode mandar campos faltando ou com o tipo errado. Esta funcao e um
 * "type guard" — o `valor is AlertaAnomalia` no retorno faz o TypeScript
 * tratar o valor como AlertaAnomalia apenas dentro do ramo verdadeiro.
 *
 * Sem isso, a tipagem estatica seria uma ficcao na fronteira da rede: o
 * compilador acreditaria num contrato que ninguem verificou em execucao.
 */
export function ehAlertaAnomalia(valor: unknown): valor is AlertaAnomalia {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }

  const campos = valor as Record<string, unknown>;

  return (
    typeof campos["sensorId"] === "string" &&
    typeof campos["ipOrigem"] === "string" &&
    typeof campos["ipDestino"] === "string" &&
    typeof campos["protocolo"] === "string" &&
    PROTOCOLOS_VALIDOS.includes(campos["protocolo"]) &&
    typeof campos["pacotesPorSegundo"] === "number" &&
    Number.isFinite(campos["pacotesPorSegundo"]) &&
    typeof campos["bytesPorSegundo"] === "number" &&
    Number.isFinite(campos["bytesPorSegundo"]) &&
    typeof campos["detectadoEm"] === "string"
  );
}

/**
 * Confirma que um valor lido DA FILA tem mesmo o formato de EnvelopeAlerta.
 *
 * Mesma razao do `ehAlertaAnomalia`: o conteudo do topico e apenas um texto ate
 * ser verificado. O worker nao pode confiar cegamente no que esta na fila — a
 * mensagem pode ter sido gravada por uma versao antiga do gateway, ou estar
 * truncada. Sem esta checagem, a tipagem estatica seria ficcao na fronteira.
 */
export function ehEnvelopeAlerta(valor: unknown): valor is EnvelopeAlerta {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }

  const campos = valor as Record<string, unknown>;

  if (typeof campos["id"] !== "string") {
    return false;
  }

  if (!ehAlertaAnomalia(campos["payload"])) {
    return false;
  }

  const metadados = campos["metadados"];
  if (typeof metadados !== "object" || metadados === null) {
    return false;
  }

  const meta = metadados as Record<string, unknown>;

  return (
    typeof meta["origemId"] === "string" &&
    typeof meta["lamport"] === "number" &&
    typeof meta["emitidoEm"] === "string" &&
    typeof meta["correlacaoId"] === "string" &&
    (meta["causaId"] === null || typeof meta["causaId"] === "string")
  );
}
