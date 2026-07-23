import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createL1ShadowRouter } from "../src/l1-shadow-api.js";

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use("/shadow", router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const state = {
  revision: 2, authoritativeRevision: 4, processedTickIds: ["a", "b"],
  simulatedState: { subentities: [] }, observations: [],
  proposals: [{ id: "proposal-1", type: "PROMOTE_SUBENTITY", reviewStatus: "unreviewed" }]
};

test("shadow endpoint exposes metrics and never claims authoritative application", async () => {
  const router = createL1ShadowRouter({ readState: async () => state, readReviews: async () => [] });
  await withServer(router, async base => {
    const body = await (await fetch(`${base}/shadow/`)).json();
    assert.equal(body.mode, "shadow");
    assert.equal(body.metrics.totalTicks, 2);
    assert.equal(body.appliedToAuthoritativeState, undefined);
  });
});

test("review endpoint appends calibration only for a known proposal", async () => {
  const appended = [];
  const router = createL1ShadowRouter({
    readState: async () => state,
    readReviews: async () => [],
    appendReview: async (_path, review) => { appended.push(review); return review; }
  });
  await withServer(router, async base => {
    const response = await fetch(`${base}/shadow/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: "proposal-1", verdict: "accepted" }) });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.appliedToAuthoritativeState, false);
    assert.equal(appended.length, 1);
  });
});

test("unknown proposals cannot receive a review", async () => {
  const router = createL1ShadowRouter({ readState: async () => state, readReviews: async () => [] });
  await withServer(router, async base => {
    const response = await fetch(`${base}/shadow/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: "missing", verdict: "accepted" }) });
    assert.equal(response.status, 404);
  });
});
