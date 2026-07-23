import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeL1Task,
  reportL1TaskWake,
  resolveConfiguredL1Graph,
  selectNextL1TaskWake,
  validateL1TaskReport
} from "../src/l1-task-engine.js";

test("task discovery is data-driven and selects the nearest ready deadline", () => {
  const result = selectNextL1TaskWake([
    { id: "any-new-objective", nodeType: "objective", status: "active", dueAt: "2026-07-24T10:00:00Z" },
    { id: "another-objective", nodeType: "objective", status: "active", dueAt: "2026-07-23T20:00:00Z" },
    { id: "future-wake", nodeType: "objective", status: "active", dueAt: "2026-07-23T18:00:00Z", nextWakeAt: "2026-07-23T15:00:00Z" },
    { id: "proposal", nodeType: "objective", status: "proposed", dueAt: "2026-07-23T12:00:00Z" }
  ], { now: "2026-07-23T12:00:00Z" });
  assert.equal(result.task.id, "another-objective");
  assert.equal(result.activeCount, 3);
  assert.equal(result.readyCount, 2);
  assert.equal(result.nextScheduledAt, "2026-07-23T15:00:00Z");
});

test("blocked objectives remain visible but are not selected again", () => {
  const result = selectNextL1TaskWake([
    { id: "blocked-dynamic-task", nodeType: "objective", status: "active", wakeStatus: "blocked" }
  ], { now: "2026-07-23T12:00:00Z" });
  assert.equal(result.task, null);
  assert.deepEqual(result.blockedTaskIds, ["blocked-dynamic-task"]);
});

test("JSON-backed task policy is normalized without knowing task identifiers", () => {
  const task = normalizeL1Task({
    id: "runtime-created-objective",
    wakeManagementJson: "{\"mode\":\"adaptive\",\"fixedCadence\":false}",
    deliveryPlanJson: "[{\"id\":\"step-from-data\"}]"
  });
  assert.equal(task.wakeManagement.fixedCadence, false);
  assert.equal(task.deliveryPlan[0].id, "step-from-data");
});

test("progress requires a future wake chosen before the deadline", () => {
  const task = { id: "task", dueAt: "2026-07-24T00:00:00Z" };
  assert.throws(() => validateL1TaskReport({
    outcome: "progressed", summary: "avance", nextWakeAt: "2026-07-23T11:00:00Z"
  }, task, { now: "2026-07-23T12:00:00Z" }), /after reportedAt/);
  assert.throws(() => validateL1TaskReport({
    outcome: "progressed", summary: "avance", nextWakeAt: "2026-07-24T01:00:00Z"
  }, task, { now: "2026-07-23T12:00:00Z" }), /after the task deadline/);
});

test("a blocker cannot be reported without actionable notification context", () => {
  assert.throws(() => validateL1TaskReport({
    outcome: "blocked", summary: "bloqué", blockerCause: "permission manquante"
  }, { id: "task" }), /needsFromCitizen/);
});

test("blocked reports append an observation and return an MCP Telegram payload", async () => {
  const writes = [];
  const graph = {
    roQuery: async () => ({ data: [{ task: {
      id: "objective-created-at-runtime",
      name: "Objectif découvert",
      nodeType: "objective",
      status: "active",
      dueAt: "2026-07-24T00:00:00Z"
    } }] }),
    query: async (query, options) => { writes.push({ query, options }); return { data: [{ objectiveId: "objective-created-at-runtime" }] }; }
  };
  const result = await reportL1TaskWake({
    objectiveId: "objective-created-at-runtime",
    outcome: "blocked",
    summary: "Une autorisation externe manque.",
    blockerCause: "Le dépôt distant n'est pas autorisé.",
    attemptedActions: ["Vérification des remotes Git"],
    remainingOptions: ["Autoriser le dépôt", "Choisir un autre hébergement"],
    needsFromCitizen: "Choisir ou autoriser le dépôt public.",
    now: "2026-07-23T12:00:00Z",
    manifest: { graphs: [{ id: "personal-graph", status: "active", falkorGraph: "personal_db", blueprintSync: { enabled: true } }] },
    selectGraphByName: async () => graph
  });
  assert.equal(result.notification.platform, "telegram");
  assert.match(result.notification.message, /Attendu de Nicolas/u);
  assert.equal(writes.length, 1);
  assert.match(writes[0].query, /wakeCount = coalesce/u);
  assert.equal(writes[0].options.params.wakeStatus, "blocked");
});

test("L1 graph resolution follows manifest configuration instead of a fixed database", async () => {
  const selected = [];
  const result = await resolveConfiguredL1Graph({
    manifest: { graphs: [{ id: "citizen-alice", status: "active", falkorGraph: "alice_graph", blueprintSync: { enabled: true } }] },
    selectGraphByName: async name => { selected.push(name); return { name }; }
  });
  assert.equal(result.config.id, "citizen-alice");
  assert.deepEqual(selected, ["alice_graph"]);
});
