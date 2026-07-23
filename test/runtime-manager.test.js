import test from "node:test";
import assert from "node:assert/strict";
import { buildTransitionEvents, classifyService, commandMatches, repairDecision, runtimeCycle } from "../src/runtime-manager.js";

test("process command matching requires every declared fragment", () => {
  assert.equal(commandMatches("node scripts/autonomous-agent.js --no-personal", ["scripts/autonomous-agent.js"]), true);
  assert.equal(commandMatches("node scripts/autonomous-agent.js", ["scripts/autonomous-agent.js", "--watch"]), false);
});

test("classification distinguishes unknown from down", () => {
  const service = { id: "web", required: true, observation: { process: { commandIncludes: ["src/server.js"] } } };
  const unknown = classifyService(service, {
    checks: { process: { ok: false, unknown: true, error: "access denied" } }
  });
  assert.equal(unknown.state, "unknown");

  const down = classifyService(service, {
    checks: { process: { ok: false, count: 0 } }
  });
  assert.equal(down.state, "down");
});

test("stale artifact is not confused with a dead process", () => {
  const service = { id: "autonomy", required: true, observation: { artifact: { path: "wake-log", maxAgeSeconds: 60 } } };
  const result = classifyService(service, {
    checks: { artifact: { ok: false, exists: true, ageSeconds: 120 } }
  });
  assert.equal(result.state, "stale");
  assert.match(result.reason, /stale/);
});

test("repair decision opens the circuit after repeated attempts", () => {
  const now = new Date("2026-07-23T12:10:00Z");
  const service = {
    id: "web",
    repair: {
      allowedActions: ["restart"],
      command: ["npm", "start"],
      maxAttempts: 3,
      windowSeconds: 900,
      circuitBreaker: { openAfterFailures: 3, retryAfterSeconds: 600 }
    }
  };
  const previous = {
    repairAttempts: [
      { at: "2026-07-23T12:01:00Z" },
      { at: "2026-07-23T12:04:00Z" },
      { at: "2026-07-23T12:09:00Z" }
    ]
  };
  const decision = repairDecision(service, { state: "down" }, previous, now);
  assert.equal(decision.action, "circuit_open");
});

test("events are emitted only for transitions, not stable cycles", () => {
  const previous = { services: [{ id: "web", state: "healthy" }] };
  const stable = { services: [{ id: "web", state: "healthy", reason: "ok" }] };
  const changed = { services: [{ id: "web", state: "stale", reason: "old artifact" }] };
  assert.equal(buildTransitionEvents(previous, stable).length, 0);
  assert.equal(buildTransitionEvents(previous, changed).length, 1);
});

test("runtime cycle observes, classifies, repairs and records a transition", async () => {
  const config = {
    schemaVersion: "1.0.0",
    manager: { id: "test-manager", statusPath: "status.json", eventsPath: "events.jsonl" },
    services: [{
      id: "web",
      name: "Web",
      criticality: "critical",
      required: true,
      observation: { process: { commandIncludes: ["src/server.js"] } },
      repair: { allowedActions: ["restart"], command: ["npm", "start"], maxAttempts: 1, windowSeconds: 900 }
    }]
  };
  const spawned = [];
  const result = await runtimeCycle(config, {
    cwd: ".",
    now: new Date("2026-07-23T12:00:00Z"),
    previousStatus: { services: [] },
    processes: [],
    spawnDetached: command => {
      spawned.push(command);
      return 42;
    },
    repair: true
  });
  assert.equal(result.status.services[0].state, "down");
  assert.deepEqual(spawned[0], ["npm", "start"]);
  assert.equal(result.events.find(event => event.type === "runtime_state_transition").state, "down");
  assert.equal(result.status.overall, "degraded");
});
