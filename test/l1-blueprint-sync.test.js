import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  applyL1BlueprintProjection,
  planL1BlueprintSync,
  projectL1Blueprint,
  syncL1Blueprint
} from "../src/l1-blueprint-sync.js";

const blueprint = JSON.parse(await fs.readFile(new URL("../l1/data/l1-brain-blueprint-v0.1.graph.json", import.meta.url), "utf8"));

test("the whole brain blueprint projects as managed structure without personal defaults", () => {
  const projection = projectL1Blueprint(blueprint);
  assert.equal(projection.nodes.length, blueprint.nodes.length);
  assert.equal(projection.relations.length, blueprint.relations.length);
  assert.ok(projection.nodes.every(node => node.props.blueprintManaged === true));
  assert.ok(projection.nodes.every(node => node.props.blueprintSource === blueprint.graphId));
  assert.ok(projection.nodes.every(node => node.props.personal !== true));
});

test("a facet can bound a migration to the universal Citizen AI role system", () => {
  const projection = projectL1Blueprint(blueprint, { scopeFacet: "citizen_ai_role_system" });
  assert.equal(projection.nodes.length, 580);
  assert.equal(projection.relations.length, 907);
  assert.ok(projection.nodes.every(node => node.props.facets.includes("citizen_ai_role_system")));
});

test("planning is idempotent and retires only previously managed structure", () => {
  const projection = projectL1Blueprint({ graphId: "bp", schemaVersion: "1", nodes: [{ id: "a", nodeType: "Thing" }], relations: [] });
  const current = {
    releaseHash: projection.releaseHash, version: "1", collisions: [], relations: [],
    nodes: [
      { id: "a", entityHash: projection.nodes[0].entityHash, retired: false },
      { id: "old", entityHash: "old", retired: false }
    ]
  };
  const withRetirement = planL1BlueprintSync(projection, current);
  assert.deepEqual(withRetirement.nodes.stale, ["old"]);
  assert.equal(withRetirement.status, "proposed");
  current.nodes[1].retired = true;
  assert.equal(planL1BlueprintSync(projection, current).status, "current");
});

test("an occupied personal ID blocks the migration before any write", async () => {
  const projection = projectL1Blueprint({ graphId: "bp", schemaVersion: "1", nodes: [{ id: "self", nodeType: "Actor" }], relations: [] });
  const plan = planL1BlueprintSync(projection, { releaseHash: null, nodes: [], relations: [], collisions: [{ id: "self", labels: ["L1Node"] }] });
  let writes = 0;
  await assert.rejects(() => applyL1BlueprintProjection({ query: async () => { writes += 1; } }, projection, plan), /occupied IDs/);
  assert.equal(writes, 0);
});

test("apply only deletes managed blueprint relations and retires stale nodes", async () => {
  const projection = projectL1Blueprint({
    graphId: "bp", schemaVersion: "1",
    nodes: [{ id: "a", nodeType: "Thing" }, { id: "b", nodeType: "Space" }],
    relations: [{ id: "r", source: "a", target: "b", type: "PART_OF" }]
  });
  const calls = [];
  const graph = { query: async (query, options) => { calls.push({ query, options }); return { data: [] }; } };
  const plan = planL1BlueprintSync(projection, { releaseHash: null, nodes: [{ id: "old", entityHash: "x" }], relations: [], collisions: [] });
  const result = await applyL1BlueprintProjection(graph, projection, plan, { now: () => "2026-07-23T00:00:00Z" });
  assert.equal(result.applied, true);
  const relationDelete = calls.find(call => call.query.includes("DELETE relation"));
  assert.match(relationDelete.query, /relation\.blueprintManaged = true/u);
  assert.ok(!calls.some(call => /DETACH DELETE node/u.test(call.query)));
  assert.ok(calls.some(call => call.query.includes("node.blueprintRetired = true")));
});

test("dry-run reads but never writes", async () => {
  let writes = 0;
  const graph = {
    roQuery: async query => ({ data: query.includes("labels(node)") ? [] : [] }),
    query: async () => { writes += 1; return { data: [] }; }
  };
  const result = await syncL1Blueprint({ graph, blueprint: { graphId: "bp", schemaVersion: "1", nodes: [], relations: [] } });
  assert.equal(result.applied, false);
  assert.equal(writes, 0);
});
