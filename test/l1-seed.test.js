import test from "node:test";
import assert from "node:assert/strict";
import { normalizeL1EpistemicStatus, prepareL1Seed, seedL1Graph } from "../src/l1-seed.js";

const graphConfig = {
  id: "l1-test",
  blueprintSync: {
    enabled: true,
    source: "blueprint.json",
    requiredOnSeed: true,
    scopeFacet: null
  }
};
const ontology = {
  nodeTypes: [{ id: "memory", epistemicStatus: "declared" }],
  relationTypes: [{ id: "DESCRIBES" }],
  epistemicStatuses: [
    { id: "declared" },
    { id: "observed" },
    { id: "inferred" },
    { id: "pending" }
  ]
};
const datasets = [{
  data: {
    nodes: [{ id: "personal-memory", nodeType: "memory", content: "personal" }],
    links: [{
      source: "personal-memory",
      type: "DESCRIBES",
      target: "personal-memory",
      justification: "fixture relation"
    }]
  },
  spec: {}
}];
const blueprint = {
  graphId: "blueprint",
  schemaVersion: "1",
  nodes: [{ id: "blueprint-space", nodeType: "Space", facets: ["blueprint"] }],
  relations: []
};

test("seed always applies the complete Blueprint after personal content", async () => {
  const calls = [];
  const graph = {
    query: async (query, options) => {
      calls.push({ query, options });
      return { data: [] };
    }
  };
  let syncInput = null;
  const result = await seedL1Graph({
    graph,
    graphConfig,
    ontology,
    datasets,
    blueprint,
    syncBlueprint: async input => {
      syncInput = input;
      return {
        applied: true,
        status: "current",
        plan: { counts: { desiredNodes: 1, desiredRelations: 0 } }
      };
    }
  });
  assert.equal(syncInput.apply, true);
  assert.equal(syncInput.blueprint, blueprint);
  assert.ok(calls.some(call => call.query.includes("CREATE (n:L1Node)")));
  assert.ok(calls.some(call => call.query.includes("CREATE (s)-[r:DESCRIBES]->(t)")));
  assert.equal(result.personalNodes, 1);
  assert.equal(result.personalRelations, 1);
  assert.equal(result.blueprintNodes, 1);
});

test("missing Blueprint fails before any destructive query", async () => {
  let writes = 0;
  const graph = { query: async () => { writes += 1; return { data: [] }; } };
  await assert.rejects(() => seedL1Graph({
    graph,
    graphConfig,
    ontology,
    datasets,
    blueprint: null
  }), /Blueprint L1 complet/);
  assert.equal(writes, 0);
});

test("a L1 graph cannot opt out of Blueprint copying", () => {
  assert.throws(() => prepareL1Seed({
    graphConfig: { id: "bad", blueprintSync: { enabled: false } },
    ontology,
    datasets,
    blueprint
  }), /blueprintSync.enabled=true/);
});

test("seed maps design-graph epistemic statuses into the L1 contract", () => {
  assert.equal(normalizeL1EpistemicStatus("working_hypothesis", ontology), "inferred");
  assert.equal(normalizeL1EpistemicStatus("design_proposal", ontology), "pending");
  assert.equal(normalizeL1EpistemicStatus("unresolved", ontology), "pending");
  assert.equal(normalizeL1EpistemicStatus("not_detected", ontology), "observed");

  const prepared = prepareL1Seed({
    graphConfig,
    ontology,
    datasets: [{
      data: {
        nodes: [{ id: "generated-memory", nodeType: "memory", epistemicStatus: "working_hypothesis" }],
        links: []
      },
      spec: {}
    }],
    blueprint
  });
  assert.equal(prepared.nodes[0].epistemicStatus, "inferred");
});

test("seed refuses to report success when Blueprint sync is not current", async () => {
  const graph = { query: async () => ({ data: [] }) };
  await assert.rejects(() => seedL1Graph({
    graph,
    graphConfig,
    ontology,
    datasets,
    blueprint,
    syncBlueprint: async () => ({
      applied: false,
      status: "blocked",
      plan: { counts: { desiredNodes: 1, desiredRelations: 0 } }
    })
  }), /n'a pas atteint l'état current/);
});
