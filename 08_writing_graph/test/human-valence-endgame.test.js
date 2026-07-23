import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = async relative => JSON.parse(await fs.readFile(path.resolve(__dirname, relative), "utf8"));
const ontology = await read("../data/graph-ontology.json");
const manifest = await read("../graphs.json");
const endgame = await read("../data/human-valence-endgame.json");
const nodes = new Map(endgame.nodes.map(node => [node.id, node]));

test("human valence is continuous while state orientation remains categorical", () => {
  assert.deepEqual(ontology.quantification.valenceScore.range, [-1, 1]);
  assert.deepEqual(ontology.quantification.humanValenceDelta.range, [-2, 2]);
  assert.equal(ontology.humanValence.scoreField, "valenceScore");
  assert.equal(ontology.humanValence.deltaField, "humanValenceDelta");
  assert.match(ontology.humanValence.unknownRule, /0 signifie.*neutre/u);
  assert.deepEqual(ontology.stateOrientation.values.map(value => value.id), ["desirable", "undesirable", "mixed"]);
  assert.equal(ontology.stateValence, undefined);
});

test("the graph defines terminal value without valuing a person", () => {
  const valence = nodes.get("term-human-valence");
  const created = nodes.get("term-mind-created-value");
  assert.equal(valence.semanticType || valence.nodeType, "terme");
  assert.match(valence.definition, /-1 à \+1/u);
  assert.match(valence.definition, /absence.*inconnu/u);
  assert.match(created.definition, /Part positive/u);
  assert.match(created.summary, /ni mérite personnel/u);
});

test("the progressive protocol contains the four authored sensor stages", () => {
  const stages = [
    "method-valence-stage-1-message-time",
    "method-valence-stage-2-biometrics",
    "method-valence-stage-3-behavior",
    "method-valence-stage-4-semantic-ai"
  ];
  for (const id of stages) {
    const node = nodes.get(id);
    const st = node?.semanticType || node?.nodeType;
    assert.equal(st, "method", `${id} is not a method`);
    assert.ok(endgame.links.some(link => link.source === id && link.target === "protocol-progressive-human-valence-estimation" && link.type === "PART_OF"), `${id} is outside the protocol`);
  }
  assert.match(nodes.get(stages[0]).summary, /jamais convertie directement en bonheur/u);
  assert.match(nodes.get(stages[3]).summary, /estimation contestable/u);
});

test("Mind pricing receives attributable delta, not raw intimate signals", () => {
  const pricing = "mechanism-mind-price-from-valence-delta";
  const incoming = endgame.links.filter(link => link.target === pricing);
  assert.ok(incoming.some(link => link.source === "metric-attributable-human-valence-delta" && link.type === "FEEDS"));
  assert.ok(incoming.some(link => link.source === "question-causal-attribution-of-valence" && link.type === "BLOCKS"));
  assert.ok(incoming.some(link => link.source === "question-interpersonal-valence-aggregation" && link.type === "BLOCKS"));
  assert.ok(!incoming.some(link => link.source.startsWith("method-valence-stage-")), "a raw sensor feeds pricing directly");
});

test("the valence endgame is an active declared dataset", () => {
  const design = manifest.graphs.find(graph => graph.id === "design");
  assert.ok(design.datasets.some(dataset => dataset.id === "human-valence-endgame" && dataset.file === "human-valence-endgame.json"));
});

test("active datasets no longer encode the old stateValence enum", async () => {
  const design = manifest.graphs.find(graph => graph.id === "design");
  for (const dataset of design.datasets) {
    const text = await fs.readFile(path.resolve(__dirname, "../data", dataset.file), "utf8");
    assert.ok(!text.includes('"stateValence"'), `${dataset.file} still carries stateValence`);
  }
});
