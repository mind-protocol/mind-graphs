import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { getGraph, getL1Graph, graphName, host, port as dbPort } from "./db.js";
import { createL1SubentityRouter } from "./l1-subentity-api.js";
import { createL1ShadowRouter } from "./l1-shadow-api.js";
import { createL1MessageRouter } from "./l1-message-api.js";
import { aggregateHealthStatuses } from "./continuous-verification.js";
import { readFalkorSubentityState } from "./l1-subentity-falkor.js";
import { readL1ShadowState } from "./l1-shadow-runtime.js";
import { composeCitizenStatuses } from "./l1-citizen-status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const ontologyPath = path.resolve(__dirname, "../data/graph-ontology.json");
const l4StatePath = path.resolve(__dirname, "../artifacts/l4/physics-state.json");
const globalWorkspacePath = path.resolve(__dirname, "../artifacts/autonomy/global-workspace.json");
const l1ShadowStatePath = path.resolve(__dirname, "../artifacts/l1/subentity-shadow-state.json");
const docsDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const app = express();

async function readJsonOrEmpty(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function settledSource(result) {
  return result.status === "fulfilled"
    ? { available: true }
    : { available: false, error: result.reason?.message || String(result.reason) };
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));
app.use("/api/l1/moments", createL1MessageRouter({ getGraph: getL1Graph }));
app.use("/api/l1/subentities/shadow", createL1ShadowRouter());
app.use("/api/l1/subentities", createL1SubentityRouter({ getGraph: customName => getL1Graph(customName) }));

app.get("/api/l1/graphs", async (_req, res) => {
  try {
    const manifestPath = path.resolve(__dirname, "../graphs.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const l1Graphs = manifest.graphs.filter(g =>
      g.id.startsWith("l1") || (g.falkorGraph && g.falkorGraph.startsWith("l1_")) || g.ontology === "l1/ontology.json"
    ).map(g => ({
      id: g.id,
      label: g.label || g.id,
      falkorGraph: g.falkorGraph,
      status: g.status,
      purpose: g.purpose
    }));
    res.json({ graphs: l1Graphs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function docTitle(markdown, slug) {
  const match = markdown.match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : slug;
}

// Liste les documents Markdown du projet (racine du dépôt, hors node_modules).
// Auto-découverte : un nouveau fichier .md apparaît sans configuration.
app.get("/api/docs", async (_req, res) => {
  try {
    const entries = await readdir(docsDir, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && entry.name.endsWith(".md")).map(entry => entry.name).sort();
    const docs = [];
    for (const name of files) {
      const slug = name.replace(/\.md$/, "");
      const markdown = await readFile(path.join(docsDir, name), "utf8");
      docs.push({ slug, file: name, title: docTitle(markdown, slug) });
    }
    res.json({ docs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sert le Markdown brut d'un document. Le slug est validé pour empêcher toute traversée de chemin.
app.get("/api/docs/:slug", async (req, res) => {
  const { slug } = req.params;
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    res.status(400).json({ error: "slug invalide" });
    return;
  }
  try {
    const markdown = await readFile(path.join(docsDir, `${slug}.md`), "utf8");
    res.type("text/markdown; charset=utf-8").send(markdown);
  } catch {
    res.status(404).json({ error: "document introuvable" });
  }
});

app.get("/api/ontology", async (_req, res) => {
  try {
    const ontology = JSON.parse(await readFile(ontologyPath, "utf8"));
    res.json(ontology);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// État énergétique L4 : le runtime écrit par `l4:watch`, lu par la page live.
// C'est un runtime, pas un corpus — absent tant que le moteur n'a pas tourné.
app.get("/api/l4/state", async (_req, res) => {
  try {
    const state = JSON.parse(await readFile(l4StatePath, "utf8"));
    res.json(state);
  } catch {
    res.status(204).end(); // pas encore d'énergie : le moteur n'a pas encore tiqué
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    const graph = await getGraph();
    await graph.roQuery("RETURN 1 AS ok");
    res.json({ ok: true, graph: graphName, host, port: dbPort });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.get("/api/l1/citizens/status", async (req, res) => {
  const preset = ["compact", "standard", "detailed"].includes(req.query.detail) ? req.query.detail : "standard";
  const [runtimeResult, physicsResult, workspaceResult, shadowResult] = await Promise.allSettled([
    getL1Graph().then(readFalkorSubentityState),
    readJsonOrEmpty(l4StatePath),
    readJsonOrEmpty(globalWorkspacePath),
    readL1ShadowState(l1ShadowStatePath)
  ]);
  const runtime = runtimeResult.status === "fulfilled" ? runtimeResult.value : { state: {}, revision: 0, projectionRevision: 0 };
  const sourceAvailability = {
    runtime: settledSource(runtimeResult),
    physics: settledSource(physicsResult),
    workspace: settledSource(workspaceResult),
    shadow: settledSource(shadowResult)
  };
  const payload = composeCitizenStatuses({
    runtimeState: runtime.state,
    physicsState: physicsResult.status === "fulfilled" ? physicsResult.value : {},
    globalWorkspaceState: workspaceResult.status === "fulfilled" ? workspaceResult.value : {},
    shadowState: shadowResult.status === "fulfilled" ? shadowResult.value : {},
    projection: {
      revision: runtime.projectionRevision,
      status: runtime.revision === runtime.projectionRevision ? "current" : "repair_required",
      error: runtime.projectionError || null
    },
    sourceAvailability,
    primaryCitizenId: process.env.L1_PRIMARY_CITIZEN_ID,
    fallbackCitizenId: process.env.L1_PRIMARY_CITIZEN_ID || "citizen-local",
    textConfig: preset
  });
  res.status(200).json(payload);
});

app.get("/api/runtime-health", async (_req, res) => {
  try {
    const graph = await getGraph();
    const result = await graph.roQuery(`MATCH (s:HealthStatus)
      RETURN s.id AS id, s.targetId AS targetId, s.probeId AS probeId,
             s.dimension AS dimension, s.state AS state, s.value AS value,
             s.targetProofKind AS targetProofKind, s.expectedDimension AS expectedDimension,
             s.checkedAt AS checkedAt, s.freshUntil AS freshUntil,
             s.durationMs AS durationMs, s.message AS message`);
    res.json({ generatedAt: new Date().toISOString(), statuses: aggregateHealthStatuses(result.data), checks: result.data });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.get("/api/graph", async (_req, res) => {
  try {
    const graph = await getGraph();
    const nodesResult = await graph.roQuery(`
      MATCH (n:MindNode)
      RETURN n.id AS id, n.name AS name, n.phrase AS phrase,
             n.phraseStatus AS phraseStatus, n.family AS family,
             n.region AS region, n.period AS period, n.startYear AS startYear,
             n.dateLabel AS dateLabel, n.nodeType AS nodeType, n.semanticType AS semanticType, n.status AS status,
             n.summary AS summary, n.sourceUrl AS sourceUrl,
             n.sourceTitle AS sourceTitle, n.forecastWindow AS forecastWindow,
             n.forecastConfidence AS forecastConfidence,
             n.forecastSignals AS forecastSignals,
             n.forecastAssumptions AS forecastAssumptions,
             n.forecastImpact AS forecastImpact, n.forecastResponse AS forecastResponse,
             n.hypothesisBasis AS hypothesisBasis, n.verificationNeeded AS verificationNeeded,
             n.questionCategory AS questionCategory, n.decisionNeeded AS decisionNeeded,
             n.decisionStatus AS decisionStatus, n.responsibleRole AS responsibleRole,
             n.decisionDue AS decisionDue, n.chosenOptionId AS chosenOptionId,
             n.decisionRationale AS decisionRationale, n.reviewDate AS reviewDate,
             n.closureEvidence AS closureEvidence, n.optionCriteria AS optionCriteria,
             n.optionCode AS optionCode, n.optionBenefits AS optionBenefits,
             n.optionRisks AS optionRisks, n.optionConditions AS optionConditions,
             n.stateOrientation AS stateOrientation, n.stateDimension AS stateDimension,
             n.stateIndicator AS stateIndicator, n.nodeTypeLabel AS nodeTypeLabel, n.semanticTypeLabel AS semanticTypeLabel,
             n.clusterId AS clusterId, n.sourcePage AS sourcePage,
             n.documentSection AS documentSection,
             n.ontologyFamily AS ontologyFamily, n.epistemicStatus AS epistemicStatus,
             n.epistemicLabel AS epistemicLabel, n.contextId AS contextId,
             n.context AS context, n.definition AS definition,
             n.definitionStatus AS definitionStatus,
             n.populationOrSystem AS populationOrSystem, n.jurisdiction AS jurisdiction,
             n.validFrom AS validFrom, n.validTo AS validTo, n.metricId AS metricId,
             n.methodId AS methodId, n.baselineValue AS baselineValue,
             n.scenarioValue AS scenarioValue, n.probabilityPct AS probabilityPct,
             n.confidenceScore AS confidenceScore, n.effectSizePct AS effectSizePct,
             n.valenceScore AS valenceScore, n.humanValenceDelta AS humanValenceDelta,
             n.quantificationStatus AS nodeQuantificationStatus,
             n.workStatus AS workStatus, n.priority AS priority,
             n.autonomyMode AS autonomyMode, n.acceptanceCriteria AS acceptanceCriteria,
             n.verificationCommand AS verificationCommand, n.updatedAt AS updatedAt,
             n.probeIntervalSeconds AS probeIntervalSeconds,
             n.probeFreshnessSeconds AS probeFreshnessSeconds,
             n.probeTargetIds AS probeTargetIds,
             n.healthProofKind AS healthProofKind,
             n.healthProofDimension AS healthProofDimension,
             n.healthProofAutomation AS healthProofAutomation,
             n.healthProofSemanticTypes AS healthProofSemanticTypes,
             n.healthDefaultVerificationCommand AS healthDefaultVerificationCommand,
             n.healthProofContractId AS healthProofContractId,
             n.completedAt AS completedAt, n.changeKind AS changeKind,
             n.changedPaths AS changedPaths,
             n.supportingNodes AS supportingNodes, n.schemaVersion AS schemaVersion
             , n.sourcePath AS sourcePath, n.sourceHash AS sourceHash
             , n.prohibitedPrefills AS prohibitedPrefills
             , n.importSourceKind AS importSourceKind
             , n.restrictedPredictionDomains AS restrictedPredictionDomains
      ORDER BY n.startYear, n.name
    `);
    const linksResult = await graph.roQuery(`
      MATCH (a:MindNode)-[r]->(b:MindNode)
      RETURN a.id AS source, b.id AS target, type(r) AS type,
             r.note AS note, r.justification AS justification,
             r.relationLabel AS relationLabel, r.relationQuality AS relationQuality,
             r.relationStory AS relationStory,
             r.forecastEffect AS forecastEffect, r.forecastStrength AS forecastStrength,
             r.forecastPolarity AS forecastPolarity, r.forecastDelay AS forecastDelay,
             r.forecastDimensions AS forecastDimensions, r.forecastFeedback AS forecastFeedback,
             r.causalLogic AS causalLogic, r.causalCondition AS causalCondition,
             r.causalRisk AS causalRisk, r.relationFamily AS relationFamily,
             r.contextId AS contextId, r.populationOrSystem AS populationOrSystem,
             r.validFrom AS validFrom, r.validTo AS validTo,
             r.methodId AS methodId, r.metricId AS metricId,
             r.relationScope AS relationScope, r.causalClaim AS causalClaim,
             r.canonicalPredicate AS canonicalPredicate,
             r.quantificationStatus AS quantificationStatus, r.schemaVersion AS schemaVersion,
             r.effectSizePct AS effectSizePct, r.confidenceScore AS confidenceScore,
             r.evidenceBasis AS evidenceBasis,
             r.traversalWeight AS traversalWeight, r.hierarchyWeight AS hierarchyWeight,
             r.hierarchyKind AS hierarchyKind
    `);
    res.json({
      nodes: nodesResult.data,
      links: linksResult.data,
      meta: { graph: graphName, generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Mind causal graph: http://localhost:${port}`);
});
