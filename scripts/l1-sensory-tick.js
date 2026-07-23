import fs from "node:fs/promises";
import path from "node:path";
import {
  loadManifest, activeGraphs, readDatasets, datasetNodes, datasetLinks, projectDir
} from "../src/graph-manifest.js";
import { buildPhysicsIndex, createState, summarize } from "../src/l4-physics.js";
import { createLocalEmbedder, embedNodes } from "../src/local-embedding.js";
import { tickCitizenWithSenses } from "../src/l1-sensory-l4-bridge.js";
import { createAttentionState, innerOuterFocusOf } from "../src/l1-attention-arbitrator.js";
import {
  buildSensoryTickLog, formatSensoryTickLog, summarizeSensoryRun, formatSensoryRunSummary
} from "../src/l1-sensory-logging.js";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const argument = args.find(item => item.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : fallback;
};

const ticks = Number(valueOf("ticks", "1"));
const dimensions = Number(valueOf("dimensions", "128"));
const minWeight = Number(valueOf("min-weight", "0.8"));
const recentWindowMs = Number(valueOf("recent-hours", "24")) * 60 * 60 * 1000;
const minSimilarity = Number(valueOf("min-similarity", "0.15"));
const topK = Number(valueOf("top-k", "5"));
const sensoryBudgetArgument = valueOf("sensory-budget", undefined);
const sensoryEnergyBudget = sensoryBudgetArgument === undefined ? undefined : Number(sensoryBudgetArgument);
const orientation = valueOf("orientation", "balanced");
const focusIntensity = Number(valueOf("focus-intensity", "0"));
const innerOuterFocusArgument = valueOf("inner-outer-focus", undefined);
const initialInnerOuterFocus = innerOuterFocusArgument === undefined
  ? innerOuterFocusOf({ attentionalOrientation: orientation, focusIntensity })
  : Number(innerOuterFocusArgument);
const focusAdaptationRate = Number(valueOf("focus-adaptation-rate", "0.25"));
const homeostaticError = Number(valueOf("homeostatic-error", "0"));
const affectIntensity = Number(valueOf("affect-intensity", "0"));
const goalPressure = Number(valueOf("goal-pressure", "0"));
const cognitiveLoad = Number(valueOf("cognitive-load", "0"));
const minimumSensoryShare = Number(valueOf("min-sensory-share", "0.05"));
const maximumSensoryShare = Number(valueOf("max-sensory-share", "0.8"));
const quiet = args.includes("--quiet");
const logTargetLimit = Number(valueOf("log-targets", "8"));
const now = Number(valueOf("now", String(Date.now())));
const outputPath = path.resolve(projectDir, valueOf("output", "artifacts/l1/sensory-latest.json"));
const brainPath = path.resolve(projectDir, valueOf("brain", "l1/data/l1-brain-blueprint-v0.1.graph.json"));
if (!Number.isInteger(ticks) || ticks < 1) throw new Error("--ticks must be a positive integer");
if (!Number.isInteger(logTargetLimit) || logTargetLimit < 1) throw new Error("--log-targets must be a positive integer");

const manifest = await loadManifest();
const sourceGraphs = [];
for (const graph of activeGraphs(manifest)) {
  const datasets = await readDatasets(graph);
  const nodes = datasets.flatMap(datasetNodes);
  const links = datasets.flatMap(datasetLinks).map(link => ({
    ...link,
    physics: {
      ...(link.physics || {}),
      W: link.physics?.W ?? link.weight ?? 1
    }
  }));
  sourceGraphs.push({ id: graph.id, readAllowed: true, nodes, links });
}

const brain = JSON.parse(await fs.readFile(brainPath, "utf8"));
const embed = createLocalEmbedder({ dimensions });
const l1Nodes = await embedNodes(brain.nodes, embed);
const index = buildPhysicsIndex(l1Nodes, brain.relations, []);
const state = createState(index);
const citizen = l1Nodes.find(node => node.citizen === true && String(node.nodeType).toLowerCase() === "actor");
if (!citizen) throw new Error("Le L1 Brain Blueprint ne contient aucun Actor citoyen.");
const cache = new Map();
const tickReports = [];
const tickLogs = [];
let attentionState = createAttentionState({ innerOuterFocus: initialInnerOuterFocus });

for (let position = 0; position < ticks; position += 1) {
  const tickNow = now + position;
  const physicsBefore = summarize(state, index, { limit: 10 });
  const report = await tickCitizenWithSenses({
    state,
    index,
    citizenId: citizen.id,
    sourceGraphs,
    l1Nodes,
    embed,
    cache,
    sensoryConfig: {
      citizenIds: [citizen.id, "actor-nlr", "self-nlr"],
      minWeight,
      recentWindowMs,
      now: tickNow,
      minSimilarity,
      topK,
      sensoryEnergyBudget,
      tickId: `sensory-${position + 1}`
    },
    workspaceState: {
      activeEntity: {
        id: citizen.id,
        homeostaticError,
        affectIntensity,
        goalPressure,
        cognitiveLoad
      }
    },
    attentionState,
    attentionConfig: { minimumSensoryShare, maximumSensoryShare, focusAdaptationRate }
  });
  const physicsAfter = summarize(state, index, { limit: 10 });
  const tickLog = buildSensoryTickLog(report, index, { physicsBefore, physicsAfter, targetLimit: logTargetLimit });
  attentionState = report.attention.nextState;
  tickReports.push(report);
  tickLogs.push(tickLog);
  if (!quiet) console.log(formatSensoryTickLog(tickLog));
}

const stats = summarizeSensoryRun(tickLogs);

const payload = {
  generatedAt: new Date(now).toISOString(),
  graphId: brain.graphId,
  citizenId: citizen.id,
  embedding: { provider: "local-hashing", dimensions, cacheEntries: cache.size },
  config: {
    ticks, minWeight, recentWindowMs, minSimilarity, topK,
    sensoryEnergyBudget: sensoryEnergyBudget ?? null,
    attention: {
      initialInnerOuterFocus,
      focusAdaptationRate,
      legacyInput: { orientation, focusIntensity },
      homeostaticError, affectIntensity, goalPressure, cognitiveLoad,
      minimumSensoryShare, maximumSensoryShare
    }
  },
  sourceGraphs: sourceGraphs.map(graph => ({ id: graph.id, nodes: graph.nodes.length, links: graph.links.length })),
  ticks: tickReports.map((report, position) => ({
    tickId: report.sensory.tickId,
    selectedConnections: report.sensory.selectedConnections.map(connection => ({
      graphId: connection.graphId,
      source: connection.source,
      type: connection.link.type,
      target: connection.target,
      selectedBecause: connection.selectedBecause,
      sensoryLine: report.sensory.embeddedLines.find(line => line.graphId === connection.graphId && line.source === connection.source && line.target === connection.target)?.sensoryLine
    })),
    transfers: report.sensory.transfers,
    attention: {
      sensoryShare: report.attention.sensoryShare,
      sensoryBudget: report.attention.sensoryBudget,
      scores: report.attention.scores,
      external: report.attention.external,
      workspace: report.attention.workspace,
      focusDynamics: report.attention.focusDynamics
    },
    totalBudget: report.totalBudget,
    sensoryAllocated: report.sensoryAllocated,
    localBudget: report.localBudget,
    log: tickLogs[position]
  })),
  stats,
  physics: summarize(state, index, { limit: 25 })
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
if (!quiet) console.log(formatSensoryRunSummary(stats));
console.log(`Tick sensoriel L1: ${ticks} tick(s), ${payload.ticks.reduce((sum, tick) => sum + tick.selectedConnections.length, 0)} ligne(s), ${payload.ticks.reduce((sum, tick) => sum + tick.transfers.length, 0)} transfert(s).`);
console.log(`Replay écrit dans ${path.relative(projectDir, outputPath)}.`);
