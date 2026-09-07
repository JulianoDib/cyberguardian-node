/**
 * CANAL DE COORDENACAO entre os workers — transporte do algoritmo Bully (R5).
 *
 * Este arquivo cuida apenas de LEVAR E TRAZER mensagens. O algoritmo em si
 * (quem vira lider, quando) esta em `bully.ts`.
 *
 * ESCOLHA DE TRANSPORTE: TCP com CONEXAO POR MENSAGEM — abre, envia, recebe a
 * resposta, fecha. Sem pool, sem reconexao, sem estado de conexao.
 *
 *  - O grande defeito do TCP em malha entre nos e o gerenciamento de conexoes;
 *    conexao por mensagem elimina isso por completo.
 *  - Em troca ganhamos o `ECONNREFUSED`: ao conectar num processo morto, o
 *    sistema operacional responde IMEDIATAMENTE "nao ha ninguem nessa porta".
 *    E evidencia direta de queda, e nao um palpite por ausencia de resposta.
 *  - O canal e totalmente INDEPENDENTE do Kafka: uma falha do broker nao
 *    afeta a deteccao de queda de worker, e vice-versa.
 *
 * Alternativa mais canonica descartada: UDP (ver 03-DECISOES.md).
 *
 * DETALHE DO PROTOCOLO: como cada mensagem abre a propria conexao, o "OK" do
 * Bully e realizado como a RESPOSTA a requisicao ELECTION, na mesma conexao.
 * As mensagens do algoritmo sao as mesmas; muda so como o transporte as
 * materializa — e a espera pelo OK vira o timeout da propria requisicao.
 */

import net from "node:net";

import { codificarQuadro, DecodificadorDeQuadros } from "../compartilhado/framing";
import { HOST_COORDENACAO } from "../compartilhado/rede";
import { ehRecomendacaoBloqueio } from "../compartilhado/tipos";
import type { RecomendacaoBloqueio } from "../compartilhado/tipos";

// ---------------------------------------------------------------------------
// Protocolo
// ---------------------------------------------------------------------------

/**
 * As mensagens do canal.
 *
 * Uniao discriminada por `tipo`: o TypeScript estreita sozinho e impede ler um
 * campo que nao existe naquele ramo.
 *
 * Carregam `lamport` as mensagens de coordenacao com significado causal
 * (ELECTION / OK / COORDINATOR). HEARTBEAT e VIVO NAO carregam: sao sondagem
 * periodica de vida, infraestrutura — mesmo criterio que excluiu o commit de
 * offset do relogio.
 */
export type MensagemCoordenacao =
  | { readonly tipo: "ELECTION"; readonly de: number; readonly lamport: number }
  | { readonly tipo: "OK"; readonly de: number; readonly lamport: number }
  | { readonly tipo: "COORDINATOR"; readonly de: number; readonly lamport: number }
  | { readonly tipo: "ACK"; readonly de: number }
  | { readonly tipo: "HEARTBEAT"; readonly de: number }
  | { readonly tipo: "VIVO"; readonly de: number; readonly lider: number | null }
  | {
      readonly tipo: "RECOMENDACAO";
      readonly de: number;
      readonly lamport: number;
      readonly recomendacao: RecomendacaoBloqueio;
    };

/** Por que uma tentativa de comunicacao falhou. */
export type CausaFalha =
  /** ECONNREFUSED: nao ha processo ouvindo. Evidencia direta de queda. */
  | "RECUSADA"
  /** Conectou mas nao respondeu a tempo. Pode ser um no vivo porem lento. */
  | "TIMEOUT"
  /** Respondeu algo que nao e uma mensagem valida do protocolo. */
  | "PROTOCOLO"
  /** Qualquer outra falha de rede. */
  | "ERRO";

export class ErroDeCoordenacao extends Error {
  public constructor(
    public readonly causa: CausaFalha,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ErroDeCoordenacao";
  }
}

/** Valida o que chegou pela rede antes de tratar como mensagem do protocolo. */
export function ehMensagemCoordenacao(valor: unknown): valor is MensagemCoordenacao {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }

  const campos = valor as Record<string, unknown>;
  const tipo = campos["tipo"];
  const de = campos["de"];

  if (typeof de !== "number" || !Number.isInteger(de)) {
    return false;
  }

  const lamport = campos["lamport"];
  const temLamportValido = typeof lamport === "number" && Number.isInteger(lamport) && lamport >= 0;

  switch (tipo) {
    case "ELECTION":
    case "OK":
    case "COORDINATOR":
      return temLamportValido;
    case "RECOMENDACAO":
      return temLamportValido && ehRecomendacaoBloqueio(campos["recomendacao"]);
    case "ACK":
    case "HEARTBEAT":
      return true;
    case "VIVO": {
      const lider = campos["lider"];
      return lider === null || (typeof lider === "number" && Number.isInteger(lider));
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Cliente: uma conexao por mensagem
// ---------------------------------------------------------------------------

/**
 * Envia UMA mensagem e devolve a resposta.
 *
 * Abre a conexao, escreve o quadro, espera um quadro de volta, fecha. Nao ha
 * estado mantido entre chamadas.
 *
 * @throws {ErroDeCoordenacao} com `causa` dizendo o que houve — em especial
 *   "RECUSADA" (o destino esta morto) versus "TIMEOUT" (pode estar so lento).
 *   A distincao importa para o log da deteccao de falha.
 */
export async function enviarMensagem(
  porta: number,
  mensagem: MensagemCoordenacao,
  timeoutMs: number
): Promise<MensagemCoordenacao> {
  return new Promise<MensagemCoordenacao>((resolver, rejeitar) => {
    const socket = net.connect(porta, HOST_COORDENACAO);
    const decodificador = new DecodificadorDeQuadros();
    let finalizado = false;

    /** Garante resolucao unica e fechamento do socket em qualquer caminho. */
    const finalizar = (erro: ErroDeCoordenacao | null, resposta?: MensagemCoordenacao): void => {
      if (finalizado) {
        return;
      }
      finalizado = true;
      socket.destroy();
      if (erro !== null) {
        rejeitar(erro);
      } else if (resposta !== undefined) {
        resolver(resposta);
      }
    };

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      socket.write(codificarQuadro(mensagem));
    });

    socket.on("data", (pedaco: Buffer) => {
      let quadros: string[];
      try {
        quadros = decodificador.receber(pedaco);
      } catch {
        finalizar(new ErroDeCoordenacao("PROTOCOLO", "quadro invalido na resposta"));
        return;
      }

      const primeiro = quadros[0];
      if (primeiro === undefined) {
        // Resposta ainda incompleta: espera o proximo pedaco.
        return;
      }

      let valor: unknown;
      try {
        valor = JSON.parse(primeiro);
      } catch {
        finalizar(new ErroDeCoordenacao("PROTOCOLO", "resposta nao e JSON"));
        return;
      }

      if (!ehMensagemCoordenacao(valor)) {
        finalizar(new ErroDeCoordenacao("PROTOCOLO", "resposta fora do protocolo"));
        return;
      }

      finalizar(null, valor);
    });

    socket.on("timeout", () => {
      finalizar(new ErroDeCoordenacao("TIMEOUT", `sem resposta em ${timeoutMs} ms`));
    });

    socket.on("error", (erro: Error) => {
      const codigo = (erro as NodeJS.ErrnoException).code;
      // ECONNREFUSED: o sistema operacional afirma que nao ha ninguem ouvindo.
      const causa: CausaFalha = codigo === "ECONNREFUSED" ? "RECUSADA" : "ERRO";
      finalizar(new ErroDeCoordenacao(causa, `${codigo ?? "erro"}: ${erro.message}`));
    });

    socket.on("close", () => {
      finalizar(new ErroDeCoordenacao("ERRO", "conexao fechada sem resposta"));
    });
  });
}

// ---------------------------------------------------------------------------
// Servidor: recebe uma mensagem, responde, encerra
// ---------------------------------------------------------------------------

export type TratadorMensagem = (
  mensagem: MensagemCoordenacao
) => Promise<MensagemCoordenacao> | MensagemCoordenacao;

export class ServidorCoordenacao {
  private servidor: net.Server | null = null;

  public constructor(
    private readonly porta: number,
    private readonly tratador: TratadorMensagem
  ) {}

  public async iniciar(): Promise<void> {
    const servidor = net.createServer((socket: net.Socket) => {
      const decodificador = new DecodificadorDeQuadros();
      let respondido = false;

      socket.setTimeout(5_000);

      socket.on("data", (pedaco: Buffer) => {
        if (respondido) {
          return;
        }

        let quadros: string[];
        try {
          quadros = decodificador.receber(pedaco);
        } catch {
          socket.destroy();
          return;
        }

        const primeiro = quadros[0];
        if (primeiro === undefined) {
          return;
        }

        let valor: unknown;
        try {
          valor = JSON.parse(primeiro);
        } catch {
          socket.destroy();
          return;
        }

        if (!ehMensagemCoordenacao(valor)) {
          socket.destroy();
          return;
        }

        respondido = true;
        // O tratador pode ser assincrono; a resposta sai quando ele resolver.
        void Promise.resolve(this.tratador(valor))
          .then((resposta) => {
            if (!socket.destroyed) {
              socket.write(codificarQuadro(resposta), () => {
                socket.end();
              });
            }
          })
          .catch(() => {
            socket.destroy();
          });
      });

      socket.on("timeout", () => socket.destroy());
      // Um par que morre no meio da troca nao pode derrubar este processo.
      socket.on("error", () => socket.destroy());
    });

    await new Promise<void>((resolver, rejeitar) => {
      servidor.once("error", rejeitar);
      servidor.listen(this.porta, HOST_COORDENACAO, () => {
        servidor.removeListener("error", rejeitar);
        resolver();
      });
    });

    // Depois de escutando, erros do servidor nao podem derrubar o processo.
    servidor.on("error", () => undefined);
    this.servidor = servidor;
  }

  public parar(): void {
    this.servidor?.close();
    this.servidor = null;
  }
}
