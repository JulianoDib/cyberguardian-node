/**
 * ============================================================================
 * MATERIAL DE DEMONSTRACAO — NAO FAZ PARTE DO SISTEMA EM PRODUCAO.
 * ============================================================================
 *
 * Par do "problema-sem-framing.mjs": mostra os MESMOS cenarios funcionando
 * depois do enquadramento. Serve de apoio a defesa oral do trabalho.
 * Nenhum modulo do gateway, dos workers ou do sensor depende deste arquivo.
 *
 * Usa o modulo REAL do projeto (src/compartilhado/framing.ts, ja compilado),
 * e nao uma copia — por isso exige "npm run build" antes.
 *
 * Como rodar:  npm run build && npm run demo:solucao
 * ============================================================================
 *
 * DEMONSTRACAO DA SOLUCAO — os mesmos cenarios, agora COM framing.
 *
 *   CENARIO A - AGLUTINACAO         : 3 quadros grudados -> 3 mensagens.
 *   CENARIO B - FRAGMENTACAO        : 1 quadro em 5 leituras -> 1 mensagem.
 *   CENARIO C - FRAGMENTACAO EXTREMA: 1 byte por vez -> so entrega no ultimo.
 *   CENARIO D - DEFESA              : cabecalho de 2 GB e recusado.
 */

import net from "node:net";
import framing from "../dist/compartilhado/framing.js";

const { codificarQuadro, DecodificadorDeQuadros, TAMANHO_MAXIMO_QUADRO, ErroDeFraming } = framing;

const PORTA = 5098;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// SERVIDOR COM FRAMING: um decodificador POR CONEXAO
// ---------------------------------------------------------------------------
const servidor = net.createServer((socket) => {
  const decodificador = new DecodificadorDeQuadros();
  let numeroDaLeitura = 0;
  let mensagensRecebidas = 0;

  socket.on("data", (pedaco) => {
    numeroDaLeitura++;
    const quadros = decodificador.receber(pedaco);

    console.log(
      `   [servidor] leitura #${numeroDaLeitura}: ${String(pedaco.length).padStart(6)} bytes` +
        ` -> ${quadros.length} quadro(s) completo(s)` +
        ` | ${decodificador.bytesPendentes} byte(s) pendente(s)`
    );

    for (const quadro of quadros) {
      const objeto = JSON.parse(quadro);
      mensagensRecebidas++;
      console.log(`              >>> MENSAGEM OK: id = ${objeto.id}`);
    }
  });

  socket.on("close", () => {
    console.log(`   [servidor] conexao encerrada. Total de mensagens: ${mensagensRecebidas}\n`);
  });
});

// ---------------------------------------------------------------------------
// CENARIO A — AGLUTINACAO
// ---------------------------------------------------------------------------
async function cenarioAglutinacao() {
  console.log("===========================================================");
  console.log(" CENARIO A - AGLUTINACAO (3 alertas pequenos em rajada)");
  console.log("===========================================================\n");

  const cliente = net.connect(PORTA, "127.0.0.1");
  await new Promise((resolve) => cliente.on("connect", resolve));

  for (let i = 1; i <= 3; i++) {
    const quadro = codificarQuadro({
      id: `alerta-${i}`,
      ipOrigem: "203.0.113.45",
      pacotesPorSegundo: 18500 + i,
    });
    console.log(`   [sensor]   write() #${i}: ${quadro.length} bytes (4 de cabecalho + corpo)`);
    cliente.write(quadro);
  }
  console.log("");

  await esperar(400);
  cliente.end();
  await esperar(200);
}

// ---------------------------------------------------------------------------
// CENARIO B — FRAGMENTACAO
// ---------------------------------------------------------------------------
async function cenarioFragmentacao() {
  console.log("===========================================================");
  console.log(" CENARIO B - FRAGMENTACAO (1 alerta grande, ~300 KB)");
  console.log("===========================================================\n");

  const cliente = net.connect(PORTA, "127.0.0.1");
  await new Promise((resolve) => cliente.on("connect", resolve));

  const quadro = codificarQuadro({
    id: "alerta-grande",
    ipOrigem: "203.0.113.45",
    amostraDePacotes: "x".repeat(300_000),
  });

  console.log(`   [sensor]   write() unico: ${quadro.length} bytes\n`);
  cliente.write(quadro);

  await esperar(600);
  cliente.end();
  await esperar(200);
}

// ---------------------------------------------------------------------------
// CENARIO C — FRAGMENTACAO EXTREMA: alimenta o decodificador BYTE A BYTE
// ---------------------------------------------------------------------------
function cenarioByteAByte() {
  console.log("===========================================================");
  console.log(" CENARIO C - FRAGMENTACAO EXTREMA (1 byte por vez)");
  console.log(" Prova do algoritmo: nao devolve NADA ate o ultimo byte.");
  console.log("===========================================================\n");

  const decodificador = new DecodificadorDeQuadros();
  const quadro = codificarQuadro({ id: "alerta-picado", ipOrigem: "198.51.100.9" });

  console.log(`   quadro completo: ${quadro.length} bytes`);

  let totalDevolvido = 0;
  let byteQueCompletou = -1;

  for (let i = 0; i < quadro.length; i++) {
    const quadros = decodificador.receber(quadro.subarray(i, i + 1));
    if (quadros.length > 0) {
      totalDevolvido += quadros.length;
      byteQueCompletou = i + 1;
      console.log(`   byte ${i + 1}/${quadro.length}: >>> MENSAGEM OK: id = ${JSON.parse(quadros[0]).id}`);
    }
  }

  console.log(`   resultado: ${totalDevolvido} mensagem(ns), completada no byte ${byteQueCompletou} de ${quadro.length}`);
  console.log(`   bytes pendentes ao final: ${decodificador.bytesPendentes}\n`);
}

// ---------------------------------------------------------------------------
// CENARIO D — DEFESA: cabecalho anunciando quadro gigante
// ---------------------------------------------------------------------------
function cenarioCabecalhoAbusivo() {
  console.log("===========================================================");
  console.log(" CENARIO D - DEFESA (cliente anuncia quadro de 2 GB)");
  console.log("===========================================================\n");

  const decodificador = new DecodificadorDeQuadros();
  const cabecalhoMentiroso = Buffer.allocUnsafe(4);
  cabecalhoMentiroso.writeUInt32BE(2_000_000_000, 0);

  console.log(`   teto configurado : ${TAMANHO_MAXIMO_QUADRO} bytes`);
  console.log(`   cliente anuncia  : 2000000000 bytes`);

  try {
    decodificador.receber(cabecalhoMentiroso);
    console.log("   >>> PROBLEMA: aceitou sem reclamar!\n");
  } catch (erro) {
    const ehErroEsperado = erro instanceof ErroDeFraming || erro.name === "ErroDeFraming";
    console.log(`   >>> REJEITADO (${erro.name}): ${erro.message}`);
    console.log(`   >>> tipo de erro esperado: ${ehErroEsperado}\n`);
  }
}

async function principal() {
  await new Promise((resolve) => servidor.listen(PORTA, "127.0.0.1", resolve));

  await cenarioAglutinacao();
  await cenarioFragmentacao();
  cenarioByteAByte();
  cenarioCabecalhoAbusivo();

  servidor.close();
  console.log("===========================================================");
  console.log(" FIM");
  console.log("===========================================================");
}

principal();
