// Exécute le jeu de questions de référence du moteur de questionnement local.
//
// Le jeu ne contient aucune liste de nœuds attendus : chaque question déclare un
// ancrage et un chemin de prédicats, et l'attendu est calculé ici par traversée
// du corpus. La vérité de terrain est donc indépendante du moteur mesuré — sans
// quoi le benchmark ne pourrait jamais le mettre en défaut.
//
//   node scripts/run-query-benchmark.js
//   node scripts/run-query-benchmark.js --output=artifacts/benchmark/query.json
import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../src/graph-manifest.js";
import { loadCorpus } from "../src/corpus.js";
import { buildGraphQueryEngine, QUERY_TUNING } from "../public/graph-query.js";

const argOf = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const outputPath = argOf("output");

const set = JSON.parse(await fs.readFile(path.join(projectDir, "benchmark/query-reference-questions.json"), "utf8"));
const { nodes, links } = await loadCorpus("design");
const engine = buildGraphQueryEngine(nodes, links);
const idOf = value => (typeof value === "object" ? value.id : value);

/** Attendu structurel : frontière après chaque étape, avec la profondeur atteinte. */
function expectedFor(question) {
  const expected = new Map();
  let frontier = [question.anchor];
  question.path.forEach((step, index) => {
    const next = links
      .filter(link => link.type === step.predicate)
      .filter(link => frontier.includes(step.direction === "incoming" ? idOf(link.target) : idOf(link.source)))
      .map(link => (step.direction === "incoming" ? idOf(link.source) : idOf(link.target)));
    for (const id of next) if (!expected.has(id)) expected.set(id, index + 1);
    frontier = next;
  });
  return expected;
}

/** Voisinage immédiat de l'ancrage : contexte légitime, ni attendu ni hors sujet. */
function neighbourhood(anchor) {
  const around = new Set();
  for (const link of links) {
    if (idOf(link.source) === anchor) around.add(idOf(link.target));
    if (idOf(link.target) === anchor) around.add(idOf(link.source));
  }
  return around;
}

function measure(question, tuning, maxDepth) {
  const expected = expectedFor(question);
  const around = neighbourhood(question.anchor);
  const result = engine.query(question.question, { tuning, maxDepth, limit: 20 });
  const returned = result.results.map(item => item.nodeId);
  const returnedSet = new Set(returned);
  const clusterSet = new Set(result.nodes.map(node => node.id));

  const byDepth = {};
  for (const [id, depth] of expected) {
    byDepth[depth] ??= { expected: 0, ranked: 0, cluster: 0, missing: [] };
    byDepth[depth].expected += 1;
    if (returnedSet.has(id)) byDepth[depth].ranked += 1;
    if (clusterSet.has(id)) byDepth[depth].cluster += 1;
    if (!clusterSet.has(id)) byDepth[depth].missing.push(id);
  }

  const offTopic = returned.filter(id => id !== question.anchor && !expected.has(id) && !around.has(id));
  return {
    question: question.id,
    phrasing: question.phrasing,
    anchorRank: returned.indexOf(question.anchor) + 1 || null,
    expectedTotal: expected.size,
    rankedRecall: expected.size ? [...expected.keys()].filter(id => returnedSet.has(id)).length / expected.size : 1,
    clusterRecall: expected.size ? [...expected.keys()].filter(id => clusterSet.has(id)).length / expected.size : 1,
    byDepth,
    offTopic: offTopic.length,
    returned: returned.length,
    maxDepthReturned: Math.max(0, ...result.results.map(item => item.depth)),
    rankedIds: returned
  };
}

function aggregate(rows) {
  const mean = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  const of = phrasing => rows.filter(row => row.phrasing === phrasing);
  const meanOf = (subset, key) => (subset.length ? subset.reduce((sum, row) => sum + row[key], 0) / subset.length : null);
  return {
    rankedRecall: mean("rankedRecall"),
    clusterRecall: mean("clusterRecall"),
    anchorFound: rows.filter(row => row.anchorRank).length / rows.length,
    offTopic: mean("offTopic"),
    maxDepthReturned: Math.max(...rows.map(row => row.maxDepthReturned)),
    verbatimRecall: meanOf(of("verbatim"), "rankedRecall"),
    paraphraseRecall: meanOf(of("paraphrase"), "rankedRecall")
  };
}

const base = Object.fromEntries(Object.entries(QUERY_TUNING.parameters).map(([key, spec]) => [key, spec.value]));
const pct = value => (value === null ? "  n/a" : `${(value * 100).toFixed(0).padStart(4)}%`);

// --- Balayage 1 : profondeur (decision-query-traversal-depth) ------------------
const depthSweep = [1, 2, 3, 4, 6].map(depth => {
  const rows = set.questions.map(question => measure(question, base, depth));
  return { depth, rows, summary: aggregate(rows) };
});

// --- Balayage 2 : mélange lexical / vectoriel (decision-query-lexical-vector-blend)
const blends = [[1, 0], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0, 1]];
const blendSweep = blends.map(([lexicalWeight, vectorWeight]) => {
  const tuning = { ...base, lexicalWeight, vectorWeight };
  const rows = set.questions.map(question => measure(question, tuning, base.maxDepth));
  return { lexicalWeight, vectorWeight, rows, summary: aggregate(rows) };
});

console.log(`Jeu de référence : ${set.questions.length} questions · corpus ${nodes.length} nœuds, ${links.length} relations\n`);

console.log("PROFONDEUR (mélange courant 0.72/0.28)");
console.log("prof | rappel classé | rappel cluster | ancrage | hors sujet | prof. atteinte | résultats identiques au défaut");
const defaultRanked = JSON.stringify(depthSweep.find(entry => entry.depth === base.maxDepth).rows.map(row => row.rankedIds));
for (const entry of depthSweep) {
  const same = JSON.stringify(entry.rows.map(row => row.rankedIds)) === defaultRanked;
  console.log(
    `${String(entry.depth).padStart(4)} | ${pct(entry.summary.rankedRecall)}         | ${pct(entry.summary.clusterRecall)}          | ${pct(entry.summary.anchorFound)}   | ${entry.summary.offTopic.toFixed(1).padStart(10)} | ${String(entry.summary.maxDepthReturned).padStart(14)} | ${same ? "oui" : "NON"}`
  );
}

console.log("\nMÉLANGE (profondeur courante)");
console.log("lex/vec  | rappel classé | ancrage | hors sujet | rappel verbatim | rappel paraphrase");
for (const entry of blendSweep) {
  console.log(
    `${entry.lexicalWeight.toFixed(2)}/${entry.vectorWeight.toFixed(2)} | ${pct(entry.summary.rankedRecall)}         | ${pct(entry.summary.anchorFound)}   | ${entry.summary.offTopic.toFixed(1).padStart(10)} | ${pct(entry.summary.verbatimRecall)}           | ${pct(entry.summary.paraphraseRecall)}`
  );
}

// --- Balayage 3 : seuil de propagation ----------------------------------------
// La profondeur ne peut être effective que si le score survit au saut suivant.
// Ce balayage teste l'option qui supprime la contrainte au lieu de la subir :
// abaisser le plancher plutôt que choisir entre 2, 3 et adaptatif.
const floorSweep = [0.02, 0.01, 0.005, 0.002, 0.001].map(propagationFloor => {
  const tuning = { ...base, propagationFloor };
  const rows = set.questions.map(question => measure(question, tuning, base.maxDepth));
  return { propagationFloor, rows, summary: aggregate(rows) };
});

console.log("\nSEUIL DE PROPAGATION (profondeur et mélange courants)");
console.log("seuil   | rappel classé | rappel cluster | hors sujet | prof. atteinte");
for (const entry of floorSweep) {
  console.log(
    `${entry.propagationFloor.toFixed(3)}   | ${pct(entry.summary.rankedRecall)}         | ${pct(entry.summary.clusterRecall)}          | ${entry.summary.offTopic.toFixed(1).padStart(10)} | ${String(entry.summary.maxDepthReturned).padStart(14)}`
  );
}

console.log("\nDÉTAIL au réglage courant");
const current = depthSweep.find(entry => entry.depth === base.maxDepth);
for (const row of current.rows) {
  const depths = Object.entries(row.byDepth).map(([depth, stat]) => `d${depth} ${stat.cluster}/${stat.expected}`).join(" · ");
  console.log(`  ${row.question.padEnd(32)} ancrage ${String(row.anchorRank ?? "absent").padStart(6)} · ${depths} · ${row.offTopic} hors sujet`);
}

if (outputPath) {
  const target = path.resolve(projectDir, outputPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify({
    set: set.id,
    corpus: { nodes: nodes.length, links: links.length },
    tuning: base,
    limits: set.limits,
    depthSweep: depthSweep.map(({ depth, summary, rows }) => ({ depth, summary, rows })),
    blendSweep: blendSweep.map(({ lexicalWeight, vectorWeight, summary, rows }) => ({ lexicalWeight, vectorWeight, summary, rows })),
    floorSweep: floorSweep.map(({ propagationFloor, summary, rows }) => ({ propagationFloor, summary, rows }))
  }, null, 2));
  console.log(`\nArtefact écrit : ${outputPath}`);
}
