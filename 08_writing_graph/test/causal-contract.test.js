// Verrous des arbitrages de nomenclature causale. Chacun de ces tests correspond à un défaut
// réel trouvé dans le corpus : ils existent pour que le défaut ne puisse pas revenir.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadCorpus } from "../src/corpus.js";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));
const { nodes, links } = await loadCorpus();
const typeById = new Map(nodes.map(node => [node.id, node.nodeType]));

function allowedTargets(relationId) {
  const constraint = ontology.relationConstraints[relationId];
  const allowed = new Set(constraint.targetTypes || []);
  for (const group of constraint.targetGroups || []) {
    for (const type of ontology.typeGroups[group] || []) allowed.add(type);
  }
  return allowed;
}

// Le défaut d'origine : la contrainte refusait `metric`, cible canonique du contrat, et
// acceptait `design_effect`, que le contrat interdit. Elle était l'inverse exact du contrat.
test("la contrainte CAUSES accepte les cibles canoniques du contrat causal", () => {
  const allowed = allowedTargets("CAUSES");
  for (const type of ontology.causalContract.canonicalCause.canonicalTargetTypes) {
    assert.ok(allowed.has(type), `le contrat désigne ${type} comme cible canonique mais la contrainte la refuse`);
  }
});

test("la contrainte CAUSES refuse design_effect, que le contrat réserve à MOTIVATES", () => {
  assert.equal(allowedTargets("CAUSES").has("design_effect"), false);
});

test("aucune arête causale ne vise un effet recherché dans le corpus", () => {
  const offenders = links
    .filter(link => ["CAUSES", "LEADS_TO"].includes(link.type) && typeById.get(link.target) === "design_effect")
    .map(link => `${link.source} -[${link.type}]-> ${link.target}`);
  assert.deepEqual(offenders, []);
});

test("un seul prédicat de blocage subsiste, et il accepte les décisions non prises", () => {
  const ids = new Set(ontology.relationTypes.map(type => type.id));
  assert.equal(ids.has("CONSTRAINS"), false, "CONSTRAINS doit avoir été absorbé par BLOCKS");
  assert.ok(ontology.relationConstraints.BLOCKS.sourceTypes.includes("decision"));
  assert.deepEqual(ontology.traversalContract.unansweredQuestion.blockingRelations, ["BLOCKS"]);
  assert.equal(links.filter(link => link.type === "CONSTRAINS").length, 0);
});

// Le piège de l orientation : une seconde graphie ne casse rien à l'exécution, elle rend la
// détection de contradictions silencieusement partielle.
test("toutes les orientations d’état utilisent les identifiants déclarés", () => {
  const allowed = new Set(ontology.stateOrientation.values.map(value => value.id));
  const offenders = nodes
    .filter(node => node.nodeType === "system_state")
    .filter(node => !allowed.has(node.stateOrientation))
    .map(node => `${node.id}: ${node.stateOrientation}`);
  assert.deepEqual(offenders, []);
});

// Ce test aurait attrapé `UNLOCKS.canonicalPredicate = "ENABLES"`, resté des mois à pointer
// vers un prédicat qui n'a jamais existé.
test("aucun canonicalPredicate ne pointe vers un prédicat inexistant", () => {
  const ids = new Set(ontology.relationTypes.map(type => type.id));
  const dangling = ontology.relationTypes
    .filter(type => type.canonicalPredicate && !ids.has(type.canonicalPredicate))
    .map(type => `${type.id} → ${type.canonicalPredicate}`);
  assert.deepEqual(dangling, []);
});

// Un retypage doit rester traçable : on ne réécrit pas l'histoire d'une relation en silence.
test("chaque relation migrée conserve la trace de son prédicat d’origine", () => {
  const migrated = links.filter(link => link.migratedFrom);
  assert.ok(migrated.length > 0, "la migration de nomenclature doit être traçable");
  for (const link of migrated) {
    assert.equal(typeof link.migratedFrom, "string");
    assert.ok(String(link.justification || "").trim(), `${link.source}→${link.target} a perdu sa justification`);
  }
});
