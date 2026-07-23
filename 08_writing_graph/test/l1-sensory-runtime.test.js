import test from "node:test";
import assert from "node:assert/strict";
import {
  embedSensoryLines,
  routeSensoryEnergy,
  runSensoryTick,
  selectCitizenConnections,
  serializeSensoryConnection
} from "../src/l1-sensory-runtime.js";

const now = Date.parse("2026-07-23T12:00:00Z");
const graphs = [
  {
    id: "design",
    nodes: [
      { id: "actor-nlr", name: "NLR", citizen: true },
      { id: "goal-a", name: "Question ouverte" },
      { id: "old-weak", name: "Ancien détail" },
      { id: "other", name: "Autre acteur" }
    ],
    links: [
      { source: "actor-nlr", target: "goal-a", type: "PURSUES", physics: { W: 0.9 }, justification: "Objectif actif." },
      { source: "actor-nlr", target: "old-weak", type: "KNOWS", physics: { W: 0.1 }, updatedAt: "2026-01-01T00:00:00Z" },
      { source: "other", target: "goal-a", type: "RELATED_TO", physics: { W: 1 } }
    ]
  },
  {
    id: "l1",
    nodes: [
      { id: "self-nlr", name: "Le citoyen", correspondsTo: "actor-nlr" },
      { id: "recent-memory", name: "Mémoire récente" }
    ],
    links: [
      { source: "recent-memory", target: "self-nlr", type: "DESCRIBES", physics: { W: 0.2 }, updatedAt: "2026-07-23T11:59:30Z", justification: "Entrée récente." }
    ]
  },
  {
    id: "private",
    readAllowed: false,
    nodes: [{ id: "actor-nlr", citizen: true }, { id: "secret" }],
    links: [{ source: "actor-nlr", target: "secret", type: "KNOWS", physics: { W: 1 } }]
  }
];

const selectionConfig = {
  citizenIds: ["actor-nlr"],
  minWeight: 0.8,
  recentWindowMs: 60_000,
  now
};

test("sensor selection keeps strong OR recent citizen connections across authorized graphs", () => {
  const selected = selectCitizenConnections(graphs, selectionConfig);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(connection => connection.graphId), ["design", "l1"]);
  assert.equal(selected[0].selectedBecause.strong, true);
  assert.equal(selected[1].selectedBecause.recent, true);
});

test("sensor selection excludes unrelated, weak old and unauthorized connections", () => {
  const selected = selectCitizenConnections(graphs, selectionConfig);
  assert.ok(!selected.some(connection => connection.target === "old-weak"));
  assert.ok(!selected.some(connection => connection.source === "other"));
  assert.ok(!selected.some(connection => connection.graphId === "private"));
});

test("each selected relation becomes one traceable sensory line", () => {
  const [connection] = selectCitizenConnections(graphs, selectionConfig);
  assert.equal(serializeSensoryConnection(connection), "[design] NLR —PURSUES→ Question ouverte | raison: Objectif actif.");
});

test("embedding cache prevents recomputing an unchanged sensory line", async () => {
  const selected = selectCitizenConnections(graphs, selectionConfig);
  const cache = new Map();
  let calls = 0;
  const embed = async line => { calls += 1; return line.includes("Objectif") ? [1, 0] : [0, 1]; };
  await embedSensoryLines(selected, { embed, cache });
  await embedSensoryLines(selected, { embed, cache });
  assert.equal(calls, selected.length);
});

test("similarity routing conserves the citizen sensory budget", () => {
  const embeddedLines = [
    { graphId: "design", source: "actor-nlr", target: "goal-a", link: { type: "PURSUES" }, sensoryLine: "goal", sensoryLineHash: "a", embedding: [1, 0] },
    { graphId: "l1", source: "recent-memory", target: "self-nlr", link: { type: "DESCRIBES" }, sensoryLine: "memory", sensoryLineHash: "b", embedding: [0, 1] }
  ];
  const result = routeSensoryEnergy(embeddedLines, [
    { id: "goal-node", embedding: [1, 0] },
    { id: "memory-node", embedding: [0, 1] },
    { id: "mixed-node", embedding: [0.7, 0.7] }
  ], { sensoryEnergyBudget: 4, minSimilarity: 0.6, topK: 2, citizenId: "actor-nlr", tickId: "tick-1" });
  assert.ok(Math.abs(result.allocatedEnergy - 4) < 1e-10);
  assert.equal(result.unallocatedEnergy, 0);
  assert.ok(result.transfers.every(transfer => transfer.sourceCitizenId === "actor-nlr"));
  assert.ok(result.transfers.every(transfer => transfer.tickId === "tick-1"));
});

test("a complete sensory tick embeds every line and routes only to similar L1 nodes", async () => {
  const result = await runSensoryTick({
    graphs,
    l1Nodes: [{ id: "goal-node", embedding: [1, 0] }, { id: "memory-node", embedding: [0, 1] }],
    embed: async line => line.includes("Objectif") ? [1, 0] : [0, 1],
    config: {
      ...selectionConfig,
      sensoryEnergyBudget: 2,
      minSimilarity: 0.8,
      topK: 1,
      citizenId: "actor-nlr",
      tickId: "tick-2"
    }
  });
  assert.equal(result.embeddedLines.length, 2);
  assert.deepEqual(result.transfers.map(transfer => transfer.targetNodeId), ["goal-node", "memory-node"]);
  assert.equal(result.allocatedEnergy, 2);
});

test("the sensory runtime refuses implicit thresholds", async () => {
  await assert.rejects(() => runSensoryTick({ graphs, l1Nodes: [], embed: async () => [1] }), /explicit config/);
});
