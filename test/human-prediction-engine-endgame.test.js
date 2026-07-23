import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = async relative => JSON.parse(await fs.readFile(path.resolve(__dirname, relative), "utf8"));
const ontology = await read("../data/graph-ontology.json");
const manifest = await read("../graphs.json");
const engine = await read("../data/human-prediction-engine-endgame.json");
const nodes = new Map(engine.nodes.map(node => [node.id, node]));

test("the prediction contract keeps the ledger sealed and the score relative", () => {
  const contract = ontology.predictionContract;
  assert.equal(contract.engineNode, "mech-continuous-prediction-engine");
  assert.match(contract.ledgerRule, /append-only/u);
  assert.match(contract.scoringRule, /baseline construite sur les régularités passées/u);
  assert.match(contract.scoringRule, /exactitude brute est refusée/u);
});

// Les trois dangers propres à ce dispositif. Chacun a une règle dans le schéma,
// un état indésirable mesuré dans le graphe, et un axiome que cet état motive.
test("acting on a prediction never trains the model of the person", () => {
  assert.match(ontology.predictionContract.contaminationRule, /jamais le modèle de la personne/u);
  assert.ok(engine.links.some(link =>
    link.source === "state-prediction-becomes-self-fulfilling"
    && link.type === "MOTIVATES"
    && link.target === "axiom-acted-prediction-does-not-train-the-person-model"));
  assert.ok(engine.links.some(link =>
    link.source === "metric-contaminated-prediction-share"
    && link.type === "FEEDS"
    && link.target === "mech-observational-interventional-split"));
});

test("predictability is watched but never optimised", () => {
  assert.match(ontology.predictionContract.predictabilityRule, /n est jamais une cible/u);
  const surprise = nodes.get("metric-surprise-rate");
  assert.match(surprise.summary, /jamais une cible d'optimisation/u);
  const fed = engine.links.filter(link => link.source === "metric-surprise-rate" && link.type === "FEEDS").map(link => link.target);
  assert.deepEqual(fed, ["mech-drift-attribution"], "the surprise rate must not feed the learning loop itself");
});

test("every restricted domain is carried by the restraint node itself", () => {
  const contract = ontology.predictionContract;
  const node = nodes.get(contract.restrictionNode);
  assert.equal(node.semanticType || node.nodeType, "mechanism");
  assert.deepEqual([...node[contract.restrictionField]].sort(), [...contract.restrictedDomains].sort());
  assert.match(contract.restrictionScope, /jamais sur l escalade humaine/u);
  assert.ok(engine.links.some(link =>
    link.source === "dem-human-escalation" && link.type === "SAFEGUARDS" && link.target === contract.restrictionNode),
    "restraint is not articulated with human escalation");
});

test("continuous prediction addresses the fidelity lock without inheriting its blindness", () => {
  assert.ok(engine.links.some(link =>
    link.source === "hypothesis-continuous-prediction-dissolves-self-report-problem"
    && link.type === "ADDRESSES"
    && link.target === "question-seed-fidelity-without-model-verdict"));
  const hypothesis = nodes.get("hypothesis-continuous-prediction-dissolves-self-report-problem");
  assert.equal(hypothesis.epistemicStatus, "working_hypothesis");
  assert.match(hypothesis.summary, /le choix de ce qui est prédit/u);
  assert.ok(engine.links.some(link =>
    link.source === "question-which-self-is-the-ground-truth"
    && link.type === "BLOCKS"
    && link.target === "mech-skill-scoring-against-routine-baseline"), "state dependence no longer reaches the routine baseline");
});

test("a competent engine is never enough on its own", () => {
  const states = engine.nodes.filter(node => (node.semanticType || node.nodeType) === "system_state");
  assert.deepEqual(states.filter(state => state.stateOrientation === "undesirable").map(state => state.id).sort(), [
    "state-person-optimized-for-predictability",
    "state-prediction-becomes-self-fulfilling",
    "state-prediction-log-becomes-a-dossier"
  ]);
  for (const state of states) {
    assert.ok(engine.links.some(link => link.source === state.id && link.type === "MEASURED_BY"), `${state.id} is unobservable`);
  }
  assert.match(nodes.get("state-engine-calibrated-and-humble").summary, /deux sur trois/u);
  assert.match(nodes.get("horizon-model-useful-and-still-wrong").summary, /n'est pas la réussite de cet horizon mais sa négation/u);
});

test("the prediction engine is an active declared dataset", () => {
  const design = manifest.graphs.find(graph => graph.id === "design");
  assert.ok(design.datasets.some(dataset => dataset.id === "human-prediction-engine-endgame" && dataset.file === "human-prediction-engine-endgame.json"));
});
