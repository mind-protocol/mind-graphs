import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createL1SubentityRouter } from "../src/l1-subentity-api.js";

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

test("state endpoint exposes projection drift explicitly", async () => {
  const router = createL1SubentityRouter({
    getGraph: async () => ({ id: "fake" }),
    readState: async () => ({ state: { revision: 3, subentities: [] }, revision: 3, projectionRevision: 2, projectionError: "interrupted" })
  });
  await withServer(router, async base => {
    const response = await fetch(`${base}/api/l1/subentities/state`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.meta.projectionStatus, "repair_required");
    assert.equal(body.meta.projectionError, "interrupted");
  });
});

test("tick endpoint distinguishes a committed tick from an idempotent replay", async () => {
  let calls = 0;
  const router = createL1SubentityRouter({
    getGraph: async () => ({ id: "fake" }),
    applyTick: async ({ input }) => {
      calls += 1;
      return { report: { tickId: input.tickId, status: calls === 1 ? "applied" : "already_processed" }, persisted: calls === 1, projectionStatus: "current", attempts: 1 };
    }
  });
  await withServer(router, async base => {
    const options = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tickId: "tick-api", candidates: [] }) };
    assert.equal((await fetch(`${base}/api/l1/subentities/ticks`, options)).status, 201);
    assert.equal((await fetch(`${base}/api/l1/subentities/ticks`, options)).status, 200);
  });
});

test("invalid lifecycle input is a client error", async () => {
  const router = createL1SubentityRouter({ getGraph: async () => ({}), applyTick: async () => { throw new Error("A lifecycle tick requires a stable tickId."); } });
  await withServer(router, async base => {
    const response = await fetch(`${base}/api/l1/subentities/ticks`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 400);
  });
});

test("summary endpoint returns an observation-safe projection", async () => {
  const router = createL1SubentityRouter({
    getGraph: async () => ({}),
    readState: async () => ({
      state: { revision: 2, subentities: [{ id: "part", status: "active", level: "high", weight: 3 }], narratives: [], moments: [], relations: [], events: [] },
      revision: 2, projectionRevision: 2, projectionError: null
    })
  });
  await withServer(router, async base => {
    const body = await (await fetch(`${base}/api/l1/subentities/summary`)).json();
    assert.equal(body.counts.highLevel, 1);
    assert.equal(body.projection.status, "current");
  });
});

test("integrated endpoint reports the detected coalition without returning the full state", async () => {
  const router = createL1SubentityRouter({
    getGraph: async () => ({}),
    applyIntegratedTick: async () => ({
      report: { status: "applied", tickId: "integrated-api" },
      detection: { observation: { candidateId: "candidate-a", explicitController: false } },
      persisted: true, projectionStatus: "current", attempts: 1
    })
  });
  await withServer(router, async base => {
    const response = await fetch(`${base}/api/l1/subentities/integrated-ticks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tickId: "integrated-api" }) });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.detection.candidateId, "candidate-a");
    assert.equal(body.state, undefined);
  });
});

test("until-stable endpoint exposes its bounded termination reason", async () => {
  const router = createL1SubentityRouter({
    getGraph: async () => ({}),
    applyIntegratedUntilStable: async () => ({
      report: { status: "applied", tickId: "auto-api", stopReason: "stable", microTickCount: 2 },
      detection: { observation: { candidateId: "candidate-auto", novelObservation: true } },
      stabilization: { stopReason: "stable", history: [{ microTick: 1 }, { microTick: 2 }] },
      persisted: true, projectionStatus: "current", attempts: 1
    })
  });
  await withServer(router, async base => {
    const response = await fetch(`${base}/api/l1/subentities/integrated-ticks/until-stable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tickId: "auto-api", observationId: "moment-auto" })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.report.stopReason, "stable");
    assert.equal(body.stabilization.history.length, 2);
    assert.equal(body.state, undefined);
  });
});
