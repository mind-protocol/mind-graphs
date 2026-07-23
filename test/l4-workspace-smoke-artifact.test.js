import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const artifact = JSON.parse(await readFile(new URL("../artifacts/l4/workspace-routing-smoke.json", import.meta.url), "utf8"));

test("the citizen workspace smoke artifact preserves its declared runtime invariants", () => {
  assert.equal(artifact.graphId, "design");
  assert.equal(artifact.summary.tick, 2);
  assert.equal(artifact.summary.activeFlows, 1);
  assert.deepEqual(artifact.summary.byCitizen.map(item => item.citizenId), ["actor-nlr"]);
  assert.ok(artifact.summary.hottest.some(item => item.link === "state-goal-directed-autonomous-improvement|AUTHORED_BY|actor-nlr"));
  const flows = Object.values(artifact.flows || {}).flat();
  assert.ok(flows.length > 0);
  assert.ok(flows.every(flow => flow.citizenId === "actor-nlr"));
});
