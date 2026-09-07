/**
 * ALGORITMO DO VALENTAO (BULLY) — eleicao de lider entre os workers (R5).
 *
 * A ideia em uma frase: o no VIVO de maior ID vence. Sempre.
 *
 * As tres mensagens:
 *
 *   ELECTION    — "estou disputando". Enviada apenas aos ids MAIORES que o meu.
 *   OK          — "existo e sou maior que voce; pode desistir". Resposta ao ELECTION.
 *   COORDINATOR — "eu venci, sou o lider". Enviada a TODOS os outros.
 *
 * A regra que decide tudo:
 *
 *   se mandei ELECTION a todos os maiores e NENHUM respondeu OK,
 *   entao nao ha ninguem maior vivo  =>  EU SOU O LIDER.
 *
 * Deteccao de queda: cada seguidor SONDA o lider periodicamente. N falhas
 * consecutivas => o lider morreu => nova eleicao.
 *
 * O relogio de Lamport (R4) acompanha ELECTION / OK / COORDINATOR, que sao
 * eventos de coordenacao com significado causal. HEARTBEAT nao incrementa: e
 * sondagem de infraestrutura, mesmo criterio que excluiu o commit de offset.
 *
 * Um BROADCAST conta como UM evento: enviar a mesma mensagem a varios pares e
 * uma unica acao do processo, e todos recebem o mesmo carimbo.
 */

import { RegistradorAuditoria } from "../compartilhado/auditoria";
import { RelogioLamport } from "../compartilhado/lamport";
import {
  FALHAS_PARA_ELEICAO,
  INTERVALO_HEARTBEAT_MS,
  TIMEOUT_COORDINATOR_MS,
  TIMEOUT_OK_MS,
  TIMEOUT_RESPOSTA_MS,
  WORKERS,
  enderecoDoWorker,
} from "../compartilhado/rede";
import type { EnderecoWorker } from "../compartilhado/rede";
import type { RecomendacaoBloqueio } from "../compartilhado/tipos";
import {
  ErroDeCoordenacao,
  ServidorCoordenacao,
  enviarMensagem,
} from "./coordenacao";
import type { MensagemCoordenacao } from "./coordenacao";

export type EstadoBully = "INICIANDO" | "EM_ELEICAO" | "LIDER" | "SEGUIDOR";

/**
 * Ganchos para quem precisa reagir ao Bully sem que o Bully conheca consolidacao.
 *
 * Mantem este arquivo falando SO de eleicao: na defesa, abrir o bully.ts e ver
 * apenas ELECTION / OK / COORDINATOR / heartbeat.
 */
export interface ObservadorBully {
  /** Este no, na condicao de LIDER, recebeu uma recomendacao de um par. */
  readonly aoReceberRecomendacao: (recomendacao: RecomendacaoBloqueio) => void;
  /** O papel deste no mudou: virou lider, ou deixou de ser. */
  readonly aoMudarPapel: (souLider: boolean) => void;
}

export class Bully {
  private estado: EstadoBully = "INICIANDO";
  private liderAtual: number | null = null;

  /** Falhas CONSECUTIVAS de sondagem do lider. Zera a cada sucesso. */
  private falhasConsecutivas = 0;

  /** Evita duas eleicoes simultaneas no mesmo processo. */
  private eleicaoEmAndamento = false;

  private temporizadorSondagem: NodeJS.Timeout | null = null;
  private temporizadorCoordinator: NodeJS.Timeout | null = null;

  private readonly servidor: ServidorCoordenacao;
  private readonly meuEndereco: EnderecoWorker;
  /** Todos os outros participantes (a composicao do grupo, menos eu). */
  private readonly pares: readonly EnderecoWorker[];

  private encerrando = false;

  private observador: ObservadorBully | null = null;

  public constructor(
    private readonly meuId: number,
    private readonly relogio: RelogioLamport,
    private readonly auditoria: RegistradorAuditoria,
    private readonly log: (mensagem: string) => void
  ) {
    const endereco = enderecoDoWorker(meuId);
    if (endereco === undefined) {
      throw new Error(`worker ${meuId} nao esta na composicao do grupo (rede.ts)`);
    }
    this.meuEndereco = endereco;
    this.pares = WORKERS.filter((worker) => worker.id !== meuId);
    this.servidor = new ServidorCoordenacao(endereco.porta, (mensagem) =>
      this.tratarMensagem(mensagem)
    );
  }

  /** Registra quem reage a mudanca de papel e a chegada de recomendacoes. */
  public observar(observador: ObservadorBully): void {
    this.observador = observador;
  }

  public get souLider(): boolean {
    return this.estado === "LIDER";
  }

  public get lider(): number | null {
    return this.liderAtual;
  }

  /** Sobe o canal de coordenacao e dispara a eleicao inicial. */
  public async iniciar(): Promise<void> {
    await this.servidor.iniciar();
    this.log(
      `BULLY  canal de coordenacao ouvindo na porta ${this.meuEndereco.porta} | meu id=${this.meuId}`
    );
    this.log(
      `BULLY  composicao do grupo: [${WORKERS.map((w) => `${w.id}:${w.porta}`).join(", ")}]`
    );
    await this.iniciarEleicao("subida do processo");
  }

  public parar(): void {
    this.encerrando = true;
    this.cancelarSondagem();
    this.cancelarEsperaCoordinator();
    this.servidor.parar();
  }

  // -------------------------------------------------------------------------
  // Eleicao
  // -------------------------------------------------------------------------

  /**
   * Executa uma rodada do Bully.
   *
   * 1. Manda ELECTION a todos os ids MAIORES.
   * 2. Se nenhum responder OK dentro do prazo, EU SOU O LIDER.
   * 3. Se algum responder OK, existe alguem maior vivo: aguardo o COORDINATOR
   *    dele. Se nao vier, recomeco (ele deve ter caido no meio da eleicao).
   */
  public async iniciarEleicao(motivo: string): Promise<void> {
    if (this.eleicaoEmAndamento || this.encerrando) {
      return;
    }
    this.eleicaoEmAndamento = true;
    this.estado = "EM_ELEICAO";
    this.cancelarSondagem();
    this.cancelarEsperaCoordinator();

    this.log(`BULLY  >>> INICIANDO ELEICAO (motivo: ${motivo})`);

    const maiores = this.pares.filter((par) => par.id > this.meuId);

    // Caso trivial: sou o maior da composicao. Nao ha a quem perguntar.
    if (maiores.length === 0) {
      this.log(`BULLY  nenhum id maior que ${this.meuId} na composicao`);
      this.eleicaoEmAndamento = false;
      await this.declararLideranca();
      return;
    }

    // UM evento de envio para o broadcast inteiro: todos recebem o mesmo carimbo.
    const antes = this.relogio.valor;
    const carimbo = this.relogio.aoEnviar();
    this.auditoria.registrar({
      lamport: carimbo,
      tipo: "ELECTION-ENVIA",
      calculo: `envio: ${antes}+1 = ${carimbo}`,
      detalhe: `ELECTION -> [${maiores.map((m) => m.id).join(", ")}]`,
      mensagemId: null,
    });

    const respostas = await Promise.all(
      maiores.map(async (maior) => this.enviarEleicaoPara(maior, carimbo))
    );

    const algumRespondeuOk = respostas.some((resposta) => resposta !== null);

    if (!algumRespondeuOk) {
      this.log(`BULLY  nenhum OK em ${TIMEOUT_OK_MS} ms — nao ha ninguem maior vivo`);
      this.eleicaoEmAndamento = false;
      await this.declararLideranca();
      return;
    }

    // Existe alguem maior vivo. Ele assume a eleicao a partir daqui.
    this.log(`BULLY  existe no maior vivo — aguardo COORDINATOR por ${TIMEOUT_COORDINATOR_MS} ms`);
    this.eleicaoEmAndamento = false;
    this.aguardarCoordinator();
  }

  /** Envia ELECTION a um par. Devolve o OK recebido, ou null se falhou. */
  private async enviarEleicaoPara(
    maior: EnderecoWorker,
    carimbo: number
  ): Promise<MensagemCoordenacao | null> {
    try {
      const resposta = await enviarMensagem(
        maior.porta,
        { tipo: "ELECTION", de: this.meuId, lamport: carimbo },
        TIMEOUT_OK_MS
      );

      if (resposta.tipo !== "OK") {
        this.log(`BULLY  ELECTION -> worker-${maior.id} : resposta inesperada (${resposta.tipo})`);
        return null;
      }

      // Recepcao do OK: regra 3 do Lamport.
      const antes = this.relogio.valor;
      const novo = this.relogio.aoReceber(resposta.lamport);
      this.auditoria.registrar({
        lamport: novo,
        tipo: "OK-RECEBE",
        calculo: `max(local=${antes}, msg=${resposta.lamport})+1 = ${novo}`,
        detalhe: `<- OK de worker-${maior.id}`,
        mensagemId: null,
      });

      this.log(`BULLY  <- OK de worker-${maior.id} : ele esta vivo e e maior`);
      return resposta;
    } catch (erro: unknown) {
      const causa = erro instanceof ErroDeCoordenacao ? erro.causa : "ERRO";
      this.log(`BULLY  ELECTION -> worker-${maior.id} (${maior.porta}) : FALHOU (${causa})`);
      return null;
    }
  }

  /** Assume a lideranca e anuncia a todos. */
  private async declararLideranca(): Promise<void> {
    this.estado = "LIDER";
    this.liderAtual = this.meuId;
    this.falhasConsecutivas = 0;
    this.cancelarSondagem();
    this.cancelarEsperaCoordinator();

    this.log(`BULLY  >>> EU SOU O LIDER (id=${this.meuId})`);

    // UM evento para o broadcast do COORDINATOR.
    const antes = this.relogio.valor;
    const carimbo = this.relogio.aoEnviar();
    this.auditoria.registrar({
      lamport: carimbo,
      tipo: "COORDINATOR-ENVIA",
      calculo: `envio: ${antes}+1 = ${carimbo}`,
      detalhe: `COORDINATOR -> [${this.pares.map((p) => p.id).join(", ")}]`,
      mensagemId: null,
    });

    // Melhor esforco: pares mortos apenas falham, sem abortar o anuncio.
    await Promise.all(
      this.pares.map(async (par) => {
        try {
          await enviarMensagem(
            par.porta,
            { tipo: "COORDINATOR", de: this.meuId, lamport: carimbo },
            TIMEOUT_RESPOSTA_MS
          );
          this.log(`BULLY  COORDINATOR -> worker-${par.id} : entregue`);
        } catch (erro: unknown) {
          const causa = erro instanceof ErroDeCoordenacao ? erro.causa : "ERRO";
          this.log(`BULLY  COORDINATOR -> worker-${par.id} : FALHOU (${causa})`);
        }
      })
    );

    this.log(`BULLY  estado=LIDER  lider=${this.meuId}`);
    this.observador?.aoMudarPapel(true);
  }

  /** Passa a seguir um lider anunciado. */
  private virarSeguidor(novoLider: number): void {
    const eraLider = this.estado === "LIDER";
    this.estado = "SEGUIDOR";
    this.liderAtual = novoLider;
    this.falhasConsecutivas = 0;
    this.cancelarEsperaCoordinator();
    this.log(
      `BULLY  estado=SEGUIDOR  lider=${novoLider}` + (eraLider ? "  (deixei de ser lider)" : "")
    );
    this.agendarSondagem();
    this.observador?.aoMudarPapel(false);
  }

  // -------------------------------------------------------------------------
  // Recepcao de mensagens (tratador do servidor)
  // -------------------------------------------------------------------------

  private async tratarMensagem(mensagem: MensagemCoordenacao): Promise<MensagemCoordenacao> {
    switch (mensagem.tipo) {
      case "ELECTION": {
        // Recepcao: regra 3.
        const antesR = this.relogio.valor;
        const novoR = this.relogio.aoReceber(mensagem.lamport);
        this.auditoria.registrar({
          lamport: novoR,
          tipo: "ELECTION-RECEBE",
          calculo: `max(local=${antesR}, msg=${mensagem.lamport})+1 = ${novoR}`,
          detalhe: `<- ELECTION de worker-${mensagem.de}`,
          mensagemId: null,
        });
        this.log(`BULLY  <- ELECTION de worker-${mensagem.de} : respondendo OK`);

        // Envio do OK.
        const antesE = this.relogio.valor;
        const carimbo = this.relogio.aoEnviar();
        this.auditoria.registrar({
          lamport: carimbo,
          tipo: "OK-ENVIA",
          calculo: `envio: ${antesE}+1 = ${carimbo}`,
          detalhe: `OK -> worker-${mensagem.de}`,
          mensagemId: null,
        });

        // Sou maior que quem perguntou, entao disputo tambem. Disparado FORA
        // do caminho da resposta para o OK sair imediatamente.
        setImmediate(() => {
          void this.iniciarEleicao(`recebi ELECTION de worker-${mensagem.de}`);
        });

        return { tipo: "OK", de: this.meuId, lamport: carimbo };
      }

      case "COORDINATOR": {
        const antes = this.relogio.valor;
        const novo = this.relogio.aoReceber(mensagem.lamport);
        this.auditoria.registrar({
          lamport: novo,
          tipo: "COORDINATOR-RECEBE",
          calculo: `max(local=${antes}, msg=${mensagem.lamport})+1 = ${novo}`,
          detalhe: `<- COORDINATOR de worker-${mensagem.de}`,
          mensagemId: null,
        });
        this.log(`BULLY  <- COORDINATOR de worker-${mensagem.de} : novo lider = ${mensagem.de}`);

        if (mensagem.de < this.meuId) {
          // Um no MENOR se declarou lider. Sou o valentao: disputo de volta.
          this.log(
            `BULLY  worker-${mensagem.de} e MENOR que eu (${this.meuId}) — vou disputar de volta`
          );
          setImmediate(() => {
            void this.iniciarEleicao(`COORDINATOR de id menor (worker-${mensagem.de})`);
          });
        } else {
          this.virarSeguidor(mensagem.de);
        }

        return { tipo: "ACK", de: this.meuId };
      }

      case "RECOMENDACAO": {
        const antes = this.relogio.valor;
        const novo = this.relogio.aoReceber(mensagem.lamport);
        this.auditoria.registrar({
          lamport: novo,
          tipo: "RECOMENDACAO-RECEBE",
          calculo: `max(local=${antes}, msg=${mensagem.lamport})+1 = ${novo}`,
          detalhe: `<- RECOMENDACAO de worker-${mensagem.de} : ${mensagem.recomendacao.ipOrigem}`,
          mensagemId: mensagem.recomendacao.alertaId,
        });

        // TRAVA CONTRA COMANDO DUPLICADO: so o lider aceita recomendacoes.
        // Se este no nao e o lider, a recomendacao e recusada — assim uma
        // mensagem atrasada, enviada a um lider ja deposto, nao entra em dois
        // lotes diferentes.
        if (this.estado !== "LIDER") {
          this.log(
            `BULLY  <- RECOMENDACAO de worker-${mensagem.de} mas NAO sou o lider — recusada`
          );
          return { tipo: "ACK", de: this.meuId };
        }

        this.observador?.aoReceberRecomendacao(mensagem.recomendacao);
        return { tipo: "ACK", de: this.meuId };
      }

      case "HEARTBEAT":
        // NAO incrementa o relogio: sondagem de vida e infraestrutura.
        return { tipo: "VIVO", de: this.meuId, lider: this.liderAtual };

      default:
        // OK / ACK / VIVO nao sao esperados como REQUISICAO, so como resposta.
        return { tipo: "ACK", de: this.meuId };
    }
  }

  // -------------------------------------------------------------------------
  // Deteccao de falha do lider
  // -------------------------------------------------------------------------

  /**
   * Agenda a proxima sondagem.
   *
   * Usa setTimeout encadeado, e nao setInterval, de proposito: assim uma
   * sondagem lenta nunca se sobrepoe a proxima.
   */
  private agendarSondagem(): void {
    this.cancelarSondagem();
    if (this.encerrando) {
      return;
    }
    this.temporizadorSondagem = setTimeout(() => {
      void this.sondarLider();
    }, INTERVALO_HEARTBEAT_MS);
  }

  private cancelarSondagem(): void {
    if (this.temporizadorSondagem !== null) {
      clearTimeout(this.temporizadorSondagem);
      this.temporizadorSondagem = null;
    }
  }

  /** Uma sondagem de vida do lider. */
  private async sondarLider(): Promise<void> {
    if (this.encerrando || this.estado !== "SEGUIDOR" || this.liderAtual === null) {
      return;
    }

    const lider = this.liderAtual;
    const endereco = enderecoDoWorker(lider);
    if (endereco === undefined) {
      return;
    }

    try {
      await enviarMensagem(
        endereco.porta,
        { tipo: "HEARTBEAT", de: this.meuId },
        TIMEOUT_RESPOSTA_MS
      );
      // Sucesso ZERA o contador: e a principal protecao contra falso positivo.
      if (this.falhasConsecutivas > 0) {
        this.log(`BULLY  heartbeat -> lider ${lider} : OK (contador de falhas zerado)`);
      }
      this.falhasConsecutivas = 0;
      this.agendarSondagem();
      return;
    } catch (erro: unknown) {
      const causa = erro instanceof ErroDeCoordenacao ? erro.causa : "ERRO";
      this.falhasConsecutivas += 1;
      this.log(
        `BULLY  heartbeat -> lider ${lider} : FALHA ${this.falhasConsecutivas}/${FALHAS_PARA_ELEICAO} (${causa})`
      );

      if (this.falhasConsecutivas >= FALHAS_PARA_ELEICAO) {
        this.log(`BULLY  >>> LIDER ${lider} CONSIDERADO MORTO`);
        this.falhasConsecutivas = 0;
        this.liderAtual = null;
        await this.iniciarEleicao(`lider ${lider} nao responde`);
        return;
      }

      this.agendarSondagem();
    }
  }

  // -------------------------------------------------------------------------
  // Espera pelo COORDINATOR
  // -------------------------------------------------------------------------

  /**
   * Depois de receber um OK, existe alguem maior vivo — ele deve anunciar.
   *
   * Se o anuncio nao vier no prazo, esse no provavelmente caiu no meio da
   * eleicao, e recomecamos. TIMEOUT_COORDINATOR_MS e maior que TIMEOUT_OK_MS
   * justamente para dar tempo de ele concluir a eleicao dele.
   */
  private aguardarCoordinator(): void {
    this.cancelarEsperaCoordinator();
    this.temporizadorCoordinator = setTimeout(() => {
      if (this.encerrando || this.estado !== "EM_ELEICAO") {
        return;
      }
      this.log(`BULLY  nenhum COORDINATOR em ${TIMEOUT_COORDINATOR_MS} ms — recomecando eleicao`);
      void this.iniciarEleicao("COORDINATOR nao chegou");
    }, TIMEOUT_COORDINATOR_MS);
  }

  private cancelarEsperaCoordinator(): void {
    if (this.temporizadorCoordinator !== null) {
      clearTimeout(this.temporizadorCoordinator);
      this.temporizadorCoordinator = null;
    }
  }
}
