import test from "node:test";
import assert from "node:assert/strict";
import { buildPhysicsIndex, createState, summarize, cosineSimilarity, setCitizenWorkspace } from "../src/l4-physics.js";
import { createLocalEmbedder, embedNodes } from "../src/local-embedding.js";
import { tickCitizenWithSenses } from "../src/l1-sensory-l4-bridge.js";

test("the local embedder is deterministic and rewards shared words", async () => {
  const embed = createLocalEmbedder({ dimensions: 64 });
  const first = await embed("question bloquée rapport");
  const again = await embed("question bloquée rapport");
  const related = await embed("résoudre la question bloquée");
  const distant = await embed("musique couleur jardin");
  assert.deepEqual(first, again);
  assert.ok(cosineSimilarity(first, related) > cosineSimilarity(first, distant));
});

test("an integrated sensory tick spends one citizen budget, not two pumps", async () => {
  const nodes = [
    { id: "C", nodeType: "Actor", semanticType: "CitizenRole", citizen: true, weight: 1, name: "Citizen" },
    { id: "goal", nodeType: "Narrative", semanticType: "Goal", name: "Question active", embedding: [1, 0] },
    { id: "other", nodeType: "Thing", semanticType: "Context", name: "Contexte", embedding: [0, 1] }
  ];
  const links = [
    { source: "C", target: "other", type: "FEEDS", physics: { W: 1, P: 1, G: 1, S: 0.8 } },
    { source: "goal", target: "other", type: "FEEDS", physics: { W: 1, P: 1, G: 1, S: 0.8 } }
  ];
  const index = buildPhysicsIndex(nodes, links, []);
  const state = createState(index);
  const result = await tickCitizenWithSenses({
    state,
    index,
    citizenId: "C",
    sourceGraphs: [{
      id: "external",
      nodes: [{ id: "C", citizen: true, name: "Citizen" }, { id: "q", name: "Question active" }],
      links: [{ source: "C", target: "q", type: "PURSUES", physics: { W: 1 }, justification: "Question à résoudre." }]
    }],
    l1Nodes: nodes,
    embed: async () => [1, 0],
    sensoryConfig: {
      citizenIds: ["C"], minWeight: 0.8, recentWindowMs: 1000, now: 1000,
      minSimilarity: 0.8, topK: 1, sensoryEnergyBudget: 0.6, tickId: "tick-1"
    }
  });
  assert.equal(result.totalBudget, 1);
  assert.equal(result.sensoryAllocated, 0.6);
  assert.ok(Math.abs(result.localBudget - 0.4) < 1e-12);
  assert.equal(state.injected, 1);
  assert.equal(state.tick, 1);
  assert.ok(summarize(state, index).totalEnergy > 0);
  const citizens = new Set([...state.flows.values()].flatMap(bucket => [...bucket.values()].map(flow => flow.citizenId)));
  assert.deepEqual([...citizens], ["C"]);
});

test("unmatched sensory energy returns to the citizen local budget", async () => {
  const nodes = [
    { id: "C", nodeType: "Actor", citizen: true },
    { id: "local", nodeType: "Thing", embedding: [0, 1] }
  ];
  const links = [{ source: "C", target: "local", type: "FEEDS", physics: { W: 1, P: 1, G: 1, S: 1 } }];
  const index = buildPhysicsIndex(nodes, links, []);
  const state = createState(index);
  const result = await tickCitizenWithSenses({
    state, index, citizenId: "C",
    sourceGraphs: [{ id: "g", nodes: [{ id: "C", citizen: true }, { id: "x" }], links: [{ source: "C", target: "x", type: "SEES", physics: { W: 1 } }] }],
    l1Nodes: nodes,
    embed: async () => [1, 0],
    sensoryConfig: { citizenIds: ["C"], minWeight: 0.8, recentWindowMs: 0, now: 0, minSimilarity: 0.9, topK: 1, sensoryEnergyBudget: 0.5, tickId: "tick-2" }
  });
  assert.equal(result.sensoryAllocated, 0);
  assert.equal(result.localBudget, 1);
  assert.equal(state.injected, 1);
});

test("the sensory bridge reads the active entity from the citizen L4 workspace", async () => {
  const nodes = [
    { id: "C", nodeType: "Actor", citizen: true },
    { id: "target", nodeType: "Thing", embedding: [1, 0] }
  ];
  const links = [{ source: "C", target: "target", type: "FEEDS", physics: { W: 1, P: 1, G: 1, S: 1 } }];
  const index = buildPhysicsIndex(nodes, links, []);
  const state = createState(index);
  setCitizenWorkspace(state, "C", {
    id: "workspace-C",
    embedding: [1, 0],
    activeEntity: { id: "protector", attentionalOrientation: "internal", focusIntensity: 1, homeostaticError: 1 }
  });
  const result = await tickCitizenWithSenses({
    state, index, citizenId: "C",
    sourceGraphs: [{ id: "g", nodes: [{ id: "C", citizen: true }, { id: "x" }], links: [{ source: "C", target: "x", type: "SEES", physics: { W: 1 } }] }],
    l1Nodes: nodes,
    embed: async () => [1, 0],
    sensoryConfig: { citizenIds: ["C"], minWeight: 0.8, recentWindowMs: 0, now: 0, minSimilarity: 0.9, topK: 1, tickId: "tick-workspace" }
  });
  assert.equal(result.attention.workspace.entityId, "protector");
  assert.equal(result.attention.workspace.orientation, "internal");
  assert.ok(result.attention.sensoryShare < 0.5);
  assert.equal(state.workspaces.get("C").innerOuterFocus, result.attention.focusDynamics.nextFocus);
  assert.deepEqual(state.workspaces.get("C").focusDynamics, result.attention.focusDynamics);
});

test("node embeddings can be prepared locally without changing authored fields", async () => {
  const nodes = [{ id: "n", name: "Question bloquée", semanticType: "OpenQuestion" }];
  const embedded = await embedNodes(nodes, createLocalEmbedder({ dimensions: 32 }));
  assert.equal(embedded[0].id, "n");
  assert.equal(embedded[0].embedding.length, 32);
  assert.equal(nodes[0].embedding, undefined);
});
