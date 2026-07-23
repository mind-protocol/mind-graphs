import { injectAtNode, propagate, relax, L4_PHYSICS_TUNING } from "./l4-physics.js";
import { selectCitizenConnections, embedSensoryLines, routeSensoryEnergy } from "./l1-sensory-runtime.js";
import { allocateAttentionBudget, createAttentionState } from "./l1-attention-arbitrator.js";

const tuningValues = () => Object.fromEntries(
  Object.entries(L4_PHYSICS_TUNING.parameters).map(([key, spec]) => [key, spec.value])
);

/**
 * Un tick citoyen intégré. Le budget sensoriel est prélevé sur l'injection du
 * citoyen ; le reliquat revient à son voisinage local. Une seule propagation et
 * une seule relaxation suivent, comme dans un tick L4 normal.
 */
export async function tickCitizenWithSenses({
  state, index, citizenId, sourceGraphs, l1Nodes, embed, cache, sensoryConfig,
  workspaceState = null, attentionState = createAttentionState(), attentionConfig = {}, tuning = {}
}) {
  const resolvedTuning = { ...tuningValues(), ...tuning };
  const citizenWeight = state.nodeWeight.get(citizenId) ?? 1;
  const totalBudget = citizenWeight * resolvedTuning.actorInjection;
  const connections = selectCitizenConnections(sourceGraphs, sensoryConfig);
  const embeddedLines = await embedSensoryLines(connections, { embed, cache });
  const attention = allocateAttentionBudget({
    totalBudget,
    connections,
    embeddedLines,
    workspaceState: workspaceState || state.workspaces.get(citizenId) || {},
    previousState: attentionState,
    now: sensoryConfig.now,
    recentWindowMs: sensoryConfig.recentWindowMs,
    config: attentionConfig,
    absoluteSensoryCap: sensoryConfig.sensoryEnergyBudget
  });
  const routing = routeSensoryEnergy(embeddedLines, l1Nodes, {
    ...sensoryConfig,
    citizenId,
    sensoryEnergyBudget: attention.sensoryBudget
  });
  const sensory = {
    tickId: sensoryConfig.tickId,
    citizenId,
    selectedConnections: connections,
    embeddedLines,
    ...routing
  };

  for (const transfer of sensory.transfers) {
    injectAtNode(state, index, transfer.targetNodeId, transfer.energy, {
      citizenId,
      flowId: `sensory:${sensory.tickId}:${transfer.sensoryLineHash}:${transfer.targetNodeId}`,
      injectedAt: sensoryConfig.now,
      remainingBudget: transfer.energy,
      workspaceEmbedding: l1Nodes.find(node => node.id === transfer.targetNodeId)?.embedding,
      workspaceId: `sensory-${sensory.tickId}`,
      goalIds: []
    });
  }

  // Toute part sensorielle non allouée reste disponible localement, comme le
  // reliquat non sensoriel. Rien ne disparaît lorsqu'aucune similarité ne passe.
  const localBudget = totalBudget - sensory.allocatedEnergy;
  if (localBudget > 0) injectAtNode(state, index, citizenId, localBudget, {
    citizenId,
    flowId: `local:${sensory.tickId}:${citizenId}`,
    injectedAt: sensoryConfig.now,
    remainingBudget: localBudget
  });

  propagate(state, index, resolvedTuning, { citizenId });
  relax(state, index, resolvedTuning);
  const currentWorkspace = state.workspaces.get(citizenId) || {};
  state.workspaces.set(citizenId, {
    ...currentWorkspace,
    innerOuterFocus: attention.focusDynamics.nextFocus,
    focusDynamics: attention.focusDynamics
  });
  state.tick += 1;
  return {
    sensory,
    attention,
    totalBudget,
    sensoryAllocated: sensory.allocatedEnergy,
    localBudget,
    injectedDelta: totalBudget
  };
}
