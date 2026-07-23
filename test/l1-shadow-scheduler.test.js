import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_SUBENTITY_RUNTIME_STATE } from "../src/l1-subentity-runtime.js";
import { EMPTY_L1_SHADOW_STATE } from "../src/l1-shadow-runtime.js";
import { parseShadowEventLog, processShadowEventBatch } from "../src/l1-shadow-scheduler.js";

const event = tickId => ({
  tickId, recordedAt: "2026-07-23T17:00:00Z",
  sensory: { citizenId: "actor-nlr", totalBudget: 1, allocatedEnergy: 0.6, transfers: [{ targetNodeId: "goal", energy: 0.6, sourceCitizenId: "actor-nlr" }] },
  affect: { dominant: { affect: "curiosity", intensity: 0.6 } }, workspace: {}, memory: null
});

test("append-only log parsing keeps good events and reports bad lines", () => {
  const parsed = parseShadowEventLog(`${JSON.stringify(event("a"))}\nnot-json\n{}\n`);
  assert.equal(parsed.events.length, 1);
  assert.deepEqual(parsed.errors.map(error => error.line), [2, 3]);
});

test("bounded replay accumulates recurrence without touching the authoritative state", () => {
  const authoritative = structuredClone(EMPTY_SUBENTITY_RUNTIME_STATE);
  const before = structuredClone(authoritative);
  const batch = processShadowEventBatch({ shadowState: EMPTY_L1_SHADOW_STATE, authoritativeState: authoritative, events: [event("a"), event("b"), event("c")], maxEvents: 2 });
  assert.equal(batch.applied, 2);
  assert.equal(batch.scanned, 2);
  assert.equal(batch.state.revision, 2);
  assert.deepEqual(authoritative, before);
  assert.equal(batch.state.simulatedState.subentities[0].observationCount, 2);
});

test("re-reading the same append-only log skips processed ticks", () => {
  const first = processShadowEventBatch({ shadowState: EMPTY_L1_SHADOW_STATE, authoritativeState: EMPTY_SUBENTITY_RUNTIME_STATE, events: [event("a"), event("b")] });
  const replay = processShadowEventBatch({ shadowState: first.state, authoritativeState: EMPTY_SUBENTITY_RUNTIME_STATE, events: [event("a"), event("b")] });
  assert.equal(replay.applied, 0);
  assert.equal(replay.skipped, 2);
  assert.equal(replay.state.revision, 2);
});
