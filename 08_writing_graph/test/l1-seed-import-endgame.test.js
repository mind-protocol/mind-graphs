import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = async relative => JSON.parse(await fs.readFile(path.resolve(__dirname, relative), "utf8"));
const ontology = await read("../data/graph-ontology.json");
const manifest = await read("../graphs.json");
const seedImport = await read("../data/l1-seed-import-endgame.json");
const blueprint = await read("../data/l1-blueprint.json");
const nodes = new Map(seedImport.nodes.map(node => [node.id, node]));
const st = node => node?.semanticType || node?.nodeType;

test("the import contract keeps atomization, provenance and claim nature together", () => {
  const contract = ontology.importContract;
  assert.equal(contract.pipelineNode, "mech-l1-seed-import-pipeline");
  assert.deepEqual(contract.claimNatures, ["declared_fact", "observation", "inference", "preference"]);
  for (const field of ["sourceArtifact", "sourceLocator", "extractedAt", "extractionMethod", "confidenceScore", "claimNature"]) {
    assert.ok(contract.atomProvenanceFields.includes(field), `${field} is no longer required on an imported atom`);
  }
  assert.match(contract.atomizationRule, /jamais.*entier|Aucun artefact n entre entier/u);
  assert.match(contract.inferenceRule, /quantité de données ne change pas le statut/u);
});

// L'échelle vit des deux côtés : une catégorie sans méthode annonce une capacité
// que rien ne décrit, une méthode hors échelle entre dans le seed sans doctrine.
test("every declared source kind is carried by exactly one import method", () => {
  const contract = ontology.importContract;
  const declared = contract.sourceLadder.map(source => source.id);
  assert.deepEqual(declared, ["documents", "photos", "videos", "cloud_drive"]);
  const carried = seedImport.nodes.filter(node => node[contract.sourceKindField]);
  assert.deepEqual(carried.map(node => node[contract.sourceKindField]).sort(), [...declared].sort());
  for (const node of carried) {
    assert.equal(st(node), "method", `${node.id} carries a source kind without being a method`);
    assert.ok(seedImport.links.some(link =>
      link.source === node.id && link.type === "PART_OF" && link.target === contract.pipelineNode), `${node.id} is outside the pipeline`);
  }
});

// C'est la couture entre les deux districts : le blueprint interdit à l'éditeur de
// préremplir une vie, l'import remplit la même place avec la matière de la personne.
// Si cette justification disparaît, les deux axiomes deviennent contradictoires.
test("a full seed does not contradict the prohibition on prefilling a life", () => {
  const axiom = nodes.get("axiom-seed-filled-only-by-the-persons-own-data");
  assert.equal(st(axiom), "axiom");
  assert.ok(seedImport.links.some(link =>
    link.source === axiom.id && link.type === "SUBCASE_OF" && link.target === "axiom-structure-universal-content-sovereign"));
  const seam = seedImport.links.find(link =>
    link.source === "mech-l1-seed-import-pipeline" && link.type === "FEEDS" && link.target === "mech-l1-empty-slots");
  assert.ok(seam, "nothing connects the import to the slots the blueprint leaves empty");
  assert.match(seam.justification, /matière transportée vient de la personne/u);
  assert.match(ontology.blueprintContract.seedImportRule, /pas ce que le citoyen apporte/u);
});

test("the pipeline addresses the seed question without closing it", () => {
  assert.ok(seedImport.links.some(link =>
    link.source === "mech-l1-seed-import-pipeline" && link.type === "ADDRESSES" && link.target === "question-l1-seed-contents"));
  const question = blueprint.nodes.find(node => node.id === "question-l1-seed-contents");
  assert.equal(question.epistemicStatus, "unresolved", "an ADDRESSES link must not resolve the question it answers");
});

test("forgetting, third parties and fabrication each stay refutable", () => {
  const states = seedImport.nodes.filter(node => st(node) === "system_state");
  assert.ok(states.some(state => state.stateOrientation === "desirable"));
  assert.deepEqual(states.filter(state => state.stateOrientation === "undesirable").map(state => state.id).sort(), [
    "state-import-absorbs-third-parties",
    "state-import-makes-forgetting-impossible",
    "state-seed-fabricates-a-false-person"
  ]);
  for (const state of states) {
    assert.ok(seedImport.links.some(link => link.source === state.id && link.type === "MEASURED_BY"), `${state.id} is unobservable`);
  }
});

test("fidelity is never measured by the model that produced the seed", () => {
  assert.match(ontology.importContract.fidelityRule, /jamais auprès du modèle/u);
  assert.match(nodes.get("effect-seed-close-to-the-lived-life").summary, /jugée par un modèle ne compte pas/u);
  assert.ok(seedImport.links.some(link =>
    link.source === "question-seed-fidelity-without-model-verdict"
    && link.type === "BLOCKS"
    && link.target === "effect-seed-close-to-the-lived-life"));
});

// La consultation du 22 juillet 2026 a rapporté un protocole. Ce test verrouille les
// deux choses que la doctrine interdit d'en faire : un chiffre, et une clôture.
test("the external consultation produced a protocol, never a number", async () => {
  const consultations = await read("../data/consultations.json");
  const consultation = "consultation-personal-ai-preference-prediction";
  const replies = consultations.links
    .filter(link => link.type === "ANSWERS" && link.target === consultation)
    .map(link => link.source);
  assert.equal(replies.length, 5);
  const byId = new Map(consultations.nodes.map(node => [node.id, node]));
  for (const id of replies) {
    for (const field of ["probabilityPct", "confidenceScore", "effectSizePct"]) {
      assert.equal(byId.get(id)[field], undefined, `${id} turns a reply into a number`);
    }
    assert.ok(consultations.links.some(link => link.type === "AUTHORED_BY" && link.source === id), `${id} is unattributed`);
  }
  for (const id of ["reddit-method-preregistered-blinded-prediction", "reddit-method-self-consistency-ceiling", "reddit-method-four-predictors-proper-scoring"]) {
    assert.ok(seedImport.links.some(link =>
      link.source === id && link.type === "PART_OF" && link.target === "protocol-preregistered-seed-fidelity-test"), `${id} was harvested without becoming work`);
  }
  const question = nodes.get("question-seed-fidelity-without-model-verdict");
  assert.equal(question.epistemicStatus, "unresolved", "a harvested consultation must not close its own question");
});

test("the two scope limits stay axioms rather than results", () => {
  for (const id of ["axiom-no-inner-truth-to-read", "axiom-prediction-is-not-understanding"]) {
    const axiom = nodes.get(id);
    assert.equal(st(axiom), "axiom");
    assert.equal(axiom.epistemicStatus, "design_proposal");
  }
  assert.ok(seedImport.links.some(link =>
    link.source === "axiom-prediction-is-not-understanding"
    && link.type === "SAFEGUARDS"
    && link.target === "effect-seed-close-to-the-lived-life"));
  assert.ok(seedImport.links.some(link =>
    link.source === "reddit-claim-prediction-is-not-understanding"
    && link.type === "MOTIVATES"
    && link.target === "axiom-prediction-is-not-understanding"), "the reported position no longer motivates the axiom it produced");
});

test("state dependence blocks fidelity, correction and valence alike", () => {
  const blocked = seedImport.links
    .filter(link => link.source === "question-which-self-is-the-ground-truth" && link.type === "BLOCKS")
    .map(link => link.target)
    .sort();
  assert.deepEqual(blocked, [
    "effect-seed-close-to-the-lived-life",
    "mech-import-personal-correction-loop",
    "protocol-progressive-human-valence-estimation"
  ]);
});

test("the seed import endgame is an active declared dataset", () => {
  const design = manifest.graphs.find(graph => graph.id === "design");
  assert.ok(design.datasets.some(dataset => dataset.id === "l1-seed-import-endgame" && dataset.file === "l1-seed-import-endgame.json"));
});
