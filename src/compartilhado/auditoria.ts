/**
 * LOG DE AUDITORIA com carimbo de Lamport (R4).
 *
 * Cada processo escreve o SEU proprio arquivo em `logs/auditoria-<processo>.jsonl`
 * (uma linha JSON por evento). Arquivos separados, e nao um compartilhado, por
 * dois motivos:
 *
 *  - escrita concorrente de varios processos no mesmo arquivo pode intercalar e
 *    corromper linhas;
 *  - separados, reproduzem exatamente o cenario que Lamport endereca: registros
 *    locais independentes que precisam ser reconciliados DEPOIS.
 *
 * A ferramenta `demonstracoes/ordenar-auditoria.mjs` faz a reconciliacao.
 *
 * NOTA: isto e log de auditoria em arquivo. Nao e a persistencia primario+replica
 * exigida pela Etapa 7 — sao coisas diferentes.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Pasta dos logs (ja ignorada pelo git desde a Etapa 0). */
const PASTA_LOGS = "logs";

/** Os eventos que fazem o relogio avancar, em todo o sistema. */
export type TipoEvento =
  | "RECEBE-SENSOR"
  | "PUBLICA-FILA"
  | "ENVIA-ACK"
  | "RECEBE-FILA"
  | "PROCESSA";

/** Uma linha do log de auditoria. */
export interface RegistroAuditoria {
  readonly processo: string;
  /** Carimbo LOGICO do evento. */
  readonly lamport: number;
  readonly tipo: TipoEvento;
  /**
   * Carimbo FISICO (relogio de parede) do mesmo evento.
   *
   * Guardado lado a lado com o logico de proposito: e o contraste entre os dois
   * que evidencia o trade-off cobrado na defesa.
   */
  readonly instanteFisico: string;
  /** A conta feita, em texto. Ex.: "max(local=4, msg=11)+1 = 12". */
  readonly calculo: string;
  readonly detalhe: string;
  readonly mensagemId: string | null;
}

/** Dados que o chamador fornece; processo e instante sao preenchidos aqui. */
export interface EntradaAuditoria {
  readonly lamport: number;
  readonly tipo: TipoEvento;
  readonly calculo: string;
  readonly detalhe: string;
  readonly mensagemId: string | null;
}

export class RegistradorAuditoria {
  private readonly caminho: string;

  public constructor(private readonly processo: string) {
    mkdirSync(PASTA_LOGS, { recursive: true });
    this.caminho = join(PASTA_LOGS, `auditoria-${processo}.jsonl`);
    // Trunca ao iniciar: cada execucao da demonstracao comeca limpa.
    writeFileSync(this.caminho, "", "utf8");
  }

  /** Caminho do arquivo, para o processo informar no log de inicializacao. */
  public get arquivo(): string {
    return this.caminho;
  }

  /**
   * Registra um evento no console E no arquivo, de uma vez so.
   *
   * Uma unica chamada para os dois destinos e proposital: se fossem chamadas
   * separadas, console e auditoria poderiam divergir e a demonstracao perderia
   * o valor de prova.
   *
   * Escrita SINCRONA: acontece logo apos o incremento do relogio, sem `await`
   * no meio, entao o registro nunca sai de ordem em relacao ao contador. E I/O
   * bloqueante — aceitavel neste volume; em producao seria bufferizado.
   */
  public registrar(entrada: EntradaAuditoria): void {
    const registro: RegistroAuditoria = {
      processo: this.processo,
      instanteFisico: new Date().toISOString(),
      lamport: entrada.lamport,
      tipo: entrada.tipo,
      calculo: entrada.calculo,
      detalhe: entrada.detalhe,
      mensagemId: entrada.mensagemId,
    };

    // Marcador "LAMPORT" para extrair a evidencia com `grep LAMPORT`.
    console.log(
      `[${this.processo}] LAMPORT ` +
        `${`L=${registro.lamport}`.padEnd(7)}` +
        `${registro.tipo.padEnd(14)}` +
        `${registro.calculo.padEnd(30)}` +
        `${registro.detalhe}`
    );

    appendFileSync(this.caminho, `${JSON.stringify(registro)}\n`, "utf8");
  }
}
