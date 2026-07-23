import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = async relative => JSON.parse(await fs.readFile(path.resolve(__dirname, relative), "utf8"));
const ontology = await read("../data/graph-ontology.json");
const manifest = await read("../graphs.json");
const blueprint = await read("../data/l1-blueprint.json");
const nodes = new Map(blueprint.nodes.map(node => [node.id, node]));

test("the blueprint contract separates a universal structure from a sovereign content", () => {
  const contract = ontology.blueprintContract;
  assert.equal(contract.constitutionalAxiom, "axiom-structure-universal-content-sovereign");
  assert.deepEqual(contract.layers.map(layer => layer.id), ["constitution", "seed", "citizen_state"]);
  assert.match(contract.universalityRule, /jamais un fait, une préférence ou une croyance/u);
  assert.match(contract.forkRule, /proposées, jamais poussées/u);
});

// L'interdit ne vaut que s'il est énuméré des deux côtés. Une catégorie retirée du
// graphe mais conservée dans le schéma laisserait une garantie affichée que plus
// rien ne soutient — le validateur ferme ce cas, ce test ferme sa régression.
const st = node => node.semanticType || node.nodeType;

test("every prohibited prefill is carried by the prohibition axiom itself", () => {
  const contract = ontology.blueprintContract;
  const axiom = nodes.get(contract.prohibitionAxiom);
  assert.equal(st(axiom), "axiom");
  assert.deepEqual([...axiom[contract.prohibitionField]].sort(), [...contract.prohibitedPrefills].sort());
  for (const category of ["personal_facts", "inferred_psychology", "biometrics", "wellbeing_baseline", "beliefs_as_universal_truth"]) {
    assert.ok(contract.prohibitedPrefills.includes(category), `${category} is no longer prohibited at birth`);
  }
});

test("the blueprint describes capabilities and leaves the seed explicitly open", () => {
  const capabilities = nodes.get("mech-l1-capability-set");
  assert.match(capabilities.phrase, /Mémoriser, oublier, corriger, contester, déléguer, décider, mesurer la valence, migrer/u);
  const seedQuestion = nodes.get("question-l1-seed-contents");
  assert.equal(st(seedQuestion), "open_question");
  assert.equal(seedQuestion.epistemicStatus, "unresolved");
  assert.ok(blueprint.links.some(link =>
    link.source === "question-l1-seed-contents" && link.type === "BLOCKS" && link.target === "mech-l1-empty-slots"));
  assert.ok(!blueprint.nodes.some(node => /seed/u.test(node.id) && st(node) === "mechanism"),
    "the seed is specified as a mechanism while it is still an open question");
});

test("every part of the blueprint hangs from the central artefact, which hangs from L1", () => {
  const parts = blueprint.nodes.filter(node => st(node) === "mechanism" && node.id !== "mech-l1-blueprint");
  for (const part of parts) {
    assert.ok(blueprint.links.some(link =>
      link.source === part.id && link.type === "PART_OF" && link.target === "mech-l1-blueprint"), `${part.id} floats outside the blueprint`);
  }
  assert.ok(blueprint.links.some(link =>
    link.source === "mech-l1-blueprint" && link.type === "PART_OF" && link.target === "repo-layer-l1"));
});

// Un périmètre qui ne déclare que sa cible décrit un souhait. Les deux risques
// nommés ici sont ceux qu'un blueprint produit par construction : préinstaller une
// vision du monde, et devenir le canal d'écriture qu'il prétendait empêcher.
test("the scope stays refutable by naming what would make it fail", () => {
  const states = blueprint.nodes.filter(node => st(node) === "system_state");
  assert.ok(states.some(state => state.stateOrientation === "desirable"));
  const undesirable = states.filter(state => state.stateOrientation === "undesirable").map(state => state.id);
  assert.deepEqual(undesirable.sort(), ["state-l1-blueprint-becomes-central-authority", "state-l1-worldview-preinstalled"]);
  for (const state of states) {
    assert.ok(blueprint.links.some(link => link.source === state.id && link.type === "MEASURED_BY"), `${state.id} is unobservable`);
  }
});

test("the constitutional axiom is blocked until its amendment authority is named", () => {
  assert.ok(blueprint.links.some(link =>
    link.source === "question-l1-constitution-amendment-authority"
    && link.type === "BLOCKS"
    && link.target === "axiom-structure-universal-content-sovereign"));
});

test("the L1 blueprint is an active declared dataset", () => {
  const design = manifest.graphs.find(graph => graph.id === "design");
  assert.ok(design.datasets.some(dataset => dataset.id === "l1-blueprint" && dataset.file === "l1-blueprint.json"));
});
