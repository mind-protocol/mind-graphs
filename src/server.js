import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { getGraph, getGraphByName, getL1Graph, graphName, host, port as dbPort } from "./db.js";
import { createL1SubentityRouter } from "./l1-subentity-api.js";
import { createL1ShadowRouter } from "./l1-shadow-api.js";
import { createL1MessageRouter } from "./l1-message-api.js";
import { aggregateHealthStatuses } from "./continuous-verification.js";
import { readFalkorSubentityState } from "./l1-subentity-falkor.js";
import { readL1ShadowState } from "./l1-shadow-runtime.js";
import { composeCitizenStatuses } from "./l1-citizen-status.js";
import { statusToMarkdown } from "./citizen-status-text.js";
import { readLiveTickInput } from "./l1-live-signals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const ontologyPath = path.resolve(__dirname, "../data/graph-ontology.json");
const l4StatePath = path.resolve(__dirname, "../artifacts/l4/physics-state.json");
const globalWorkspacePath = path.resolve(__dirname, "../artifacts/autonomy/global-workspace.json");
const l1ShadowStatePath = path.resolve(__dirname, "../artifacts/l1/subentity-shadow-state.json");
const docsDir = path.resolve(__dirname, "..");
// `--port=` permet d'ouvrir une seconde instance (worktree, vérification) sans
// arrêter le serveur du dépôt principal, qui sert le runtime vivant.
const portArgument = process.argv.find(argument => argument.startsWith("--port="))?.slice(7);
const port = Number(portArgument || process.env.PORT || 4173);
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
// Une coalition peut activer des nœuds de la mémoire personnelle (L1) comme du
// graphe de design : on interroge donc le L1 observé d'abord, puis le design
// pour les identifiants restés introuvables. Un nœud sans vecteur est laissé
// hors du plan plutôt que placé arbitrairement (voir `npm run embeddings:check`).
const NODE_LOOKUP = `
  MATCH (n) WHERE n.id IN $ids
  RETURN n.id AS id, n.name AS name, n.clusterId AS clusterId,
         n.semanticType AS semanticType, n.embedding AS embedding,
         n.summary AS summary, n.phrase AS phrase, n.description AS description,
         n.content AS content, n.definition AS definition,
         n.epistemicStatus AS epistemicStatus
`;

// Le nom seul ne dit pas ce que la sous-entité regarde. On remonte la première
// surface de contenu disponible, dans l'ordre où elle porte le plus de sens.
const contentOf = row => row.summary || row.phrase || row.description || row.content || row.definition || null;

function collectNodes(target, rows, origin) {
  for (const row of rows || []) {
    if (!row.id || target.has(row.id)) continue;
    target.set(row.id, {
      name: row.name || null,
      content: contentOf(row),
      clusterId: row.clusterId || null,
      semanticType: row.semanticType || null,
      epistemicStatus: row.epistemicStatus || null,
      embedding: Array.isArray(row.embedding) ? row.embedding : null,
      origin
    });
  }
}

// Les bases FalkorDB sont en cours de renommage (`nlr_ai` → `l1_nlr_ai`,
// `mind_causal` → `l2_mind_causal`). Chercher dans une seule base nommée en dur
// rendait invisibles des nœuds pourtant présents. On balaie donc le L1 observé
// puis toutes les bases actives déclarées par le manifeste, en s'arrêtant dès
// que tout est résolu. Un identifiant introuvable reste introuvable : il n'est
// pas placé plutôt que placé au hasard.
let manifestGraphNames = null;

async function activeGraphNames() {
  if (manifestGraphNames) return manifestGraphNames;
  try {
    const manifest = JSON.parse(await readFile(path.resolve(__dirname, "../graphs.json"), "utf8"));
    manifestGraphNames = manifest.graphs
      .filter(graph => graph.status === "active" && graph.falkorGraph)
      .map(graph => graph.falkorGraph);
  } catch {
    manifestGraphNames = [];
  }
  return manifestGraphNames;
}

async function resolveActivatedNodes(ids, l1GraphName) {
  const resolved = new Map();
  const seen = new Set();
  const sources = [
    { origin: "l1", load: () => getL1Graph(l1GraphName) },
    { origin: "design", load: () => getGraph() },
    ...(await activeGraphNames()).map(name => ({ origin: name, load: () => getGraphByName(name) }))
  ];
  for (const source of sources) {
    if (seen.has(source.origin)) continue;
    seen.add(source.origin);
    const missing = ids.filter(id => !resolved.has(id));
    if (!missing.length) break;
    try {
      const graph = await source.load();
      const result = await graph.roQuery(NODE_LOOKUP, { params: { ids: missing } });
      collectNodes(resolved, result.data, source.origin);
    } catch {
      // Une base injoignable ou vide ne doit pas vider la carte : les nœuds
      // qu'elle portait restent simplement non résolus, donc non placés.
    }
  }
  return resolved;
}

// Nature des relations dessinées. Aucun lien ne porte de vecteur affectif dans
// le graphe : on remonte la famille et le prédicat, et on signale explicitement
// l'absence d'affect plutôt que de colorer une émotion inexistante.
async function resolveRelationNatures(edges, l1GraphName) {
  const resolved = new Map();
  const seen = new Set();
  const sources = [
    { origin: "l1", load: () => getL1Graph(l1GraphName) },
    { origin: "design", load: () => getGraph() },
    ...(await activeGraphNames()).map(name => ({ origin: name, load: () => getGraphByName(name) }))
  ];
  const wanted = edges.map(edge => `${edge.source}|${edge.type}|${edge.target}`);
  for (const source of sources) {
    if (seen.has(source.origin)) continue;
    seen.add(source.origin);
    if (resolved.size >= wanted.length) break;
    try {
      const graph = await source.load();
      const result = await graph.roQuery(`
        MATCH (a)-[r]->(b)
        WHERE (a.id + '|' + type(r) + '|' + b.id) IN $keys
        RETURN (a.id + '|' + type(r) + '|' + b.id) AS key,
               r.relationFamily AS family, r.canonicalPredicate AS predicate,
               r.epistemicStatus AS epistemicStatus,
               r.affectVector IS NOT NULL OR r.emotions IS NOT NULL AS hasAffect
      `, { params: { keys: wanted.filter(key => !resolved.has(key)) } });
      for (const row of result.data || []) {
        if (!row.key || resolved.has(row.key)) continue;
        resolved.set(row.key, {
          family: row.family || null,
          predicate: row.predicate || null,
          epistemicStatus: row.epistemicStatus || null,
          hasAffect: row.hasAffect === true
        });
      }
    } catch {
      // Une base injoignable laisse l'arête sans famille : elle sera dessinée
      // en neutre, ce qui est honnête, plutôt que colorée au hasard.
    }
  }
  return resolved;
}

app.use("/api/l1/subentities", createL1SubentityRouter({
  getGraph: customName => getL1Graph(customName),
  resolveNodes: resolveActivatedNodes,
  resolveRelations: resolveRelationNatures,
  readPhysics: () => readJsonOrEmpty(l4StatePath),
  readLiveTick: options => readLiveTickInput({
    workspacePath: globalWorkspacePath,
    physicsPath: l4StatePath,
    ...options
  })
}));

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

// Minimal mock handler for think() resolver used by the brain UI.
// Accepts JSON { actor, stimulus, task, max_ticks, mode } and returns a
// simulated analysis payload so the frontend can be exercised without full
// L1 decision-loop integration.
app.post("/api/l1/think", async (req, res) => {
  try {
    const { actor = "nlr_ai", stimulus = "", task = null, max_ticks = 6, mode = "simulate" } = req.body || {};
    // Simple deterministic mock: echo stimulus, propose a faux coalition and
    // an action when stimulus is non-empty.
    const coalitions = stimulus ? [
      { id: "coalition-1", members: ["subentity:A", "subentity:B"], score: 0.82 },
      { id: "coalition-2", members: ["subentity:C"], score: 0.41 }
    ] : [];
    const actionChosen = stimulus ? (mode === "commit" ? "apply_merge" : "propose_merge") : null;
    const alternatives = stimulus ? [{ name: "no_op", reason: "low_confidence" }, { name: "defer", reason: "need_more_ticks" }] : [];
    const moment = {
      id: `mock-moment-${Date.now()}`,
      actor,
      createdAt: new Date().toISOString(),
      summary: stimulus ? `Simulated think on ${actor}: ${String(stimulus).slice(0, 160)}` : "No stimulus"
    };
    const delta = stimulus && mode === "commit" ? { nodesChanged: 2, edgesChanged: 1 } : { nodesChanged: 0, edgesChanged: 0 };
    const learning = { note: "mock learning — no persistent effect in this test handler" };

    res.json({ actor, stimulus, task, max_ticks, mode, coalitions, actionChosen, alternatives, moment, delta, learning });
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
  if (req.query.format === "md") {
    const md = payload.citizens.map(citizen => statusToMarkdown(citizen, preset)).join("\n\n---\n\n");
    res.type("text/markdown").status(200).send(md);
    return;
  }
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
