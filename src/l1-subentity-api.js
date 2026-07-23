import express from "express";
import {
  RuntimeRevisionConflictError,
  applyFalkorSubentityLifecycleTick,
  readFalkorSubentityState,
  repairFalkorSubentityProjection
} from "./l1-subentity-falkor.js";
import { applyFalkorIntegratedL1Tick, applyFalkorIntegratedL1UntilStable, summarizeSubentityRuntime } from "./l1-integrated-runtime.js";

export function createL1SubentityRouter({ getGraph, readState = readFalkorSubentityState, applyTick = applyFalkorSubentityLifecycleTick, applyIntegratedTick = applyFalkorIntegratedL1Tick, applyIntegratedUntilStable = applyFalkorIntegratedL1UntilStable, repairProjection = repairFalkorSubentityProjection }) {
  if (typeof getGraph !== "function") throw new Error("createL1SubentityRouter requires getGraph.");
  const router = express.Router();

  router.get("/state", async (req, res) => {
    try {
      const current = await readState(await getGraph(req.query.graph));
      res.json({ state: current.state, meta: { revision: current.revision, projectionRevision: current.projectionRevision, projectionStatus: current.revision === current.projectionRevision ? "current" : "repair_required", projectionError: current.projectionError } });
    } catch (error) {
      res.status(503).json({ error: error.message });
    }
  });

  router.get("/summary", async (req, res) => {
    try {
      const current = await readState(await getGraph(req.query.graph));
      res.json({
        ...summarizeSubentityRuntime(current.state),
        projection: {
          revision: current.projectionRevision,
          status: current.revision === current.projectionRevision ? "current" : "repair_required",
          error: current.projectionError
        }
      });
    } catch (error) {
      res.status(503).json({ error: error.message });
    }
  });

  router.post("/ticks", async (req, res) => {
    try {
      const result = await applyTick({ graph: await getGraph(req.query.graph), input: req.body });
      const status = result.report.status === "already_processed" ? 200 : result.projectionStatus === "repair_required" ? 202 : 201;
      res.status(status).json({ report: result.report, persisted: result.persisted, projectionStatus: result.projectionStatus, attempts: result.attempts });
    } catch (error) {
      if (error instanceof RuntimeRevisionConflictError) res.status(409).json({ error: error.message });
      else if (/requires|already exists|requires an id/i.test(error.message)) res.status(400).json({ error: error.message });
      else res.status(503).json({ error: error.message });
    }
  });

  router.post("/integrated-ticks", async (req, res) => {
    try {
      const result = await applyIntegratedTick({ graph: await getGraph(req.query.graph), input: req.body });
      const status = result.report.status === "already_processed" ? 200 : result.projectionStatus === "repair_required" ? 202 : 201;
      res.status(status).json({
        report: result.report,
        detection: result.detection?.observation || null,
        persisted: result.persisted,
        projectionStatus: result.projectionStatus,
        attempts: result.attempts
      });
    } catch (error) {
      if (error instanceof RuntimeRevisionConflictError) res.status(409).json({ error: error.message });
      else if (/requires|already exists|requires an id/i.test(error.message)) res.status(400).json({ error: error.message });
      else res.status(503).json({ error: error.message });
    }
  });

  router.post("/integrated-ticks/until-stable", async (req, res) => {
    try {
      const result = await applyIntegratedUntilStable({ graph: await getGraph(req.query.graph), input: req.body });
      const status = result.report.status === "already_processed" ? 200 : result.projectionStatus === "repair_required" ? 202 : 201;
      res.status(status).json({
        report: result.report,
        detection: result.detection?.observation || null,
        stabilization: result.stabilization,
        persisted: result.persisted,
        projectionStatus: result.projectionStatus,
        attempts: result.attempts
      });
    } catch (error) {
      if (error instanceof RuntimeRevisionConflictError) res.status(409).json({ error: error.message });
      else if (/requires|already exists|positive integer/i.test(error.message)) res.status(400).json({ error: error.message });
      else res.status(503).json({ error: error.message });
    }
  });

  router.post("/projection/repair", async (req, res) => {
    try {
      res.json(await repairProjection(await getGraph(req.query.graph)));
    } catch (error) {
      res.status(503).json({ error: error.message });
    }
  });
  return router;
}
