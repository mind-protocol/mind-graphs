import express from "express";
import { applyFalkorSubentityLifecycleTick, RuntimeRevisionConflictError } from "./l1-subentity-falkor.js";
import { createConversationBlockTick, createConversationUtteranceTick, createLiveMessageTick } from "./l1-message-ingestion.js";

function statusFor(result) {
  if (result.report.status === "already_processed") return 200;
  return result.projectionStatus === "repair_required" ? 202 : 201;
}

function responseFor(result, input) {
  return {
    momentId: input.memory.id,
    occurredAt: input.memory.occurredAt,
    conversationId: input.memory.metadata.conversationId,
    position: input.memory.metadata.conversationPosition,
    status: result.report.status,
    persisted: result.persisted,
    projectionStatus: result.projectionStatus,
    attempts: result.attempts
  };
}

function sendError(res, error) {
  if (error instanceof RuntimeRevisionConflictError) res.status(409).json({ error: error.message });
  else if (/already exists under another tick/i.test(error.message)) res.status(409).json({ error: error.message });
  else if (/required|must be|non-negative integer/i.test(error.message)) res.status(400).json({ error: error.message });
  else res.status(503).json({ error: error.message });
}

export function createL1MessageRouter({ getGraph, applyTick = applyFalkorSubentityLifecycleTick, now } = {}) {
  if (typeof getGraph !== "function") throw new Error("createL1MessageRouter requires getGraph.");
  const router = express.Router();

  router.post(["/messages", "/"], async (req, res) => {
    try {
      const input = createLiveMessageTick(req.body, { now });
      const result = await applyTick({ graph: await getGraph(), input });
      res.status(statusFor(result)).json(responseFor(result, input));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/conversations/:conversationId/blocks", async (req, res) => {
    try {
      const input = createConversationBlockTick(req.params.conversationId, req.body, { now });
      const result = await applyTick({ graph: await getGraph(), input });
      res.status(statusFor(result)).json(responseFor(result, input));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/conversations/:conversationId/utterances", async (req, res) => {
    try {
      const input = createConversationUtteranceTick(req.params.conversationId, req.body, { now });
      const result = await applyTick({ graph: await getGraph(), input });
      res.status(statusFor(result)).json(responseFor(result, input));
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
