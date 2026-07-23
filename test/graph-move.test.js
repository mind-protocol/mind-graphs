import test from "node:test";
import assert from "node:assert/strict";
import { formatMoveResult, moveToSpace } from "../src/graph-move.js";

const manifest = { graphs: [{ id: "design", status: "active", falkorGraph: "design_db" }] };

function fakeGraph({ targetType = "Space", links = [] } = {}) {
  const calls = [];
  return {
    calls,
    async roQuery(query) {
      calls.push({ mode: "read", query });
      if (query.includes("candidate.id IN")) return { data: [
        { id: "node", name: "Nœud", nodeType: "Thing" },
        { id: "new-space", name: "Nouveau", nodeType: targetType }
      ] };
      return { data: links };
    },
    async query(query, options) {
      calls.push({ mode: "write", query, options });
      return { data: [{ movedLinks: links.length }] };
    }
  };
}

test("move preserves every relationship type while replacing Space targets", async () => {
  const graph = fakeGraph({ links: [
    { relationType: "PART_OF", oldSpaceId: "old-a", oldSpaceName: "Ancien A" },
    { relationType: "GROUNDS", oldSpaceId: "old-b", oldSpaceName: "Ancien B" }
  ] });
  const result = await moveToSpace({
    nodeId: "node", newSpaceId: "new-space", manifest, selectGraph: async () => graph
  });
  const write = graph.calls.find(call => call.mode === "write");
  assert.match(write.query, /old0:GROUNDS/);
  assert.match(write.query, /replacement:PART_OF/);
  assert.match(write.query, /SET replacement = properties\(old\)/);
  assert.deepEqual(write.options.params, { nodeId: "node", newSpaceId: "new-space" });
  assert.equal(result.movedLinks, 2);
  assert.match(formatMoveResult(result), /2 lien\(s\)/);
});

test("dryRun previews links without writing", async () => {
  const graph = fakeGraph({ links: [{ relationType: "REL", semanticType: "PART_OF", oldSpaceId: "old" }] });
  const result = await moveToSpace({
    nodeId: "node", newSpaceId: "new-space", dryRun: true, manifest, selectGraph: async () => graph
  });
  assert.equal(result.dryRun, true);
  assert.equal(graph.calls.some(call => call.mode === "write"), false);
});

test("move rejects a target that is not a Space before reading links", async () => {
  const graph = fakeGraph({ targetType: "Thing" });
  await assert.rejects(
    moveToSpace({ nodeId: "node", newSpaceId: "new-space", manifest, selectGraph: async () => graph }),
    /not Space/
  );
  assert.equal(graph.calls.length, 1);
});

test("move creates a LOCATED_IN link when the actor has no previous Space", async () => {
  const graph = fakeGraph();
  const result = await moveToSpace({
    nodeId: "node", newSpaceId: "new-space", createIfMissing: true, manifest,
    selectGraph: async () => graph
  });
  const write = graph.calls.find(call => call.mode === "write");
  assert.match(write.query, /MERGE \(node\)-\[location:LOCATED_IN\]->\(newSpace\)/);
  assert.equal(result.createdLocation, true);
  assert.equal(result.movedLinks, 1);
  assert.match(formatMoveResult(result), /LOCATED_IN/);
});
