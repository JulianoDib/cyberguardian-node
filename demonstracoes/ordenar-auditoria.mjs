/**
 * ============================================================================
 * MATERIAL DE DEMONSTRACAO — NAO FAZ PARTE DO SISTEMA EM PRODUCAO.
 * ============================================================================
 *
 * Reconcilia os logs de auditoria dos processos (gateway e workers) e compara
 * a ordem FISICA com a ordem LOGICA (Lamport). Serve de apoio a defesa oral no
 * trade-off "Lamport vs Relogio Fisico".
 *
 * Le `logs/auditoria-*.jsonl`, que os processos escrevem em execucao.
 *
 * Como rodar (depois de uma rodada com gateway + workers + sensor):
 *   npm run demo:lamport
 * ============================================================================
 *
 * O que exibe:
 *   1. Ordem por TEMPO FISICO       — o que um relogio de parede diria.
 *   2. Ordem por (LAMPORT, PROCESSO) — ordem total, deterministica.
 *   3. PARES INVERTIDOS             — casos concretos em que as duas discordam.
 *   4. CADEIAS CAUSAIS              — publicacao no gateway -> recepcao no
 *      worker. Aqui Lamport NAO pode errar, e a verificacao prova isso.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PASTA_LOGS = "logs";
const MAX_LINHAS = 40;
const MAX_INVERSOES = 6;

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
    const conteudo = readFileSync(join(PASTA_LOGS, arquivo), "utf8");
    for (const linha of conteudo.split("\n")) {
      if (linha.trim() === "") continue;
      eventos.push(JSON.parse(linha));
    }
  }
  return { eventos, arquivos };
}

/** Ordem FISICA: pelo relogio de parede. Desempate pelo nome do processo. */
function ordenarPorTempoFisico(eventos) {
  return [...eventos].sort((a, b) => {
    if (a.instanteFisico !== b.instanteFisico) {
      return a.instanteFisico < b.instanteFisico ? -1 : 1;
    }
    return a.processo < b.processo ? -1 : a.processo > b.processo ? 1 : 0;
  });
}

/**
 * Ordem LOGICA TOTAL: por (lamport, processo).
 *
 * Lamport sozinho da uma ordem PARCIAL — eventos concorrentes podem ter o mesmo
 * carimbo. O nome do processo como criterio de desempate transforma isso numa
 * ordem TOTAL e DETERMINISTICA: rodar duas vezes da sempre o mesmo resultado.
 */
function ordenarPorLamport(eventos) {
  return [...eventos].sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport;
    return a.processo < b.processo ? -1 : a.processo > b.processo ? 1 : 0;
  });
}

function hora(iso) {
  return iso.slice(11, 23);
}

function linha(evento) {
  return (
    `${evento.processo.padEnd(10)} ` +
    `L=${String(evento.lamport).padStart(3)}  ` +
    `${hora(evento.instanteFisico)}  ` +
    `${evento.tipo.padEnd(14)} ` +
    `${evento.detalhe.slice(0, 46)}`
  );
}

function imprimirLista(titulo, lista) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(` ${titulo}`);
  console.log("=".repeat(78));
  const recorte = lista.slice(0, MAX_LINHAS);
  for (const [i, evento] of recorte.entries()) {
    console.log(`${String(i + 1).padStart(3)}. ${linha(evento)}`);
  }
  if (lista.length > recorte.length) {
    console.log(`     ... e mais ${lista.length - recorte.length} evento(s).`);
  }
}

/**
 * Pares de processos DIFERENTES em que as duas ordens discordam:
 * A tem carimbo logico MENOR que B, mas aconteceu FISICAMENTE DEPOIS.
 */
function encontrarInversoes(eventos) {
  const inversoes = [];
  for (let i = 0; i < eventos.length; i++) {
    for (let j = 0; j < eventos.length; j++) {
      if (i === j) continue;
      const a = eventos[i];
      const b = eventos[j];
      if (a.processo === b.processo) continue;
      if (a.lamport < b.lamport && a.instanteFisico > b.instanteFisico) {
        inversoes.push({ a, b });
      }
    }
  }
  return inversoes;
}

/**
 * Cadeias causais: o gateway PUBLICA uma mensagem, um worker a RECEBE.
 * Existe caminho causal, entao Lamport e OBRIGADO a acertar a ordem.
 */
function verificarCadeiasCausais(eventos) {
  const publicacoes = new Map();
  for (const e of eventos) {
    if (e.tipo === "PUBLICA-FILA" && e.mensagemId !== null) {
      publicacoes.set(e.mensagemId, e);
    }
  }

  const cadeias = [];
  for (const e of eventos) {
    if (e.tipo !== "RECEBE-FILA" || e.mensagemId === null) continue;
    const publicacao = publicacoes.get(e.mensagemId);
    if (publicacao === undefined) continue;
    cadeias.push({
      publicacao,
      recepcao: e,
      lamportOk: publicacao.lamport < e.lamport,
      fisicoOk: publicacao.instanteFisico < e.instanteFisico,
    });
  }
  return cadeias;
}

// ---------------------------------------------------------------------------

const { eventos, arquivos } = carregarEventos();

console.log("=".repeat(78));
console.log(" RECONCILIACAO DOS LOGS DE AUDITORIA");
console.log("=".repeat(78));
console.log(` arquivos lidos : ${arquivos.join(", ")}`);
console.log(` eventos totais : ${eventos.length}`);

const porProcesso = new Map();
for (const e of eventos) {
  porProcesso.set(e.processo, (porProcesso.get(e.processo) ?? 0) + 1);
}
for (const [processo, quantidade] of [...porProcesso].sort()) {
  console.log(`   ${processo.padEnd(12)} ${quantidade} evento(s)`);
}

const porFisico = ordenarPorTempoFisico(eventos);
const porLogico = ordenarPorLamport(eventos);

imprimirLista("1. ORDEM POR TEMPO FISICO (o que um relogio de parede diria)", porFisico);
imprimirLista("2. ORDEM POR (LAMPORT, PROCESSO) — total e deterministica", porLogico);

// --- 3. Inversoes ---
const inversoes = encontrarInversoes(eventos);

console.log(`\n${"=".repeat(78)}`);
console.log(" 3. PARES EM QUE AS DUAS ORDENS DISCORDAM");
console.log("=".repeat(78));

if (inversoes.length === 0) {
  console.log(" Nenhuma inversao nesta rodada.");
  console.log(" (Depende do escalonamento dos processos; tente outra execucao");
  console.log("  ou suba um worker depois dos demais.)");
} else {
  console.log(` ${inversoes.length} par(es) encontrado(s). Mostrando ate ${MAX_INVERSOES}:\n`);
  for (const { a, b } of inversoes.slice(0, MAX_INVERSOES)) {
    console.log(`   ${linha(b)}`);
    console.log(`   ${linha(a)}`);
    console.log(
      `      -> ordem FISICA : ${b.processo} (${hora(b.instanteFisico)}) antes de ` +
        `${a.processo} (${hora(a.instanteFisico)})`
    );
    console.log(
      `      -> ordem LOGICA : ${a.processo} (L=${a.lamport}) antes de ` +
        `${b.processo} (L=${b.lamport})`
    );
    console.log("      -> DISCORDAM. Sao eventos CONCORRENTES: nao ha caminho causal");
    console.log("         entre eles, entao Lamport nao promete ordena-los. O relogio");
    console.log("         fisico, por outro lado, AFIRMA uma ordem sem base causal.\n");
  }
}

// --- 4. Cadeias causais ---
const cadeias = verificarCadeiasCausais(eventos);

console.log("=".repeat(78));
console.log(" 4. CADEIAS CAUSAIS (gateway publica -> worker recebe)");
console.log("=".repeat(78));

if (cadeias.length === 0) {
  console.log(" Nenhuma cadeia completa nos logs (rode gateway + workers juntos).");
} else {
  const lamportViolados = cadeias.filter((c) => !c.lamportOk);
  const fisicoViolados = cadeias.filter((c) => !c.fisicoOk);

  console.log(` cadeias verificadas          : ${cadeias.length}`);
  console.log(` respeitadas pelo LAMPORT     : ${cadeias.length - lamportViolados.length}/${cadeias.length}`);
  console.log(` respeitadas pelo TEMPO FISICO: ${cadeias.length - fisicoViolados.length}/${cadeias.length}`);

  const exemplo = cadeias[0];
  console.log("\n exemplo:");
  console.log(`   ${linha(exemplo.publicacao)}`);
  console.log(`   ${linha(exemplo.recepcao)}`);
  console.log(
    `   -> L(publica)=${exemplo.publicacao.lamport} < L(recebe)=${exemplo.recepcao.lamport}  ` +
      `(a garantia de Lamport, cumprida)`
  );

  if (lamportViolados.length === 0) {
    console.log("\n CONCLUSAO: onde existe causalidade, Lamport NUNCA inverteu a ordem.");
    console.log(" Onde nao existe (secao 3), as duas reguas discordam — e so a fisica");
    console.log(" finge saber a resposta.");
  } else {
    console.log(`\n ATENCAO: ${lamportViolados.length} cadeia(s) causal(is) violada(s) — isso seria um BUG.`);
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log(" FIM");
console.log("=".repeat(78));
