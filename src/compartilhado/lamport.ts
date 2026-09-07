/**
 * RELOGIO LOGICO DE LAMPORT (R4).
 *
 * Um contador por PROCESSO. Nao mede tempo — mede QUANTOS EVENTOS aquele
 * processo ja viu, direta ou indiretamente. Dois processos podem estar no mesmo
 * instante fisico com contadores muito diferentes, e isso e correto: eles nao
 * viram a mesma quantidade de eventos.
 *
 * A garantia que ele oferece:
 *
 *     se A causou B,  entao  L(A) < L(B)
 *
 * A RECIPROCA NAO VALE: L(A) < L(B) nao significa que A causou B. Podem ser
 * eventos CONCORRENTES (sem caminho causal entre eles), e nesse caso a ordem
 * entre os carimbos e arbitraria. Lamport nunca prometeu ordenar concorrentes —
 * ele promete nao INVERTER causalidade, que e coisa diferente.
 *
 * Por isso o relogio fisico nao serve: relogios de maquinas diferentes divergem,
 * e um evento causado por outro pode receber carimbo fisico MENOR que sua
 * propria causa. Alem disso, o relogio fisico nao viaja junto com a mensagem —
 * ele nao tem como transportar a informacao "eu ja sabia de N eventos".
 */

/** Violacao das pre-condicoes do relogio. */
export class ErroDeRelogio extends Error {
  public constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeRelogio";
  }
}

export class RelogioLamport {
  /**
   * O contador. `private` de proposito: so pode ser alterado pelas tres regras
   * abaixo. Nao existe atribuicao direta em lugar nenhum do sistema.
   */
  private contador = 0;

  /** Le o valor atual SEM incrementar (para log e para montar o `max`). */
  public get valor(): number {
    return this.contador;
  }

  /**
   * REGRA 1 — EVENTO INTERNO.
   *
   *     L = L + 1
   *
   * Algo aconteceu dentro deste processo, sem troca de mensagem: o worker
   * aplicou a regra de bloqueio, o gateway recebeu um alerta de um sensor que
   * nao tem relogio proprio. O tempo logico avanca porque houve um evento.
   */
  public eventoInterno(): number {
    this.contador += 1;
    return this.contador;
  }

  /**
   * REGRA 2 — ENVIO.
   *
   *     L = L + 1,  e a mensagem leva o L JA INCREMENTADO
   *
   * Aritmeticamente identico a regra 1 — o metodo existe separado para que o
   * ponto de chamada diga qual regra esta sendo aplicada.
   *
   * O detalhe que importa: o valor carimbado e o POSTERIOR ao incremento. Se
   * mandassemos o valor anterior, um receptor poderia calcular um carimbo igual
   * ao do envio, e a desigualdade estrita L(envio) < L(recepcao) se perderia.
   */
  public aoEnviar(): number {
    this.contador += 1;
    return this.contador;
  }

  /**
   * REGRA 3 — RECEPCAO.
   *
   *     L = max(L_local, L_mensagem) + 1
   *
   * O coracao do algoritmo. Duas leituras do mesmo calculo:
   *
   *  - O `max` faz o relogio local SALTAR quando a mensagem vem de um processo
   *    que ja viu mais eventos. E assim que a informacao causal se propaga: ao
   *    receber, o processo passa a "saber" de tudo que a origem sabia.
   *  - O `+ 1` garante a desigualdade ESTRITA: a recepcao e um evento novo,
   *    posterior ao envio, entao nao pode ter o mesmo carimbo dele.
   *
   * Consequencia visivel nos logs: um worker recem-iniciado com L=0 que recebe
   * uma mensagem carimbada 12 vai para 13, e nao para 1.
   *
   * @throws {ErroDeRelogio} se o carimbo recebido nao for um inteiro >= 0.
   *   `NaN` e o caso perigoso: passa por `typeof x === "number"` e contaminaria
   *   o contador para sempre, porque `Math.max(qualquer, NaN)` e `NaN`.
   */
  public aoReceber(lamportDaMensagem: number): number {
    if (!Number.isInteger(lamportDaMensagem) || lamportDaMensagem < 0) {
      throw new ErroDeRelogio(
        `carimbo de Lamport invalido na mensagem: ${String(lamportDaMensagem)}`
      );
    }

    this.contador = Math.max(this.contador, lamportDaMensagem) + 1;
    return this.contador;
  }
}
