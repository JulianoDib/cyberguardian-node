/**
 * CONSOLIDACAO DO LOTE DE ANOMALIAS (R5).
 *
 * O tema exige: "o Worker Lider seja o UNICO a consolidar o lote de anomalias e
 * ordenar ao firewall que execute o bloqueio, SEM EMITIR COMANDOS DUPLICADOS".
 *
 * Isso e garantido em dois niveis:
 *
 *   1. UM SO EMISSOR — o Bully garante um lider; seguidores apenas RECOMENDAM.
 *      A ausencia de linhas "FIREWALL" nos logs dos seguidores e a prova.
 *   2. DEDUPLICACAO POR IP — dentro do lote, N recomendacoes do mesmo atacante
 *      viram UM comando. E o lider guarda os IPs ja bloqueados, para um lote
 *      posterior nao reemitir o mesmo comando.
 *
 * Este arquivo tem as duas metades do fluxo:
 *
 *   EnviadorDeRecomendacoes  — lado do SEGUIDOR (e do lider, localmente)
 *   Consolidador             — lado do LIDER
 */

import { randomUUID } from "node:crypto";

import { RegistradorAuditoria } from "../compartilhado/auditoria";
import { RelogioLamport } from "../compartilhado/lamport";
import {
  INTERVALO_CONSOLIDACAO_MS,
  TIMEOUT_RESPOSTA_MS,
  enderecoDoWorker,
} from "../compartilhado/rede";
import type { RecomendacaoBloqueio, RegistroBloqueio } from "../compartilhado/tipos";
import { ErroDeCoordenacao, enviarMensagem } from "./coordenacao";

// ---------------------------------------------------------------------------
// Lado do LIDER
// ---------------------------------------------------------------------------

export class Consolidador {
  /** Recomendacoes recebidas e ainda nao consolidadas. */
  private pendentes: RecomendacaoBloqueio[] = [];

  /**
   * IPs ja bloqueados em lotes anteriores.
   *
   * E o que impede reemitir o mesmo comando ao firewall num proximo lote —
   * a segunda camada do "sem comandos duplicados".
   */
  private readonly ipsJaBloqueados = new Set<string>();

  /** Historico dos registros emitidos por este lider. */
  private readonly registros: RegistroBloqueio[] = [];

  private loteAtual = 0;
  private temporizador: NodeJS.Timeout | null = null;
  private ativo = false;

  public constructor(
    private readonly meuId: number,
    private readonly relogio: RelogioLamport,
    private readonly auditoria: RegistradorAuditoria,
    private readonly log: (mensagem: string) => void
  ) {}

  public get totalRegistros(): number {
    return this.registros.length;
  }

  public get totalBloqueados(): number {
    return this.ipsJaBloqueados.size;
  }

  /** Aceita uma recomendacao no lote em formacao. */
  public receber(recomendacao: RecomendacaoBloqueio): void {
    this.pendentes.push(recomendacao);
  }

  /** Passa a fechar lotes periodicamente. Chamado ao assumir a lideranca. */
  public iniciar(): void {
    if (this.ativo) {
      return;
    }
    this.ativo = true;
    this.log(`LOTE      consolidacao ATIVA (lider) | fechando lote a cada ${INTERVALO_CONSOLIDACAO_MS} ms`);
    this.agendar();
  }

  /** Para de consolidar. Chamado ao deixar a lideranca. */
  public parar(): void {
    if (!this.ativo) {
      return;
    }
    this.ativo = false;
    if (this.temporizador !== null) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }
    this.log("LOTE      consolidacao INATIVA (nao sou mais o lider)");
  }

  private agendar(): void {
    if (!this.ativo) {
      return;
    }
    this.temporizador = setTimeout(() => {
      this.fecharLote();
    }, INTERVALO_CONSOLIDACAO_MS);
  }

  /**
   * Fecha o lote: agrupa por IP, emite um comando por IP ainda nao bloqueado,
   * e produz um RegistroBloqueio para cada comando.
   */
  private fecharLote(): void {
    if (this.pendentes.length === 0) {
      this.agendar();
      return;
    }

    this.loteAtual += 1;
    const lote = this.pendentes;
    this.pendentes = [];

    const workersDistintos = new Set(lote.map((r) => r.detectadoPor));
    this.log(
      `LOTE      fechando lote #${this.loteAtual} | ${lote.length} recomendacao(oes) ` +
        `de ${workersDistintos.size} worker(s)`
    );

    // --- DEDUPLICACAO: agrupa as recomendacoes por IP atacante ---
    const porIp = new Map<string, RecomendacaoBloqueio[]>();
    for (const recomendacao of lote) {
      const lista = porIp.get(recomendacao.ipOrigem) ?? [];
      lista.push(recomendacao);
      porIp.set(recomendacao.ipOrigem, lista);
    }

    this.log(
      `LOTE      dedup por IP: ${lote.length} recomendacao(oes) -> ${porIp.size} IP(s) distinto(s)`
    );

    // UM evento de Lamport por LOTE: fechar o lote e uma unica acao do lider.
    // Todos os RegistroBloqueio do lote compartilham este carimbo.
    const antes = this.relogio.valor;
    const carimbo = this.relogio.eventoInterno();
    const consolidadoEm = new Date().toISOString();

    let emitidos = 0;
    let suprimidos = 0;

    for (const [ip, recomendacoes] of porIp) {
      if (this.ipsJaBloqueados.has(ip)) {
        suprimidos += 1;
        this.log(`LOTE      ${ip} JA BLOQUEADO em lote anterior — comando SUPRIMIDO (sem duplicata)`);
        continue;
      }

      const registro: RegistroBloqueio = {
        id: randomUUID(),
        loteId: this.loteAtual,
        ipBloqueado: ip,
        emitidoPor: this.meuId,
        lamport: carimbo,
        alertasQueMotivaram: recomendacoes.map((r) => r.alertaId),
        quantidadeAlertas: recomendacoes.length,
        consolidadoEm,
      };

      this.ipsJaBloqueados.add(ip);
      this.registros.push(registro);
      emitidos += 1;

      // O firewall e SIMULADO: o comando e esta linha de log.
      this.log(
        `FIREWALL  >>> BLOQUEAR ${ip} (motivado por ${registro.quantidadeAlertas} alerta(s)) ` +
          `[lote #${this.loteAtual} | registro ${registro.id.slice(0, 8)}]`
      );
    }

    this.auditoria.registrar({
      lamport: carimbo,
      tipo: "CONSOLIDA",
      calculo: `interno: ${antes}+1 = ${carimbo}`,
      detalhe:
        `lote #${this.loteAtual}: ${lote.length} rec -> ${porIp.size} IP -> ` +
        `${emitidos} bloqueio(s), ${suprimidos} suprimido(s)`,
      mensagemId: null,
    });

    this.log(
      `LOTE      lote #${this.loteAtual} consolidado | ${emitidos} RegistroBloqueio novo(s) | ` +
        `total de IPs bloqueados: ${this.ipsJaBloqueados.size}`
    );

    this.agendar();
  }
}

// ---------------------------------------------------------------------------
// Lado do SEGUIDOR
// ---------------------------------------------------------------------------

/**
 * O que o enviador precisa saber sobre a lideranca.
 *
 * Interface minima (e nao a classe Bully inteira) para o `bully.ts` continuar
 * falando apenas de eleicao, sem conhecer consolidacao.
 */
export interface FonteDeLideranca {
  readonly souLider: boolean;
  readonly lider: number | null;
}

export class EnviadorDeRecomendacoes {
  /** Recomendacoes ainda nao entregues ao lider. */
  private pendentes: RecomendacaoBloqueio[] = [];

  /** Teto do acumulo, para nao crescer sem limite se o lider ficar ausente. */
  private static readonly LIMITE_PENDENTES = 200;

  public constructor(
    private readonly meuId: number,
    private readonly fonte: FonteDeLideranca,
    private readonly consolidador: Consolidador,
    private readonly relogio: RelogioLamport,
    private readonly auditoria: RegistradorAuditoria,
    private readonly log: (mensagem: string) => void
  ) {}

  public get totalPendentes(): number {
    return this.pendentes.length;
  }

  /** Registra uma recomendacao e tenta despachar tudo que estiver pendente. */
  public async enviar(recomendacao: RecomendacaoBloqueio): Promise<void> {
    this.pendentes.push(recomendacao);
    if (this.pendentes.length > EnviadorDeRecomendacoes.LIMITE_PENDENTES) {
      this.pendentes.shift();
      this.log("RECOMENDACAO acumulo no limite — descartando a mais antiga");
    }
    await this.despachar();
  }

  /**
   * Tenta entregar as pendentes.
   *
   * Chamado tambem quando o papel muda: recomendacoes acumuladas durante uma
   * eleicao (sem lider conhecido) sao despachadas assim que houver lider.
   */
  public async despachar(): Promise<void> {
    if (this.pendentes.length === 0) {
      return;
    }

    // Sou o lider: entrega direta, sem passar pela rede.
    if (this.fonte.souLider) {
      const fila = this.pendentes;
      this.pendentes = [];
      for (const recomendacao of fila) {
        this.consolidador.receber(recomendacao);
      }
      this.log(`RECOMENDACAO ${fila.length} entregue(s) localmente (eu sou o lider)`);
      return;
    }

    const lider = this.fonte.lider;
    if (lider === null) {
      this.log(
        `RECOMENDACAO sem lider conhecido — ${this.pendentes.length} pendente(s), aguardando eleicao`
      );
      return;
    }

    const endereco = enderecoDoWorker(lider);
    if (endereco === undefined) {
      return;
    }

    while (this.pendentes.length > 0) {
      const recomendacao = this.pendentes[0];
      if (recomendacao === undefined) {
        break;
      }

      // Regra 2 de Lamport. O incremento acontece na TENTATIVA de envio: o
      // evento de envio ocorreu, ainda que a entrega falhe.
      const antes = this.relogio.valor;
      const carimbo = this.relogio.aoEnviar();

      try {
        await enviarMensagem(
          endereco.porta,
          {
            tipo: "RECOMENDACAO",
            de: this.meuId,
            lamport: carimbo,
            recomendacao,
          },
          TIMEOUT_RESPOSTA_MS
        );

        this.auditoria.registrar({
          lamport: carimbo,
          tipo: "RECOMENDACAO-ENVIA",
          calculo: `envio: ${antes}+1 = ${carimbo}`,
          detalhe: `RECOMENDACAO ${recomendacao.ipOrigem} -> lider ${lider}`,
          mensagemId: recomendacao.alertaId,
        });

        this.pendentes.shift();
      } catch (erro: unknown) {
        const causa = erro instanceof ErroDeCoordenacao ? erro.causa : "ERRO";
        this.log(
          `RECOMENDACAO -> lider ${lider} : FALHOU (${causa}) — ` +
            `${this.pendentes.length} pendente(s), tentarei de novo`
        );
        return;
      }
    }
  }
}
