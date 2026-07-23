import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { augmentCodeContext, formatCodeContext, normalizeCodePath } from "../src/code-context-augmentation.js";

const root = path.resolve("C:/workspace/project");
const manifest = {
  graphs: [
    { id: "design", status: "active", falkorGraph: "design_db" },
    { id: "science", status: "active", falkorGraph: "science_db" }
  ]
};

test("normalizes absolute Windows paths to repository-relative paths", () => {
  assert.equal(normalizeCodePath("C:\\workspace\\project\\src\\Agent.js", root), "src/agent.js");
});

test("finds path-matching Things and returns their local traversal", async () => {
  const queries = [];
  const selectGraph = async database => ({
    async roQuery(query, options) {
      queries.push({ database, query, options });
      if (query.includes("MATCH (anchor)")) {
        return { data: database === "design_db" ? [
          { id: "file", name: "Agent runtime", nodeType: "Thing", sourcePath: "src/Agent.js" },
          { id: "other", name: "Other", nodeType: "thing", sourcePath: "src/other.js" }
        ] : [] };
      }
      return { data: [{ id: "decision", name: "Decision", depth: 1, summary: "Keep the invariant" }] };
    }
  });

  const result = await augmentCodeContext({
    filePath: "src\\agent.js", root, manifest, selectGraph, maxDepth: 2
  });

  assert.equal(result.graphs.length, 1);
  assert.equal(result.graphs[0].anchors[0].id, "file");
  assert.equal(result.graphs[0].nodes[0].id, "decision");
  assert.match(queries.find(item => item.options)?.query, /\[\*1\.\.2\]/);
  assert.deepEqual(queries.find(item => item.options).options.params.anchorIds, ["file"]);
  assert.match(formatCodeContext(result), /Keep the invariant/);
});

test("can be disabled without connecting to FalkorDB", async () => {
  let connected = false;
  const result = await augmentCodeContext({
    filePath: "src/agent.js", enabled: false, root, manifest,
    selectGraph: async () => { connected = true; }
  });
  assert.equal(result.enabled, false);
  assert.equal(connected, false);
});

test("ignores non-code files before connecting to FalkorDB", async () => {
  let connected = false;
  const result = await augmentCodeContext({
    filePath: "README.md", root, manifest,
    selectGraph: async () => { connected = true; }
  });
  assert.equal(result.skipped, "not_code");
  assert.equal(connected, false);
});
