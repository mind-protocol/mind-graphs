import test from "node:test";
import assert from "node:assert/strict";
import { createMetacognitiveState, runMetacognitiveStateTick } from "../src/l1-metacognitive-runtime.js";
import { formatMetacognitiveSummary, formatMetacognitiveTick, summarizeMetacognitiveRun } from "../src/l1-metacognitive-logging.js";

test("metacognitive logging explains scenarios, state, safety and adaptations", () => {
  const result = runMetacognitiveStateTick({
    previousState: createMetacognitiveState(),
    traversal: { tickId: "log-1", scenarios: [{ id: "safe", subentityId: "explorer", prior: 1, support: 0.8, evidence: 0.8, controllability: 0.9 }] },
    subentities: [{ id: "explorer" }]
  });
  const detail = formatMetacognitiveTick(result);
  assert.match(detail, /confiance=/u);
  assert.match(detail, /safe: p=/u);
  assert.match(detail, /panique=absente irréversible=interdit/u);
  assert.match(detail, /explorer: gate=/u);
  const summary = summarizeMetacognitiveRun([result]);
  assert.equal(summary.invariantViolations.length, 0);
  assert.match(formatMetacognitiveSummary(summary), /violations=0/u);
});
