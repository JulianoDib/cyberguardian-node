/**
 * PERSISTENCIA DO ESTADO CONSOLIDADO — "A Memoria Intacta" (Etapa 7).
 *
 * Grava os RegistroBloqueio produzidos pelo worker LIDER ao consolidar um lote.
 *
 * A aplicacao escreve APENAS NO PRIMARIO. A replica e mantida pelo proprio
 * PostgreSQL, por streaming replication: ela recebe o WAL do primario e fica em
 * modo standby, SOMENTE-LEITURA. Tentar escrever nela daria erro — e nao ha
 * motivo para tentar, porque a replicacao acontece na camada do banco.
 *
 * POLITICA DE FALHA:
 *
 *   falhou a gravacao -> o comando de bloqueio NAO deve ser emitido.
 *   Integridade antes de acao: um bloqueio sem registro e pior que um bloqueio
 *   adiado. Quem decide isso e o consolidador, olhando o resultado devolvido aqui.
 *
 * Usado apenas pelo consolidador — ou seja, so tem efeito quando o worker e lider.
 */

import { Pool } from "pg";
import type { QueryResult } from "pg";

import type { RegistroBloqueio } from "./tipos";

/** Endereco do primario. A replica nao e acessada pela aplicacao. */
const URL_PRIMARIO: string =
  process.env["BANCO_PRIMARIO"] ??
  "postgresql://cyberguardian:cyberguardian@localhost:5432/cyberguardian";

/** O que aconteceu ao tentar gravar um registro. */
export interface ResultadoGravacao {
  /** Se falso, o comando de bloqueio NAO deve ser emitido. */
  readonly ok: boolean;
  /** O registro ja existia (insercao idempotente, tratada como sucesso). */
  readonly jaExistia: boolean;
  readonly erro: string | null;
}

const SQL_INSERIR = `
  INSERT INTO registro_bloqueio (
    id, lote_id, ip_bloqueado, emitido_por, lamport,
    quantidade_alertas, alertas_que_motivaram, consolidado_em
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT DO NOTHING
`;

const SQL_IPS_BLOQUEADOS = `SELECT ip_bloqueado FROM registro_bloqueio`;

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

export class RepositorioBloqueios {
  private readonly primario: Pool;

  public constructor(private readonly log: (mensagem: string) => void) {
    this.primario = new Pool({
      connectionString: URL_PRIMARIO,
      // Pool pequeno e timeout curto: se o banco estiver fora, queremos falhar
      // rapido e registrar, nao pendurar o consolidador.
      max: 4,
      connectionTimeoutMillis: 5_000,
    });

    // Um erro em conexao ociosa do pool nao pode derrubar o processo.
    this.primario.on("error", (erro: Error) => {
      this.log(`BANCO  erro em conexao ociosa: ${erro.message}`);
    });
  }

  /** Confere que o primario responde, para o worker avisar cedo se algo falta. */
  public async verificarConexao(): Promise<void> {
    await this.primario.query("SELECT 1");
    this.log("BANCO  primario acessivel (a replica recebe por streaming replication)");
  }

  /**
   * Grava um registro consolidado no primario.
   *
   * `ON CONFLICT DO NOTHING` torna a operacao IDEMPOTENTE: regravar o mesmo id
   * (ou o mesmo ip_bloqueado, pela restricao UNIQUE) nao gera erro nem
   * duplicata. `rowCount === 0` significa que a linha ja existia.
   */
  public async gravar(registro: RegistroBloqueio): Promise<ResultadoGravacao> {
    try {
      const resultado: QueryResult = await this.primario.query(SQL_INSERIR, [
        registro.id,
        registro.loteId,
        registro.ipBloqueado,
        registro.emitidoPor,
        registro.lamport,
        registro.quantidadeAlertas,
        registro.alertasQueMotivaram,
        registro.consolidadoEm,
      ]);

      return { ok: true, jaExistia: resultado.rowCount === 0, erro: null };
    } catch (erro: unknown) {
      const detalhe = descreverErro(erro);
      this.log(`BANCO  FALHA ao gravar: ${detalhe}`);
      return { ok: false, jaExistia: false, erro: detalhe };
    }
  }

  /**
   * Le os IPs ja bloqueados.
   *
   * E o que da sentido a "Memoria Intacta": quando o lider morre, o conjunto de
   * IPs bloqueados que ele mantinha em memoria morre junto. O novo lider
   * RECUPERA esse estado do banco ao assumir, em vez de reemitir bloqueios que
   * ja haviam sido decididos.
   */
  public async carregarIpsBloqueados(): Promise<string[]> {
    const resultado: QueryResult<{ ip_bloqueado: string }> =
      await this.primario.query(SQL_IPS_BLOQUEADOS);
    return resultado.rows.map((linha) => linha.ip_bloqueado);
  }

  public async fechar(): Promise<void> {
    await this.primario.end();
  }
}
