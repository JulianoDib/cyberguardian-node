/**
 * ============================================================================
 * MATERIAL DE DEMONSTRACAO — NAO FAZ PARTE DO SISTEMA EM PRODUCAO.
 * ============================================================================
 *
 * Este script existe para EVIDENCIAR o problema que o framing resolve, e serve
 * de apoio a defesa oral do trabalho (pergunta "por que framing explicito?").
 * Nenhum modulo do gateway, dos workers ou do sensor depende deste arquivo.
 *
 * Como rodar:  npm run demo:problema
 * ============================================================================
 *
 * DEMONSTRACAO DO PROBLEMA — servidor TCP SEM framing.
 *
 * O servidor faz o que a intuicao manda: a cada chegada de bytes, tenta
 * JSON.parse. Dois cenarios mostram isso falhando de formas diferentes:
 *
 *   CENARIO A - AGLUTINACAO : 3 alertas pequenos chegam grudados numa leitura.
 *   CENARIO B - FRAGMENTACAO: 1 alerta grande chega picado em varias leituras.
 *
 * Resultado observado: 6 leituras, 6 falhas de JSON.parse, 0 mensagens.
 */

import net from "node:net";

const PORTA = 5099;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// SERVIDOR INGENUO: uma leitura = uma mensagem (premissa ERRADA)
// ---------------------------------------------------------------------------
const servidor = net.createServer((socket) => {
  let numeroDaLeitura = 0;

  socket.on("data", (pedaco) => {
    numeroDaLeitura++;
    const texto = pedaco.toString("utf8");

    console.log(`   [servidor] leitura #${numeroDaLeitura}: ${pedaco.length} bytes`);
    console.log(`              comeca com : ${JSON.stringify(texto.slice(0, 50))}`);
    console.log(`              termina com: ${JSON.stringify(texto.slice(-30))}`);

    try {
      const objeto = JSON.parse(texto);
      console.log(`              JSON.parse OK -> id = ${objeto.id}`);
    } catch (erro) {
      console.log(`              >>> JSON.parse FALHOU: ${erro.message}`);
    }
    console.log("");
  });
});

// ---------------------------------------------------------------------------
// CENARIO A — AGLUTINACAO: 3 alertas pequenos, escritos em rajada
// ---------------------------------------------------------------------------
async function cenarioAglutinacao() {
  console.log("===========================================================");
  console.log(" CENARIO A - AGLUTINACAO");
  console.log(" O sensor escreve 3 alertas pequenos, um atras do outro.");
  console.log(" Esperado pela intuicao: 3 leituras, 3 JSON.parse com sucesso.");
  console.log("===========================================================\n");

  const cliente = net.connect(PORTA, "127.0.0.1");
  await new Promise((resolve) => cliente.on("connect", resolve));

  for (let i = 1; i <= 3; i++) {
    const alerta = JSON.stringify({
      id: `alerta-${i}`,
      ipOrigem: "203.0.113.45",
      pacotesPorSegundo: 18500 + i,
    });
    console.log(`   [sensor]   write() #${i}: ${Buffer.byteLength(alerta)} bytes`);
    cliente.write(alerta);
  }
  console.log("");

  await esperar(400);
  cliente.end();
  await esperar(200);
}

// ---------------------------------------------------------------------------
// CENARIO B — FRAGMENTACAO: 1 alerta grande
// ---------------------------------------------------------------------------
async function cenarioFragmentacao() {
  console.log("===========================================================");
  console.log(" CENARIO B - FRAGMENTACAO");
  console.log(" O sensor escreve UM unico alerta grande (~300 KB).");
  console.log(" Esperado pela intuicao: 1 leitura, 1 JSON.parse com sucesso.");
  console.log("===========================================================\n");

  const cliente = net.connect(PORTA, "127.0.0.1");
  await new Promise((resolve) => cliente.on("connect", resolve));

  const alertaGrande = JSON.stringify({
    id: "alerta-grande",
    ipOrigem: "203.0.113.45",
    // Simula um payload grande (ex.: amostra de pacotes capturados)
    amostraDePacotes: "x".repeat(300_000),
  });

  console.log(`   [sensor]   write() unico: ${Buffer.byteLength(alertaGrande)} bytes\n`);
  cliente.write(alertaGrande);

  await esperar(600);
  cliente.end();
  await esperar(200);
}

async function principal() {
  await new Promise((resolve) => servidor.listen(PORTA, "127.0.0.1", resolve));

  await cenarioAglutinacao();
  await cenarioFragmentacao();

  servidor.close();
  console.log("===========================================================");
  console.log(" FIM");
  console.log("===========================================================");
}

principal();
