/**
 * ============================================================================
 * MATERIAL DE DEMONSTRACAO — NAO FAZ PARTE DO SISTEMA EM PRODUCAO.
 * ============================================================================
 *
 * Reconcilia o que ENTROU na fila com o que foi PROCESSADO pelos workers, para
 * evidenciar a garantia do R6: "se um worker cair, a fila nao perde mensagens".
 *
 * Le `logs/auditoria-*.jsonl`, escritos pelos processos em execucao.
 *
 * Como rodar (depois de uma rodada com gateway + workers + sensor):
 *   npm run demo:entrega
 * ============================================================================
 *
 * O que exibe:
 *   1. PUBLICADOS   — ids que o gateway colocou na fila (evento PUBLICA-FILA).
 *   2. PROCESSADOS  — ids que algum worker processou (evento PROCESSA).
 *   3. FALTANTES    — publicados que ninguem processou. DEVE SER ZERO.
 *   4. REPROCESSADOS— processados mais de uma vez.
 *
 * Sobre o item 4: reprocessamento NAO e defeito. E a prova de que a mensagem
 * foi RECUPERADA em vez de perdida — a semantica at-least-once funcionando.
 * Um worker morto entre "processar" e "confirmar o offset" faz o Kafka
 * reentregar aquela mensagem a outro worker. Se nao houvesse duplicata nesse
 * cenario, e porque a mensagem teria se PERDIDO.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PASTA_LOGS = "logs";

function carregarEventos() {
  let arquivos;
  try {
    arquivos = readdirSync(PASTA_LOGS).filter(
      (nome) => nome.startsWith("auditoria-") && nome.endsWith(".jsonl")
    );
  } catch {
    console.error(`Pasta "${PASTA_LOGS}" nao encontrada. Rode o sistema antes.`);
    process.exit(1);
  }

  if (arquivos.length === 0) {
    console.error(`Nenhum arquivo auditoria-*.jsonl em "${PASTA_LOGS}".`);
    process.exit(1);
  }

  const eventos = [];
  for (const arquivo of arquivos) {
    for (const linha of readFileSync(join(PASTA_LOGS, arquivo), "utf8").split("\n")) {
      if (linha.trim() === "") continue;
      eventos.push(JSON.parse(linha));
    }
  }
  return { eventos, arquivos };
}

const { eventos, arquivos } = carregarEventos();

// --- 1) O que o gateway publicou na fila ---
const publicados = new Map(); // id -> evento
for (const e of eventos) {
  if (e.tipo === "PUBLICA-FILA" && e.mensagemId !== null) {
    publicados.set(e.mensagemId, e);
  }
}

// --- 2) O que os workers processaram ---
const processados = new Map(); // id -> [{processo, lamport, instanteFisico}]
for (const e of eventos) {
  if (e.tipo !== "PROCESSA" || e.mensagemId === null) continue;
  const lista = processados.get(e.mensagemId) ?? [];
  lista.push({ processo: e.processo, lamport: e.lamport, instanteFisico: e.instanteFisico });
  processados.set(e.mensagemId, lista);
}

// --- 3) Faltantes e reprocessados ---
const faltantes = [...publicados.keys()].filter((id) => !processados.has(id));
const reprocessados = [...processados.entries()].filter(([, lista]) => lista.length > 1);

// Processados que o gateway nao publicou nesta rodada (sobra de execucao anterior).
const orfaos = [...processados.keys()].filter((id) => !publicados.has(id));

console.log("=".repeat(78));
console.log(" CONFERENCIA DE ENTREGA — o R6 em numeros");
console.log("=".repeat(78));
console.log(` arquivos lidos : ${arquivos.join(", ")}`);
console.log("");
console.log(` PUBLICADOS na fila (gateway)      : ${publicados.size}`);
console.log(` PROCESSADOS distintos (workers)   : ${processados.size}`);
console.log(` FALTANTES (perdidos)              : ${faltantes.length}`);
console.log(` REPROCESSADOS (entregues 2x+)     : ${reprocessados.length}`);
if (orfaos.length > 0) {
  console.log(` processados sem publicacao nesta rodada: ${orfaos.length} (sobra de execucao anterior)`);
}

// --- Quem processou o que ---
const porProcesso = new Map();
for (const lista of processados.values()) {
  for (const item of lista) {
    porProcesso.set(item.processo, (porProcesso.get(item.processo) ?? 0) + 1);
  }
}
console.log("\n distribuicao do processamento:");
for (const [processo, quantidade] of [...porProcesso].sort()) {
  console.log(`   ${processo.padEnd(12)} ${quantidade} mensagem(ns)`);
}

// --- Faltantes: o que NAO pode acontecer ---
console.log(`\n${"=".repeat(78)}`);
console.log(" MENSAGENS PERDIDAS");
console.log("=".repeat(78));
if (faltantes.length === 0) {
  console.log(" NENHUMA. Todo id publicado na fila foi processado por algum worker.");
} else {
  console.log(` ${faltantes.length} PERDIDA(S) — isto seria uma falha do R6:`);
  for (const id of faltantes.slice(0, 10)) {
    const evento = publicados.get(id);
    console.log(`   ${id}  (publicado em ${evento.instanteFisico}, ${evento.detalhe})`);
  }
}

// --- Reprocessados: a PROVA da recuperacao ---
console.log(`\n${"=".repeat(78)}`);
console.log(" MENSAGENS REPROCESSADAS — a prova da recuperacao, nao um defeito");
console.log("=".repeat(78));
if (reprocessados.length === 0) {
  console.log(" Nenhuma. Nesta rodada nenhum worker morreu com mensagem pendente");
  console.log(" de confirmacao (ou a janela era estreita demais para ser atingida).");
} else {
  console.log(` ${reprocessados.length} mensagem(ns) entregue(s) mais de uma vez.\n`);
  console.log(" Cada uma destas foi processada, o worker morreu ANTES de confirmar o");
  console.log(" offset, e o Kafka a reentregou a outro worker. Sem esse mecanismo,");
  console.log(" elas apareceriam na lista de PERDIDAS acima.\n");
  for (const [id, lista] of reprocessados.slice(0, 10)) {
    console.log(`   ${id}`);
    for (const item of lista) {
      console.log(
        `      ${item.processo.padEnd(10)} L=${String(item.lamport).padStart(3)}  ${item.instanteFisico.slice(11, 23)}`
      );
    }
  }
}

// --- Veredito ---
console.log(`\n${"=".repeat(78)}`);
console.log(" VEREDITO");
console.log("=".repeat(78));
if (faltantes.length === 0 && publicados.size > 0) {
  console.log(` Publicados = ${publicados.size} | Processados distintos = ${processados.size} | Perdidos = 0`);
  console.log(" R6 (metade 1) ATENDIDO: nenhuma mensagem se perdeu.");
  if (reprocessados.length > 0) {
    console.log(` Entrega at-least-once evidenciada: ${reprocessados.length} reprocessamento(s).`);
  }
} else if (publicados.size === 0) {
  console.log(" Nenhuma publicacao encontrada nos logs. Rode o gateway e o sensor antes.");
} else {
  console.log(` ${faltantes.length} mensagem(ns) PERDIDA(S) — o R6 NAO estaria atendido.`);
  process.exitCode = 1;
}
console.log("=".repeat(78));
