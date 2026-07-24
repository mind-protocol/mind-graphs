import test from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/corpus.js";
import { buildGraphQueryEngine } from "../public/graph-query.js";
import { loadManifest } from "../src/graph-manifest.js";

test("loadCorpus et buildGraphQueryEngine fonctionnent pour tous les graphes de graphs.json", async () => {
  const manifest = await loadManifest();
  const activeGraphs = manifest.graphs.filter(g => g.status === "active");

  for (const graphSpec of activeGraphs) {
    const corpus = await loadCorpus(graphSpec.id);
    assert.ok(Array.isArray(corpus.nodes), `nœuds valides pour ${graphSpec.id}`);
    assert.ok(Array.isArray(corpus.links), `relations valides pour ${graphSpec.id}`);

    const engine = buildGraphQueryEngine(corpus.nodes, corpus.links);
    assert.ok(engine, `moteur construit pour ${graphSpec.id}`);

    const result = engine.query("test query");
    assert.ok(result, `résultat retourné pour ${graphSpec.id}`);
    assert.equal(result.question, "test query");
  }
});

test("interrogation de graphes spécifiques retourne des résultats pertinents quand ils sont peuplés", async () => {
  // Graphe de design
  const designCorpus = await loadCorpus("design");
  const designEngine = buildGraphQueryEngine(designCorpus.nodes, designCorpus.links);
  const designResult = designEngine.query("simulation économique");
  assert.ok(designResult.nodes.length > 0, "nœuds trouvés dans le graphe de design");

  // Graphe l2-mind-graphs
  const l2Corpus = await loadCorpus("l2-mind-graphs");
  const l2Engine = buildGraphQueryEngine(l2Corpus.nodes, l2Corpus.links);
  const l2Result = l2Engine.query("Mind Protocol");
  assert.ok(l2Result.nodes.length > 0, "nœuds trouvés dans l2-mind-graphs");

  // Graphe l1-nlr-ai
  const l1Corpus = await loadCorpus("l1-nlr-ai");
  const l1Engine = buildGraphQueryEngine(l1Corpus.nodes, l1Corpus.links);
  const l1Result = l1Engine.query("nlr");
  assert.ok(l1Result.nodes.length > 0, "nœuds trouvés dans l1-nlr-ai");
});

test("résolution des noms de graphes FalkorDB pour cypher_graph", async () => {
  const manifest = await loadManifest();
  const mapping = {
    design: "mind_causal",
    science: "mind_science",
    "l1-nlr-ai": "l1_nlr_ai",
    "l2-mind-graphs": "l2_mind_graphs",
    "l3-ecosystem": "l3_ecosystem",
    "l4-registry": "mind_l4_registry",
    "l4-kernel": "mind_l4_kernel"
  };

  for (const [graphId, expectedFalkorName] of Object.entries(mapping)) {
    const spec = manifest.graphs.find(g => g.id === graphId);
    assert.ok(spec, `graphe ${graphId} déclaré`);
    assert.equal(spec.falkorGraph, expectedFalkorName, `nom falkor exact pour ${graphId}`);
  }
});
