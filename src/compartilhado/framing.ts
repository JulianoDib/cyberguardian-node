/**
 * FRAMING EXPLICITO por prefixo de tamanho (R1).
 *
 * O TCP entrega um FLUXO DE BYTES, nao um fluxo de mensagens: ele garante que
 * os bytes chegam na ordem, mas NAO garante que cada leitura corresponda a uma
 * escrita do outro lado. Sem enquadramento, duas coisas quebram o receptor:
 *
 *   - AGLUTINACAO: varias mensagens chegam grudadas numa unica leitura.
 *   - FRAGMENTACAO: uma mensagem chega picada em varias leituras.
 *
 * O formato de cada quadro:
 *
 *   +-------------------------+------------------------------+
 *   |  4 bytes: tamanho (N)   |   N bytes: JSON em UTF-8     |
 *   |  inteiro sem sinal, BE  |                              |
 *   +-------------------------+------------------------------+
 *
 * "BE" = big-endian, a ordem de bytes convencional da internet.
 */

/** Bytes do cabecalho que carrega o tamanho do corpo. */
export const TAMANHO_CABECALHO = 4;

/**
 * Teto do corpo de um quadro: 1 MB.
 *
 * Existe por seguranca: como o tamanho e conhecido ANTES de receber o corpo,
 * conseguimos recusar de imediato um cliente com defeito (ou malicioso) que
 * anuncie um quadro gigante, em vez de acumular memoria ate derrubar o processo.
 */
export const TAMANHO_MAXIMO_QUADRO = 1024 * 1024;

/** Violacao do protocolo de enquadramento. */
export class ErroDeFraming extends Error {
  public constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeFraming";
  }
}

/**
 * Transforma um valor em um quadro pronto para ser escrito no socket.
 *
 * @throws {ErroDeFraming} se o corpo passar do teto de tamanho.
 */
export function codificarQuadro(valor: unknown): Buffer {
  const corpo: Buffer = Buffer.from(JSON.stringify(valor), "utf8");

  if (corpo.length > TAMANHO_MAXIMO_QUADRO) {
    throw new ErroDeFraming(
      `quadro de ${corpo.length} bytes excede o maximo de ${TAMANHO_MAXIMO_QUADRO}`
    );
  }

  const cabecalho: Buffer = Buffer.allocUnsafe(TAMANHO_CABECALHO);
  cabecalho.writeUInt32BE(corpo.length, 0);

  return Buffer.concat([cabecalho, corpo]);
}

/**
 * Remonta quadros completos a partir dos pedacos que o socket entrega.
 *
 * Uma instancia por conexao: o estado acumulado e daquela conexao especifica.
 */
export class DecodificadorDeQuadros {
  /** Bytes recebidos que ainda nao formaram um quadro completo. */
  private acumulado: Buffer = Buffer.alloc(0);

  /** Quantos bytes estao guardados esperando o restante do quadro. */
  public get bytesPendentes(): number {
    return this.acumulado.length;
  }

  /**
   * Recebe um pedaco vindo do socket e devolve os quadros que ficaram completos.
   *
   * Pode devolver zero quadros (mensagem ainda incompleta - FRAGMENTACAO) ou
   * varios de uma vez (varias mensagens no mesmo pedaco - AGLUTINACAO).
   *
   * @throws {ErroDeFraming} se o cabecalho anunciar um quadro acima do teto.
   */
  public receber(pedaco: Buffer): string[] {
    this.acumulado = Buffer.concat([this.acumulado, pedaco]);

    const quadrosCompletos: string[] = [];

    for (;;) {
      // 1) Ainda nao chegou nem o cabecalho: nao da nem para saber o tamanho.
      if (this.acumulado.length < TAMANHO_CABECALHO) {
        break;
      }

      const tamanhoDoCorpo: number = this.acumulado.readUInt32BE(0);

      // Validacao ANTES de esperar o corpo: e o que impede um cliente de nos
      // fazer acumular memoria indefinidamente.
      if (tamanhoDoCorpo > TAMANHO_MAXIMO_QUADRO) {
        throw new ErroDeFraming(
          `cabecalho anuncia ${tamanhoDoCorpo} bytes, acima do maximo de ${TAMANHO_MAXIMO_QUADRO}`
        );
      }

      // 2) O corpo ainda nao chegou inteiro: guarda e espera o proximo pedaco.
      const tamanhoTotal: number = TAMANHO_CABECALHO + tamanhoDoCorpo;
      if (this.acumulado.length < tamanhoTotal) {
        break;
      }

      // 3) Quadro completo: recorta o corpo e entrega.
      const corpo: Buffer = this.acumulado.subarray(TAMANHO_CABECALHO, tamanhoTotal);
      quadrosCompletos.push(corpo.toString("utf8"));

      // O que sobrou e o inicio do PROXIMO quadro. O laco continua e extrai
      // tambem esse - e assim varias mensagens grudadas saem de uma vez.
      this.acumulado = this.acumulado.subarray(tamanhoTotal);
    }

    return quadrosCompletos;
  }
}
