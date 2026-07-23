// Moteur d'énergie L4 — exécution.
//
// Deux modes. `--ticks=N` fait N passes et s'arrête : déterministe, sans horloge,
// c'est celui qui sert à mesurer et à rapporter. `--watch` boucle en temps réel,
// chaque acteur battant à sa propre période — aucun ordonnanceur global, comme
// `l4-execution-tick` l'exige.
//
// L'état vit dans `artifacts/l4/`, jamais dans `data/`. Le corpus est une
// affirmation durable ; l'énergie est un runtime qui change toutes les quelques
// secondes et que des sessions concurrentes ne doivent jamais se disputer.
import fs from "node:fs/promises";
import path from "node:path";
import {
  loadManifest, selectGraph, readDatasets, datasetNodes, datasetLinks, projectDir
} from "../src/graph-manifest.js";
import {
  buildPhysicsIndex, createState, tickActor, injectAlongPath, summarize,
  assertStable, citizenPumps, propagate, relax, L4_PHYSICS_TUNING,
  createPhysicsLogger, formatPhysicsEvent, setCitizenWorkspace, applyMomentOutcome
} from "../src/l4-physics.js";
import {
  createLocalEmbedder, embedLinks, embedNodes, embedWorkspace
} from "../src/local-embedding.js";
import {
  buildClusterEmbeddingProfiles, rankClusterEmbeddingProfiles
} from "../src/intent-embedding-profile.js";

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const found = args.find(arg => arg.startsWith(`--${flag}=`));
  return found ? found.slice(flag.length + 3) : fallback;
};

const graphId = valueOf("graph", "design");
const ticks = Number(valueOf("ticks", "0"));
const basePeriodMs = Number(valueOf("period", "5")) * 1000;
const statePath = valueOf("state", "artifacts/l4/physics-state.json");
const eventsPath = valueOf("events", "artifacts/l4/injections.jsonl");
const workspacePath = valueOf("workspace", null);
const watch = args.includes("--watch");
const verbose = args.includes("--verbose") || args.includes("--log");
const logFile = valueOf("log-file", null);
const logJson = valueOf("log-json", null);
const numericOverride = flag => {
  const raw = valueOf(flag, null);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${flag} doit être un nombre fini`);
  return value;
};
const runtimeTuning = Object.fromEntries(Object.entries({
  semanticGuidanceBeta: numericOverride("semantic-beta"),
  semanticTemperature: numericOverride("semantic-temperature"),
  explorationRate: numericOverride("exploration-rate")
}).filter(([, value]) => value !== undefined));

let fileStream = null;
if (logFile || logJson) {
  const filePath = path.resolve(projectDir, logFile || logJson);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  fileStream = await fs.open(filePath, "a");
}

const loggerOptions = {
  verbose,
  tuning: runtimeTuning,
  onEvent: async event => {
    if (fileStream) {
      if (logJson) {
        await fileStream.appendFile(JSON.stringify(event) + "\n");
      } else {
        await fileStream.appendFile(formatPhysicsEvent(event) + "\n");
      }
    }
  }
};

const stable = assertStable();
console.log(
  `Régime borné : decay×(1+gain) = ${stable.factor.toFixed(4)} < 1, `
  + `total à l'équilibre ≈ ${stable.steadyStateTotalPerUnitInjected.toFixed(2)} × injection par tic.`
);

const manifest = await loadManifest();
const graph = selectGraph(manifest, graphId);
const datasets = await readDatasets(graph);

const mapping = datasets.find(entry => entry.id === "l4-ontology-mapping");
if (!mapping) throw new Error(`Le graphe "${graphId}" ne déclare pas l4-ontology-mapping`);
const profiles = mapping.data.nodes.find(node => node.id === "l4-predicate-translation-dictionary").profiles;

const embed = createLocalEmbedder();
const rawNodes = datasets.flatMap(entry => datasetNodes(entry));
const nodes = await embedNodes(rawNodes, embed, { force: true });
const rawLinks = datasets.flatMap(entry => datasetLinks(entry));
const links = await embedLinks(rawLinks, nodes, embed, { force: true });
const index = buildPhysicsIndex(nodes, links, profiles);

// Les pompes. Seul un acteur CITOYEN injecte, à proportion de son poids. Un
// acteur documenté non citoyen (compte externe cité comme source) et un Moment
// (un passage) ne pompent pas.
const pumps = citizenPumps(nodes);
const actorCount = nodes.filter(node => node.nodeType === "actor").length;
console.log(`${nodes.length} nœuds, ${index.entries.length} liens projetés, ${pumps.length} pompes citoyennes sur ${actorCount} acteurs.`);
if (!pumps.length) {
  console.log("Aucun citoyen : le corpus n'a pas de pompe interne. Seules les requêtes injecteront — ce qui est l'état réel du graphe tant qu'aucun acteur ne porte citizen: true.");
}

const state = createState(index);

const workspaceFile = workspacePath ? path.resolve(projectDir, workspacePath) : null;
let workspaceMtimeMs = null;
async function reloadWorkspaces(force = false) {
  if (!workspaceFile) return false;
  const stat = await fs.stat(workspaceFile);
  if (!force && stat.mtimeMs === workspaceMtimeMs) return false;
  const payload = JSON.parse(await fs.readFile(workspaceFile, "utf8"));
  const workspaces = payload.citizens || payload;
  state.workspaces.clear();
  for (const [citizenId, workspace] of Object.entries(workspaces)) {
    setCitizenWorkspace(state, citizenId, await embedWorkspace(workspace, nodes, embed, { force: true }));
  }
  workspaceMtimeMs = stat.mtimeMs;
  return true;
}

if (workspaceFile) {
  await reloadWorkspaces(true);
  console.log(`${state.workspaces.size} workspace(s) citoyen(s) chargé(s) depuis ${workspacePath}.`);
}

/** Consomme les injections déposées par un autre process (une requête, typiquement). */
async function drainEvents() {
  const target = path.resolve(projectDir, eventsPath);
  let raw;
  try {
    raw = await fs.readFile(target, "utf8");
  } catch {
    return 0;
  }
  await fs.writeFile(target, "", "utf8");
  let count = 0;
  for (const line of raw.split("\n").filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "MOMENT_OUTCOME") {
      applyMomentOutcome(state, index, event.outcome, {
        policy: event.policy,
        eligibilityByMoment: event.eligibilityByMoment || {},
        observedAt: event.observedAt || null,
        outcomeId: event.outcomeId || null
      });
      count += 1;
      continue;
    }
    if (!Array.isArray(event.nodeIds) || !event.nodeIds.length) continue;
    injectAlongPath(state, index, event.nodeIds, event.amount, {
      atSeconds: event.atSeconds ?? null,
      citizenId: event.citizenId === undefined ? "query" : event.citizenId,
      flowId: event.flowId,
      workspaceId: event.workspaceId,
      workspaceVersion: event.workspaceVersion,
      workspaceEmbedding: event.workspaceEmbedding,
      embeddingModel: event.embeddingModel,
      embeddingModelVersion: event.embeddingModelVersion,
      goalIds: event.goalIds,
      originThingId: event.originThingId,
      flowKind: event.flowKind,
      trigger: event.trigger,
      budgetSource: event.budgetSource,
      maxReservoir: event.maxReservoir,
      injectedAt: event.injectedAt,
      ...loggerOptions
    });
    count += 1;
  }
  return count;
}

async function persist() {
  const target = path.resolve(projectDir, statePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const activeEnergyByNode = {};
  for (const entry of index.entries) {
    const energy = state.energy.get(entry.key) || 0;
    activeEnergyByNode[entry.source] = (activeEnergyByNode[entry.source] || 0) + energy / 2;
    activeEnergyByNode[entry.target] = (activeEnergyByNode[entry.target] || 0) + energy / 2;
  }
  const clusterEmbeddingProfiles = buildClusterEmbeddingProfiles(nodes, links, { activeEnergyByNode });
  const workspaceIntentRankings = Object.fromEntries([...state.workspaces].map(([citizenId, workspace]) => [
    citizenId,
    rankClusterEmbeddingProfiles(
      workspace.embedding,
      clusterEmbeddingProfiles,
      workspace.componentWeights || { semantic: 1 },
      { limit: 10 }
    )
  ]));
  const payload = {
    graphId,
    embeddingModel: embed.metadata,
    tuning: L4_PHYSICS_TUNING.module,
    runtimeTuning,
    workspaces: Object.fromEntries(state.workspaces),
    clusterEmbeddingProfiles,
    workspaceIntentRankings,
    stability: stable,
    summary: summarize(state, index, { limit: 15 }),
    energy: Object.fromEntries([...state.energy].filter(([, value]) => value > 0)),
    flows: Object.fromEntries([...state.flows]
      .map(([key, flows]) => [key, [...flows.values()].filter(flow => flow.amount > 0)])
      .filter(([, flows]) => flows.length > 0)),
    momentWeight: Object.fromEntries(state.momentWeight),
    momentReinforcement: Object.fromEntries(state.momentReinforcement),
    weight: Object.fromEntries([...state.weight].filter(([, value]) => Math.abs(value - 1) > 1e-6))
  };
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

if (ticks > 0) {
  await drainEvents();
  for (let round = 0; round < ticks; round += 1) {
    for (const pump of pumps) tickActor(state, index, pump.id, loggerOptions);
  }
  await persist();
  console.log(JSON.stringify(summarize(state, index), null, 2));
  console.log(`État écrit dans ${statePath}`);
} else if (watch) {
  console.log(`Tics par citoyen, période de base ${basePeriodMs / 1000}s, échelonnée. Ctrl+C pour arrêter.`);
  for (const [position, pump] of pumps.entries()) {
    // Période propre à chaque citoyen : les tics ne coïncident pas, il n'y a pas
    // d'horloge commune. L'échelonnement est déterministe, pas aléatoire.
    const period = basePeriodMs * (1 + (position % 3) * 0.5);
    setInterval(async () => {
      try {
        if (await reloadWorkspaces()) console.log(`Workspace rechargé depuis ${workspacePath}.`);
        tickActor(state, index, pump.id, loggerOptions);
      } catch (error) {
        console.error(`Rechargement du workspace impossible : ${error.message}`);
      }
    }, period).unref?.();
    setTimeout(() => {}, 0);
  }
  setInterval(async () => {
    await drainEvents();
    await persist();
    const view = summarize(state, index, { limit: 5 });
    console.log(`tic ${view.tick} · énergie ${view.totalEnergy} · liens vivants ${view.liveLinks}/${view.links} · chaud : ${view.byCluster.map(item => `${item.cluster} ${item.energy}`).join(", ")}`);
  }, basePeriodMs);
} else {
  console.log("Rien à faire : passer --ticks=N pour une passe déterministe, ou --watch pour boucler.");
}
