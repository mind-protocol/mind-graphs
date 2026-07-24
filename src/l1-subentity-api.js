import express from "express";
import {
  RuntimeRevisionConflictError,
  applyFalkorSubentityLifecycleTick,
  readFalkorSubentityState,
  repairFalkorSubentityProjection,
  persistFalkorSubentityState
} from "./l1-subentity-falkor.js";
import { applyFalkorIntegratedL1Tick, applyFalkorIntegratedL1UntilStable, summarizeSubentityRuntime } from "./l1-integrated-runtime.js";
import { compileBrainFrame, latestWorkspaceSnapshot } from "./l1-brain-frame.js";
import { enrichBrainFrame } from "./l1-brain-map.js";
import { setSubentityManualControl } from "./l1-subentity-runtime.js";
import { compileSubentityCockpit } from "./l1-subentity-semantics.js";

export function createL1SubentityRouter({ getGraph, readLiveTick = null, resolveNodes = null, resolveRelations = null, readPhysics = null, readState = readFalkorSubentityState, applyTick = applyFalkorSubentityLifecycleTick, applyIntegratedTick = applyFalkorIntegratedL1Tick, applyIntegratedUntilStable = applyFalkorIntegratedL1UntilStable, repairProjection = repairFalkorSubentityProjection, setManualControl = setSubentityManualControl, persistState = persistFalkorSubentityState, getCockpit = compileSubentityCockpit }) {
  if (typeof getGraph !== "function") throw new Error("createL1SubentityRouter requires getGraph.");
  const router = express.Router();

  // Les signaux vivants sont optionnels : sans eux la vue reste lisible, elle
  // déclare simplement que la source du battement est absente.
  async function readLiveOrNull(options) {
    if (typeof readLiveTick !== "function") return { error: "Aucune source de signaux vivants n'est configurée." };
    try {
      return await readLiveTick(options);
    } catch (error) {
      return { error: error.message };
    }
  }

  // Vue lisible du cerveau : qui mène, pourquoi, avec quel affect mesuré, et où.
  router.get("/brain", async (req, res) => {
    try {
      const current = await readState(await getGraph(req.query.graph));
      const live = await readLiveOrNull({ citizenId: req.query.citizen });
      const promotedIds = new Set((current.state.events || [])
        .filter(event => event.type === "SUBENTITY_PROMOTED")
        .slice(-8)
        .map(event => event.subentityId));
      const frame = compileBrainFrame(current.state, {
        citizen: live.workspace || null,
        source: live.error
          ? { measurementStatus: "unavailable", reason: live.error }
          : { measurementStatus: "observed", ...live.input.provenance, nextTickId: live.input.tickId }
      });
      res.json({
        frame: await enrichBrainFrame(frame, {
          resolveNodes: ids => resolveNodes(ids, req.query.graph),
          resolveRelations: resolveRelations ? edges => resolveRelations(edges, req.query.graph) : null,
          physics: typeof readPhysics === "function" ? await readPhysics() : null,
          clusterProfiles: live.clusterProfiles || [],
          promotedIds
        }),
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

  // Une pulsation : les signaux vivants traversent le cycle de vie des sous-entités.
  // Sur un état cérébral inchangé, le tickId est identique et le runtime répond
  // `already_processed` — « rien de nouveau n'a été observé », pas un échec.
  router.post("/pulse", async (req, res) => {
    try {
      const graph = await getGraph(req.query.graph);
      const current = await readState(graph);
      const live = await readLiveOrNull({
        citizenId: req.query.citizen || req.body?.citizenId,
        previousSnapshot: latestWorkspaceSnapshot(current.state)
      });
      if (live.error) return res.status(503).json({ error: live.error });
      const result = await applyIntegratedUntilStable({ graph, input: live.input });
      res.status(result.report.status === "already_processed" ? 200 : 201).json({
        report: result.report,
        detection: result.detection?.observation || null,
        stabilization: result.stabilization || null,
        provenance: live.input.provenance,
        persisted: result.persisted,
        projectionStatus: result.projectionStatus
      });
    } catch (error) {
      if (error instanceof RuntimeRevisionConflictError) res.status(409).json({ error: error.message });
      else res.status(503).json({ error: error.message });
    }
  });

  router.get("/manual-control", async (req, res) => {
    try {
      const current = await readState(await getGraph(req.query.graph));
      res.json({ manualControl: current.state?.manualControl || null });
    } catch (error) {
      res.status(503).json({ error: error.message });
    }
  });

  router.post("/manual-control", async (req, res) => {
    try {
      const graph = await getGraph(req.query.graph);
      const current = await readState(graph);
      const { action, subentityId, nodeId, headNodeId, targetNodeId, sourceNodeId, relationType, semanticType, label, energyPercentage, energyAmount, reasoning } = req.body || {};
      const allowedActions = [
        "set", "clear", "set_attention_head", "admit_node", "remove_node", "create_node", "create_relation", "inject_node_energy", "direct_energy",
        "lead_workspace", "support_workspace", "boost_confidence", "admit_perimeter_node", "create_semantic_link", "move_towards_barycenter"
      ];
      if (!action || !allowedActions.includes(action)) {
        return res.status(400).json({ error: `Invalid action '${action}'. Allowed: ${allowedActions.join(", ")}` });
      }
      const result = setManualControl(current.state, {
        action, subentityId, nodeId, headNodeId, targetNodeId, sourceNodeId, relationType, semanticType, label, energyPercentage, energyAmount, reasoning
      });
      if (result.report.changed && typeof persistState === "function") {
        await persistState(graph, result.state, current.revision);
      }
      res.status(200).json({
        report: result.report,
        manualControl: result.state.manualControl || null,
        revision: result.state.revision
      });
    } catch (error) {
      if (error instanceof RuntimeRevisionConflictError) res.status(409).json({ error: error.message });
      else if (/requires|does not exist|merged|invalid/i.test(error.message)) res.status(400).json({ error: error.message });
      else res.status(503).json({ error: error.message });
    }
  });

  router.get("/cockpit", async (req, res) => {
    try {
      const subentityId = req.query.id || req.query.subentityId;
      if (!subentityId) return res.status(400).json({ error: "Query parameter 'id' or 'subentityId' is required." });
      const current = await readState(await getGraph(req.query.graph));
      const cockpit = getCockpit(current.state, subentityId);
      res.json(cockpit);
    } catch (error) {
      if (/not found|requires/i.test(error.message)) res.status(404).json({ error: error.message });
      else res.status(503).json({ error: error.message });
    }
  });

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
