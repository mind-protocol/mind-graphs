import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runAnalysis, summarizeWorkQueue } from "../src/analysis-runner.js";

test("analysis runner uses the API graph when it is available", async () => {
  const result = await runAnalysis({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        nodes: [
          { id: "cause", name: "Cause", nodeType: "working_hypothesis" },
          { id: "target", name: "Target", nodeType: "system_state" }
        ],
        links: [
          { source: "cause", target: "target", type: "CAUSES", causalClaim: true }
        ]
      })
    })
  });

  assert.equal(result.mode, "api");
  assert.equal(result.complete, true);
  assert.equal(result.graph.nodes, 2);
  assert.equal(result.graph.links, 1);
  assert.equal(result.findings, result.top.length);
  assert.ok(result.findings > 0);
});

test("analysis runner falls back to project-work when the API is unavailable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mind-analysis-"));
  const projectWorkPath = path.join(dir, "project-work.json");
  await writeFile(projectWorkPath, JSON.stringify({
    nodes: [
      { id: "ready", name: "Ready", nodeType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 10 },
      { id: "blocked", name: "Blocked", nodeType: "task", workStatus: "blocked", autonomyMode: "autonomous", priority: 20 },
      { id: "proposed", name: "Proposed", nodeType: "task", workStatus: "proposed", autonomyMode: "review_required", priority: 30 }
    ],
    links: []
  }), "utf8");

  try {
    const result = await runAnalysis({
      projectWorkUrl: pathToFileURL(projectWorkPath),
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:4173");
      }
    });

    assert.equal(result.mode, "fallback");
    assert.equal(result.complete, false);
    assert.match(result.warning, /Fallback incomplet/);
    assert.deepEqual(result.work.readyAutonomous.map(task => task.id), ["ready"]);
    assert.deepEqual(result.work.blocked.map(task => task.id), ["blocked"]);
    assert.deepEqual(result.work.proposed.map(task => task.id), ["proposed"]);
    assert.equal(result.findings, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("work queue summary preserves blocked dependency status", () => {
  const nodes = [
    { id: "prerequisite", name: "Prerequisite", nodeType: "task", workStatus: "in_progress", autonomyMode: "autonomous", priority: 10 },
    { id: "blocked", name: "Blocked", nodeType: "task", workStatus: "blocked", autonomyMode: "autonomous", priority: 20 }
  ];
  const summary = summarizeWorkQueue(nodes, [
    { source: "blocked", target: "prerequisite", type: "DEPENDS_ON" }
  ]);

  assert.deepEqual(summary.blocked[0].dependencies, [{ id: "prerequisite", workStatus: "in_progress" }]);
});
