import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createL1MessageRouter } from "../src/l1-message-api.js";

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/l1/moments", router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const committed = input => ({ report: { status: "applied", tickId: input.tickId }, persisted: true, projectionStatus: "current", attempts: 1 });

test("live endpoint creates one automatic message Moment", async () => {
  let captured;
  const router = createL1MessageRouter({
    getGraph: async () => ({}),
    now: () => "2026-07-23T18:00:00Z",
    applyTick: async ({ input }) => { captured = input; return committed(input); }
  });
  await withServer(router, async base => {
    const response = await fetch(`${base}/api/l1/moments/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: "c1", messageId: "m1", position: 0, content: "Message" }) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).position, 0);
    assert.equal(captured.memory.metadata.speakerRole, "user");
  });
});

test("conversation import endpoint accepts exactly one historical block per call", async () => {
  let captured;
  const router = createL1MessageRouter({ getGraph: async () => ({}), applyTick: async ({ input }) => { captured = input; return committed(input); } });
  await withServer(router, async base => {
    const response = await fetch(`${base}/api/l1/moments/conversations/archive-1/blocks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blockId: "b1", blockIndex: 0, speakerRole: "user", occurredAt: "2025-01-01T12:00:00Z", content: "Bloc" }) });
    assert.equal(response.status, 201);
    assert.equal(captured.memory.metadata.sourceKind, "conversation_import_block");
  });
});

test("historical blocks without dates are rejected", async () => {
  const router = createL1MessageRouter({ getGraph: async () => ({}), applyTick: async ({ input }) => committed(input) });
  await withServer(router, async base => {
    const response = await fetch(`${base}/api/l1/moments/conversations/archive-1/blocks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blockId: "b1", blockIndex: 0, speakerRole: "user", content: "Bloc" }) });
    assert.equal(response.status, 400);
  });
});
