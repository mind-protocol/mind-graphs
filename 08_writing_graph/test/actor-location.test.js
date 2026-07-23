import test from "node:test";
import assert from "node:assert/strict";
import {
  relocateActorForCodeContext, relocateActorToSubjectSpace, resolveContainingSpace
} from "../src/actor-location.js";

const manifest = { graphs: [{ id: "design", status: "active", falkorGraph: "design_db" }] };

function graphFixture() {
  const calls = [];
  return {
    calls,
    async roQuery(query) {
      calls.push({ mode: "read", query });
      if (query.includes("subject {id:$subjectId})-[relation]")) {
        return { data: [{ id: "space-code", name: "Code", via: "PART_OF", depth: 1 }] };
      }
      if (query.includes("actor.correspondsTo")) return { data: [{ id: "actor-nlr", name: "NLR" }] };
      if (query.includes("candidate.id IN")) return { data: [
        { id: "actor-nlr", name: "NLR", nodeType: "actor" },
        { id: "space-code", name: "Code", nodeType: "space" }
      ] };
      if (query.includes("oldSpace")) return { data: [] };
      return { data: [] };
    },
    async query(query, options) {
      calls.push({ mode: "write", query, options });
      return { data: [{ movedLinks: 1 }] };
    }
  };
}

test("resolves the direct Space containing a subject", async () => {
  const graph = graphFixture();
  assert.deepEqual(await resolveContainingSpace(graph, "thing-file"), {
    id: "space-code", name: "Code", via: "PART_OF", depth: 1
  });
});

test("relocates the actor and creates its first location link", async () => {
  const graph = graphFixture();
  const result = await relocateActorToSubjectSpace({
    graphId: "design",
    subjectId: "thing-file",
    manifest,
    selectGraph: async () => graph
  });
  assert.equal(result.moved, true);
  assert.equal(result.space.id, "space-code");
  assert.ok(graph.calls.some(call => call.mode === "write" && call.query.includes("LOCATED_IN")));
});

test("code context anchors drive the same automatic location update", async () => {
  const graph = graphFixture();
  const updates = await relocateActorForCodeContext({
    graphs: [{ graphId: "design", anchors: [{ id: "thing-file" }] }]
  }, { manifest, selectGraph: async () => graph });
  assert.equal(updates[0].moved, true);
  assert.equal(updates[0].subjectId, "thing-file");
});
