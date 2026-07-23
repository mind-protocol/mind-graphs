import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aggregateHealthStatuses, buildHealthProofMatrix, discoverContinuousProbes, executeProbe, healthTasksForPartial, healthThingEnergyEvents, runtimeHealthInvariants, structuralStatuses, writeHealthRuntime } from "../src/continuous-verification.js";

const ontology = JSON.parse(await readFile(new URL("../data/graph-ontology.json", import.meta.url), "utf8"));
const continuousVerification = JSON.parse(await readFile(new URL("../data/continuous-verification.json", import.meta.url), "utf8"));

test("structural health stays partial and never pretends a node works", () => {
  const now = new Date("2026-07-23T12:00:00Z");
  const statuses = structuralStatuses([
    { id: "m", name: "M", nodeType: "thing", semanticType: "free_mechanism_kind", phrase: "p", summary: "s" },
    { id: "x", name: "X", nodeType: "narrative", semanticType: "claim", phrase: "p", summary: "s" }
  ], [{ source: "m", target: "x", type: "TESTS" }], { now });
  assert.equal(statuses[0].state, "partial");
  assert.equal(statuses[0].targetSemanticType, "free_mechanism_kind");
});

test("an admitted executable probe produces a fresh passing status", async () => {
  const probe = {
    id: "probe", verificationCommand: "npm run validate", probeFreshnessSeconds: 30,
    probeTargetIds: ["mechanism"]
  };
  const statuses = await executeProbe(probe, {
    declaredScripts: ["validate"], cwd: ".", now: new Date("2026-07-23T12:00:00Z"),
    executeSegment: async () => ({ ok: true, exitCode: 0, durationMs: 1, stdout: "ok", stderr: "" })
  });
  assert.equal(statuses[0].state, "passing");
  assert.equal(statuses[0].freshUntil, "2026-07-23T12:00:30.000Z");
});

test("aggregate health prefers failure, then fresh functional success, then partial", () => {
  const now = new Date("2026-07-23T12:00:10Z");
  const base = { checkedAt: "2026-07-23T12:00:00Z", freshUntil: "2026-07-23T12:01:00Z" };
  const result = aggregateHealthStatuses([
    { ...base, id: "a-s", targetId: "a", dimension: "structure", state: "partial" },
    { ...base, id: "a-f", targetId: "a", dimension: "functional", state: "passing" },
    { ...base, id: "b-s", targetId: "b", dimension: "structure", state: "failing" },
    { ...base, id: "c-s", targetId: "c", dimension: "structure", state: "partial" }
  ], now);
  assert.equal(result.find(item => item.targetId === "a").state, "passing");
  assert.equal(result.find(item => item.targetId === "b").state, "failing");
  assert.equal(result.find(item => item.targetId === "c").state, "partial");
});

test("every partial target produces one idempotent narrative task", () => {
  const now = new Date("2026-07-23T12:00:00Z");
  const tasks = healthTasksForPartial([
    { targetId: "a", state: "partial" },
    { targetId: "b", state: "passing" }
  ], [
    { id: "a", name: "A", nodeType: "thing", semanticType: "mechanism" },
    { id: "b", name: "B", nodeType: "thing", semanticType: "mechanism" }
  ], now);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "task-health-proof-a");
  assert.equal(tasks[0].nodeType, "narrative");
  assert.equal(tasks[0].semanticType, "task");
  assert.equal(tasks[0].targetId, "a");
});

test("standalone vocabulary terms are structurally valid atoms", () => {
  const now = new Date("2026-07-23T12:00:00Z");
  const [status] = structuralStatuses([
    { id: "term", name: "Term", nodeType: "narrative", semanticType: "terme", phrase: "p", summary: "s" }
  ], [], { now });
  assert.equal(status.state, "partial");
  assert.doesNotMatch(status.message, /relation/);
});

test("continuous discovery groups safe declared proofs and rejects mutation", () => {
  const node = overrides => ({ name: "N", nodeType: "thing", phrase: "p", summary: "s", ...overrides });
  const probes = discoverContinuousProbes([
    node({ id: "method-a", semanticType: "method", verificationCommand: "npm test" }),
    node({ id: "change-a", semanticType: "change", workStatus: "delivered", verificationCommand: "npm test" }),
    node({ id: "task-open", semanticType: "task", workStatus: "proposed", verificationCommand: "npm test" }),
    node({ id: "change-mutating", semanticType: "change", workStatus: "delivered", verificationCommand: "npm run seed" }),
    node({ id: "mechanism-a", semanticType: "mechanism" }),
    node({ id: "mechanism-tested", semanticType: "mechanism" }),
    node({ id: "state-a", semanticType: "system_state" }),
    node({ id: "hypothesis-a", semanticType: "working_hypothesis" }),
    node({ id: "observation-a", semanticType: "observation", observationCommand: "npm run validate" }),
    node({ id: "metric-a", semanticType: "metric" }),
    node({
      id: "proof-contract-test", semanticType: "protocol",
      healthProofSemanticTypes: ["method", "change"],
      healthProofKind: "executable", healthProofDimension: "functional",
      healthProofAutomation: "declared_command"
    }),
    node({
      id: "proof-contract-observation-test", semanticType: "protocol",
      healthProofSemanticTypes: ["observation", "metric", "system_state"],
      healthProofKind: "observable", healthProofDimension: "observational",
      healthProofAutomation: "declared_command"
    })
  ], [
    { source: "method-a", target: "mechanism-a", type: "IMPLEMENTS" },
    { source: "method-a", target: "state-a", type: "TESTS" },
    { source: "method-a", target: "mechanism-tested", type: "TESTS" },
    { source: "method-a", target: "hypothesis-a", type: "TESTS" },
    { source: "observation-a", target: "metric-a", type: "MEASURES" }
  ]);
  assert.equal(probes.length, 2);
  const functional = probes.find(item => item.probeDimension === "functional");
  const observational = probes.find(item => item.probeDimension === "observational");
  assert.deepEqual(functional.probeTargetIds.sort(), ["change-a", "mechanism-a", "mechanism-tested", "method-a", "state-a"]);
  assert.deepEqual(observational.probeTargetIds.sort(), ["metric-a", "observation-a"]);
});

test("the graph proof matrix covers every semantic type exactly once", () => {
  const matrix = buildHealthProofMatrix(continuousVerification.nodes);
  assert.deepEqual(matrix.conflicts, []);
  assert.deepEqual([...matrix.bySemanticType.keys()].sort(), ontology.semanticTypes.map(item => item.id).sort());
  assert.deepEqual(new Set(matrix.contracts.map(item => item.healthProofKind)), new Set(["documentary", "executable", "observable", "lifecycle"]));
});

test("graph contracts drive documentary probes and preserve their dimension", async () => {
  const nodes = [
    ...continuousVerification.nodes,
    { id: "claim-a", name: "Claim", nodeType: "narrative", semanticType: "claim", phrase: "p", summary: "s" }
  ];
  const probe = discoverContinuousProbes(nodes).find(item => item.id === "proof-contract-documentary");
  assert.ok(probe.probeTargetIds.includes("claim-a"));
  const [status] = await executeProbe({ ...probe, probeTargetIds: ["claim-a"] }, {
    declaredScripts: ["validate"], cwd: ".", now: new Date("2026-07-23T12:00:00Z"),
    executeSegment: async () => ({ ok: true, exitCode: 0, durationMs: 1, stdout: "ok", stderr: "" })
  });
  assert.equal(status.dimension, "documentary");
  assert.equal(status.state, "passing");
});

test("runtime invariants reject stale targets and green statuses without evidence", () => {
  const now = new Date("2026-07-23T12:00:10Z");
  const fresh = { checkedAt: "2026-07-23T12:00:00Z", freshUntil: "2026-07-23T12:01:00Z" };
  const stale = { checkedAt: "2026-07-23T11:00:00Z", freshUntil: "2026-07-23T11:01:00Z" };
  const valid = runtimeHealthInvariants([
    { ...fresh, targetId: "a", dimension: "structure", state: "partial" },
    { ...fresh, targetId: "a", dimension: "documentary", state: "passing" }
  ], now);
  assert.equal(valid.ok, true);
  assert.equal(valid.freshnessRate, 1);

  const invalid = runtimeHealthInvariants([
    { ...stale, targetId: "a", dimension: "documentary", state: "passing" },
    { ...fresh, targetId: "b", dimension: "structure", state: "partial" }
  ], now);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.freshnessRate, 0.5);
});

test("runtime health synchronization prunes obsolete targets and probes before upserting", async () => {
  const calls = [];
  const graph = {
    async query(query, options = {}) {
      calls.push({ query, options });
      return { data: [] };
    }
  };
  await writeHealthRuntime(graph, [{
    id: "target-a::probe-a",
    targetId: "target-a",
    probeId: "probe-a",
    dimension: "functional",
    state: "passing"
  }], {
    runId: "run-a",
    checkedAt: "2026-07-23T12:00:00.000Z",
    activeTargetIds: ["target-a"],
    activeProbeIds: ["builtin-structural-contract", "probe-a"]
  });
  const prune = calls.find(call => call.query.includes("NOT s.targetId IN"));
  assert.ok(prune);
  assert.deepEqual(prune.options.params.targetIds, ["target-a"]);
  assert.deepEqual(prune.options.params.probeIds, ["builtin-structural-contract", "probe-a"]);
  assert.ok(calls.findIndex(call => call === prune) < calls.findIndex(call => call.query.includes("MERGE (s:HealthStatus")));
});

test("a partial Thing emits bounded attributed energy only on transition or cooldown", () => {
  const first = healthThingEnergyEvents([
    { targetId: "thing-a", state: "partial" },
    { targetId: "thing-b", state: "passing" }
  ], {}, new Date("2026-07-23T12:00:00Z"));
  assert.equal(first.events.length, 1);
  assert.deepEqual(first.events[0], {
    type: "THING_ENERGY_INJECTION",
    nodeIds: ["thing-a"],
    amount: 1,
    maxReservoir: 3,
    flowId: "thing-event|health_gap|thing-a",
    citizenId: null,
    originThingId: "thing-a",
    flowKind: "health_gap",
    trigger: "health_transition_to_partial",
    budgetSource: "continuous_verification",
    injectedAt: "2026-07-23T12:00:00.000Z"
  });

  const beforeCooldown = healthThingEnergyEvents([
    { targetId: "thing-a", state: "partial" }
  ], first.ledger, new Date("2026-07-23T12:04:59Z"));
  assert.equal(beforeCooldown.events.length, 0);

  const afterCooldown = healthThingEnergyEvents([
    { targetId: "thing-a", state: "partial" }
  ], beforeCooldown.ledger, new Date("2026-07-23T12:05:00Z"));
  assert.equal(afterCooldown.events.length, 1);
});
