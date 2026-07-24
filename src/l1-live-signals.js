// Compilation des signaux vivants en une entrée de tick L1 intégré.
//
// Deux sources sont déjà écrites en continu par le runtime :
//   - artifacts/l4/physics-state.json   (l4-tick --watch : énergie par arête)
//   - artifacts/autonomy/global-workspace.json (workspace courant du citoyen)
//
// Aucune de ces deux sources ne portait jusqu'ici jusqu'au cycle de vie des
// sous-entités : le runtime restait vide. Ce module fait le pont, sans jamais
// fabriquer une mesure. Une grandeur absente est signalée `unavailable` et
// laissée absente de l'entrée ; elle ne devient jamais zéro.
import { readFile } from "node:fs/promises";

// Budget de caractères du Global Workspace pour un tick piloté depuis le site.
// Il borne l'attention : sans lui, selectGlobalWorkspace n'est jamais appelé et
// aucune enchère n'est arbitrée. Explicite ici plutôt que deviné ailleurs.
export const DEFAULT_LIVE_CHARACTER_BUDGET = 2000;

// Nombre de nœuds sensoriels retenus. Le détecteur de coalition ne signe que
// sur les 8 premiers : au-delà, on ne ferait qu'alourdir la trace.
export const DEFAULT_SENSORY_TARGET_LIMIT = 24;

const safeSegment = value => String(value || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Énergie incidente par nœud, dérivée des arêtes vivantes `source|TYPE|target`.
 *
 * L'énergie circule le long d'une arête : ses deux extrémités sont activées.
 * L'acteur percevant est retiré de ses propres cibles sensorielles — il est le
 * point de vue, pas l'objet perçu. Sans ce retrait, toutes les arêtes
 * AUTHORED_BY convergeraient sur lui et écraseraient la signature de coalition.
 */
export function nodeEnergyFromPhysics(physics, { perceiverId = null } = {}) {
  const totals = new Map();
  for (const [edgeKey, rawEnergy] of Object.entries(physics?.energy || {})) {
    const energy = Number(rawEnergy);
    if (!positive(energy)) continue;
    const parts = String(edgeKey).split("|");
    if (parts.length !== 3) continue;
    for (const nodeId of [parts[0], parts[2]]) {
      if (!nodeId || nodeId === perceiverId) continue;
      totals.set(nodeId, (totals.get(nodeId) || 0) + energy);
    }
  }
  return [...totals]
    .map(([id, energy]) => ({ id, energy }))
    .sort((left, right) => right.energy - left.energy || left.id.localeCompare(right.id));
}

/** Part d'énergie attribuée à ce citoyen par la physique L4, ou `null` si non attribuée. */
export function citizenEnergyShare(physics, citizenId) {
  const entry = (physics?.summary?.byCitizen || []).find(item => item.citizenId === citizenId);
  const allocated = Number(entry?.energy);
  const total = Number(physics?.summary?.totalEnergy);
  if (!Number.isFinite(allocated) || !positive(total)) return null;
  return { allocatedEnergy: allocated, totalBudget: total };
}

/**
 * Compile une entrée de tick à partir d'un workspace citoyen et d'un état physique.
 *
 * `observationId` est ancré sur le contentHash du workspace : deux pulsations sur
 * un même état cérébral partagent la même preuve et ne peuvent donc pas consolider
 * deux fois poids, stabilité et certitude. Regarder plus souvent n'est pas savoir
 * davantage.
 *
 * `tickId` est ancré sur (version workspace, tick L4) : il est déterministe et
 * rejouable. Une pulsation sur un état inchangé renvoie `already_processed`, ce
 * qui est le résultat honnête — « rien de nouveau n'a été observé » — et non un
 * échec.
 */
export function compileLiveTickInput({
  citizenId,
  workspace,
  physics,
  characterBudget = DEFAULT_LIVE_CHARACTER_BUDGET,
  sensoryTargetLimit = DEFAULT_SENSORY_TARGET_LIMIT,
  previousSnapshot = null
}) {
  if (!citizenId) throw new Error("compileLiveTickInput requires a citizenId.");
  if (!workspace) throw new Error(`No live workspace available for ${citizenId}.`);
  if (!physics?.summary) throw new Error("compileLiveTickInput requires a physics summary.");

  const unavailable = [];
  const share = citizenEnergyShare(physics, citizenId);
  if (!share) unavailable.push("sensory.allocatedEnergy");

  const targets = nodeEnergyFromPhysics(physics, { perceiverId: citizenId }).slice(0, sensoryTargetLimit);
  if (!targets.length) unavailable.push("sensory.transfers");

  // Un vecteur affectif vide n'est pas un état neutre : c'est une absence de mesure.
  const affectVector = workspace.affectVector && Object.keys(workspace.affectVector).length
    ? workspace.affectVector
    : null;
  if (!affectVector) unavailable.push("affect.vector");

  const attention = workspace.consciousState?.attention || {};
  const focusMeasured = attention.measurementStatus === "derived" || attention.measurementStatus === "observed";
  if (!focusMeasured) unavailable.push("workspace.focusIntensity");

  const recordedAt = workspace.observedAt || null;
  if (!recordedAt) throw new Error(`Live workspace for ${citizenId} carries no observedAt; a Moment cannot be dated.`);

  const contentHash = workspace.contentHash || null;
  if (!contentHash) throw new Error(`Live workspace for ${citizenId} carries no contentHash; evidence identity is undefined.`);

  const tickId = `live-${safeSegment(citizenId)}-ws${Number(workspace.version) || 0}-l4t${Number(physics.summary.tick) || 0}`;

  return {
    tickId,
    recordedAt,
    observationId: `${citizenId}:${contentHash}`,
    sensory: {
      citizenId,
      transfers: targets.map(target => ({ targetNodeId: target.id, energy: target.energy })),
      ...(share || {})
    },
    // L'affect n'est transmis que s'il est mesuré. Le détecteur traite
    // légitimement une absence comme « aucun affect dominant », pas comme calme.
    affect: affectVector ? { vector: affectVector } : {},
    workspace: {
      id: workspace.id || `workspace-${safeSegment(citizenId)}`,
      actorId: citizenId,
      activeNodeIds: [...new Set(workspace.activeNodeIds || [])],
      goalIds: [...new Set(workspace.goalIds || [])],
      cortexState: workspace.cortexState || null,
      ...(focusMeasured ? { focusIntensity: Number(attention.intensity) || 0 } : {}),
      characterBudget,
      previousSnapshot
    },
    provenance: {
      citizenId,
      workspaceVersion: Number(workspace.version) || 0,
      workspaceObservedAt: recordedAt,
      workspaceContentHash: contentHash,
      physicsTick: Number(physics.summary.tick) || 0,
      physicsTotalEnergy: Number(physics.summary.totalEnergy) || 0,
      liveLinks: Number(physics.summary.liveLinks) || 0,
      sensoryTargetCount: targets.length,
      characterBudget,
      unavailable
    }
  };
}

/**
 * Lit les deux artefacts vivants et compile l'entrée du prochain tick.
 * Renvoie aussi le workspace brut : la vue en a besoin pour afficher l'état
 * conscient tel qu'il est déjà publié, sans le recalculer.
 */
export async function readLiveTickInput({
  workspacePath,
  physicsPath,
  citizenId,
  characterBudget,
  previousSnapshot = null
}) {
  const [workspaceFile, physics] = await Promise.all([
    readJsonOrNull(workspacePath),
    readJsonOrNull(physicsPath)
  ]);
  if (!workspaceFile) throw new Error(`Live workspace artifact is missing at ${workspacePath}.`);
  if (!physics) throw new Error(`L4 physics artifact is missing at ${physicsPath}.`);

  const citizens = workspaceFile.citizens || {};
  const resolvedCitizenId = citizenId || Object.keys(citizens)[0];
  if (!resolvedCitizenId) throw new Error("The live workspace artifact declares no citizen.");
  const workspace = citizens[resolvedCitizenId];
  if (!workspace) throw new Error(`The live workspace artifact declares no citizen ${resolvedCitizenId}.`);

  return {
    citizenId: resolvedCitizenId,
    availableCitizenIds: Object.keys(citizens),
    workspace,
    // Les profils de clusters servent de repère à la carte : ils voyagent avec
    // les signaux plutôt que d'être relus séparément.
    clusterProfiles: physics.clusterEmbeddingProfiles || [],
    graphId: workspace.graphId || physics.graphId || null,
    input: compileLiveTickInput({ citizenId: resolvedCitizenId, workspace, physics, characterBudget, previousSnapshot })
  };
}
