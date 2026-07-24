import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  EMPTY_SUBENTITY_RUNTIME_STATE,
  setSubentityManualControl
} from "../src/l1-subentity-runtime.js";
import { deriveSubentityCandidates } from "../src/l1-coalition-detector.js";
import { createL1SubentityRouter } from "../src/l1-subentity-api.js";
import { compileSubentityCockpit } from "../src/l1-subentity-semantics.js";

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/l1/subentities", router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("setSubentityManualControl updates runtime state and emits events", () => {
  const initial = {
    ...EMPTY_SUBENTITY_RUNTIME_STATE,
    subentities: [
      { id: "subentity-alpha", name: "Alpha", status: "active", level: "high" },
      { id: "subentity-beta", name: "Beta", status: "active", level: "low" }
    ]
  };

  // 1. Set manual control on valid subentity
  const setRes = setSubentityManualControl(initial, { action: "set", subentityId: "subentity-alpha", reasoning: "Test override" });
  assert.equal(setRes.report.action, "set");
  assert.equal(setRes.state.manualControl.subentityId, "subentity-alpha");
  assert.equal(setRes.state.manualControl.active, true);
  assert.equal(setRes.state.events.some(e => e.type === "SUBENTITY_MANUAL_CONTROL_SET"), true);

  // 2. Clear manual control
  const clearRes = setSubentityManualControl(setRes.state, { action: "clear" });
  assert.equal(clearRes.report.action, "clear");
  assert.equal(clearRes.state.manualControl, null);
  assert.equal(clearRes.state.events.some(e => e.type === "SUBENTITY_MANUAL_CONTROL_CLEARED"), true);

  // 3. Error on merged subentity
  const mergedState = {
    ...initial,
    subentities: [{ id: "sub-merged", status: "merged" }]
  };
  assert.throws(() => {
    setSubentityManualControl(mergedState, { action: "set", subentityId: "sub-merged" });
  }, /merged/);
});

test("deriveSubentityCandidates respects active manual control override", () => {
  const state = {
    ...EMPTY_SUBENTITY_RUNTIME_STATE,
    subentities: [
      { id: "subentity-alpha", status: "active", level: "high" }
    ],
    manualControl: {
      subentityId: "subentity-alpha",
      active: true
    }
  };

  const result = deriveSubentityCandidates({
    state,
    sensory: { citizenId: "citizen-1", transfers: [{ targetNodeId: "node-1", energy: 10 }] },
    workspace: { id: "ws-1" },
    tickId: "tick-manual-1",
    recordedAt: new Date().toISOString()
  });

  assert.equal(result.observation.explicitController, true);
  assert.equal(result.observation.controlMode, "manual");
  assert.equal(result.observation.manualOverride, true);
  assert.equal(result.observation.candidateId, "subentity-alpha");
});

test("compileSubentityCockpit compiles identity, prompt, perimeter and recommendation", () => {
  const state = {
    ...EMPTY_SUBENTITY_RUNTIME_STATE,
    subentities: [
      {
        id: "sub-cockpit",
        name: "Cockpit Agent",
        level: "low",
        weight: 3.5,
        stability: 0.8,
        certainty: 0.9,
        goals: [{ key: "goal-1", score: 1 }],
        signature: { "node:n1": 0.5 }
      }
    ]
  };

  const cockpit = compileSubentityCockpit(state, "sub-cockpit");
  assert.equal(cockpit.subentity.name, "Cockpit Agent");
  assert.equal(cockpit.recommendation.action, "promote_subentity");
  assert.ok(cockpit.subentity.missionPrompt.includes("Cockpit Agent"));
  assert.ok(cockpit.availableActions.length >= 4);
});

test("manual control REST API endpoints work as expected", async () => {
  let currentState = {
    revision: 1,
    projectionRevision: 1,
    projectionError: null,
    state: {
      ...EMPTY_SUBENTITY_RUNTIME_STATE,
      subentities: [{ id: "sub-1", name: "Sub 1", status: "active", level: "high" }]
    }
  };

  const router = createL1SubentityRouter({
    getGraph: async () => ({ id: "graph-1" }),
    readState: async () => currentState,
    setManualControl: (state, args) => {
      const res = setSubentityManualControl(state, args);
      currentState = { ...currentState, state: res.state, revision: res.state.revision, projectionRevision: res.state.revision };
      return res;
    },
    persistState: async () => {}
  });

  await withServer(router, async base => {
    // GET initial
    const res1 = await fetch(`${base}/api/l1/subentities/manual-control`);
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.manualControl, null);

    // POST set
    const res2 = await fetch(`${base}/api/l1/subentities/manual-control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set", subentityId: "sub-1", reasoning: "API test" })
    });
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.manualControl.subentityId, "sub-1");

    // GET cockpit
    const resCockpit = await fetch(`${base}/api/l1/subentities/cockpit?id=sub-1`);
    assert.equal(resCockpit.status, 200);
    const bodyCockpit = await resCockpit.json();
    assert.equal(bodyCockpit.subentity.id, "sub-1");
    assert.ok(bodyCockpit.availableActions.length > 0);

    // POST clear
    const res4 = await fetch(`${base}/api/l1/subentities/manual-control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clear" })
    });
    assert.equal(res4.status, 200);
    const body4 = await res4.json();
    assert.equal(body4.manualControl, null);
  });
});
