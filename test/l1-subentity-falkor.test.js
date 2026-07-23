import test from "node:test";
import assert from "node:assert/strict";
import {
  RuntimeRevisionConflictError,
  applyFalkorSubentityLifecycleTick,
  persistFalkorSubentityState,
  projectSubentityRuntimeState,
  readFalkorSubentityState
} from "../src/l1-subentity-falkor.js";

const state = {
  schemaVersion: "0.1.0", revision: 2, updatedAt: "2026-07-23T12:00:00Z", processedTickIds: ["t1", "t2"],
  actors: [{ id: "actor-nlr", semanticType: "actor" }],
  spaces: [{ id: "stimulus-space-a", coalitionKey: "a" }],
  perceptualMoments: [{ id: "stimulus-moment-t2-a", tickId: "t2", spaceId: "stimulus-space-a" }],
  subentities: [{ id: "part-a", level: "high", status: "active", weight: 4, stability: 0.8, certainty: 0.7, beliefs: [{ key: "safe", stance: 1 }] }],
  narratives: [{ id: "narrative-a", subentityId: "part-a", description: "Observed", evidenceMomentIds: ["moment-a"] }],
  moments: [{ id: "moment-a", content: "A choice", occurredAt: "2026-07-23T11:59:00Z" }],
  relations: [
    { id: "narrative-describes-part", source: "narrative-a", type: "DESCRIBES_SUBENTITY", target: "part-a" },
    { id: "moment-perceived", source: "stimulus-moment-t2-a", type: "PERCEIVED_BY", target: "actor-nlr" }
  ],
  events: [{ id: "event-t2-promotion-part-a", type: "SUBENTITY_PROMOTED", tickId: "t2", subentityId: "part-a" }]
};

test("runtime projection maps every state family to the L1 ontology", () => {
  const projection = projectSubentityRuntimeState(state);
  assert.equal(projection.revision, 2);
  assert.deepEqual(projection.nodes.map(node => node.props.nodeType).sort(), ["actor", "actor", "lifecycle_event", "memory", "moment", "space", "subentity_narrative"]);
  assert.equal(projection.nodes.find(node => node.id === "part-a").props.beliefsJson, JSON.stringify(state.subentities[0].beliefs));
  assert.equal(projection.nodes.find(node => node.id === "part-a").props.semanticType, "subentity");
  assert.equal(projection.nodes.find(node => node.id === "stimulus-moment-t2-a").props.runtimeKind, "stimulus_moment");
  assert.equal(projection.relations[0].props.type, "DESCRIBES_SUBENTITY");
});

test("empty Falkor graph reads as the canonical empty runtime", async () => {
  const graph = { roQuery: async () => ({ data: [] }) };
  const result = await readFalkorSubentityState(graph);
  assert.equal(result.revision, 0);
  assert.deepEqual(result.state.subentities, []);
});

test("a not-yet-created Falkor key also bootstraps as empty", async () => {
  const graph = { roQuery: async () => { throw new Error("ERR Invalid graph operation on empty key"); } };
  const result = await readFalkorSubentityState(graph);
  assert.equal(result.revision, 0);
  assert.deepEqual(result.state.processedTickIds, []);
});

test("database failures other than an empty key stay visible", async () => {
  const graph = { roQuery: async () => { throw new Error("connection lost"); } };
  await assert.rejects(() => readFalkorSubentityState(graph), /connection lost/);
});

test("snapshot revision conflict aborts before projection", async () => {
  const calls = [];
  const graph = {
    query: async (query, options) => { calls.push({ query, options }); return { data: [] }; }
  };
  await assert.rejects(() => persistFalkorSubentityState(graph, state, 1), RuntimeRevisionConflictError);
  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /WHERE root\.revision = \$expectedRevision/u);
});

test("successful persistence commits snapshot before rebuilding projection", async () => {
  const calls = [];
  const graph = {
    query: async (query, options) => {
      calls.push({ query, options });
      return { data: query.includes("RETURN root.revision") ? [{ revision: 2 }] : [] };
    }
  };
  const result = await persistFalkorSubentityState(graph, state, 1);
  assert.equal(result.projectionStatus, "current");
  assert.match(calls[0].query, /root\.stateJson = \$stateJson/u);
  assert.ok(calls.slice(1).some(call => call.query.includes("MERGE (n:L1Node")));
  assert.ok(calls.some(call => call.query.includes("root.projectionRevision = $revision")));
});

test("a concurrent revision conflict is reread and retried", async () => {
  let commitAttempts = 0;
  let stored = null;
  const graph = {
    roQuery: async () => ({ data: stored ? [{ stateJson: JSON.stringify(stored), revision: stored.revision, projectionRevision: stored.revision }] : [] }),
    query: async (query, options) => {
      if (query.includes("RETURN root.revision")) {
        commitAttempts += 1;
        if (commitAttempts === 1) return { data: [] };
        stored = JSON.parse(options.params.stateJson);
        return { data: [{ revision: stored.revision }] };
      }
      return { data: [] };
    }
  };
  const result = await applyFalkorSubentityLifecycleTick({
    graph,
    input: { tickId: "retry-tick", recordedAt: "2026-07-23T14:00:00Z", candidates: [] }
  });
  assert.equal(result.attempts, 2);
  assert.equal(commitAttempts, 2);
  assert.equal(stored.revision, 1);
});
