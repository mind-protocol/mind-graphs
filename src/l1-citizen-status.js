import { describeCitizenStatus } from "./citizen-status-text.js";
import { summarizeSubentityRuntime } from "./l1-integrated-runtime.js";

const unique = values => [...new Set(values.filter(Boolean))];
const finite = value => value === null || value === undefined || value === ""
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const activeSubentitiesOf = state => (state?.subentities || [])
  .filter(entity => entity.status !== "merged")
  .sort((left, right) => Number(right.weight || 0) - Number(left.weight || 0));

function dominantAffect(vector = {}) {
  const ranked = Object.entries(vector)
    .map(([affect, intensity]) => ({ affect, intensity: finite(intensity) }))
    .filter(item => item.intensity !== null)
    .sort((left, right) => right.intensity - left.intensity);
  return ranked[0]?.intensity > 0
    ? { ...ranked[0], margin: ranked[0].intensity - (ranked[1]?.intensity || 0) }
    : null;
}

function runtimeForCitizen(runtimeState, citizenId, primaryCitizenId) {
  if (runtimeState?.citizens?.[citizenId]) return runtimeState.citizens[citizenId];
  return citizenId === primaryCitizenId ? runtimeState : {};
}

function latestReinforcement(moment) {
  const reinforcement = moment?.reinforcement || {};
  return {
    momentId: moment?.id || null,
    reinforcedMomentCount: reinforcement.updateCount ? 1 : 0,
    reinforcementScore: finite(reinforcement.lastScore),
    outcome: reinforcement.lastOutcomeVector || null,
    observedAt: reinforcement.lastObservedAt || moment?.occurredAt || null
  };
}

export function composeCitizenStatuses({
  runtimeState = {},
  physicsState = {},
  globalWorkspaceState = {},
  shadowState = {},
  projection = {},
  sourceAvailability = {},
  primaryCitizenId,
  fallbackCitizenId = "citizen-local",
  textConfig = "standard",
  generatedAt = new Date().toISOString()
} = {}) {
  const globalCitizens = globalWorkspaceState.citizens || {};
  const physicsWorkspaces = physicsState.workspaces || {};
  const energyCitizens = (physicsState.summary?.byCitizen || [])
    .map(item => item.citizenId)
    .filter(id => id && id !== "(non attribué)" && id !== "(non attribuÃ©)");
  const citizenIds = unique([
    ...Object.keys(globalCitizens),
    ...Object.keys(physicsWorkspaces),
    ...energyCitizens,
    primaryCitizenId,
    runtimeState.citizenId
  ]);
  if (!citizenIds.length) citizenIds.push(fallbackCitizenId);
  const primary = primaryCitizenId || Object.keys(globalCitizens)[0] || Object.keys(physicsWorkspaces)[0] || citizenIds[0];

  const citizens = citizenIds.map(citizenId => {
    const runtime = runtimeForCitizen(runtimeState, citizenId, primary);
    const summary = summarizeSubentityRuntime(runtime);
    const workspace = globalCitizens[citizenId] || physicsWorkspaces[citizenId] || {};
    const physicsWorkspace = physicsWorkspaces[citizenId] || {};
    const affectVector = workspace.affectVector || physicsWorkspace.affectVector || {};
    const activeSubentities = activeSubentitiesOf(runtime);
    const controller = summary.controllers[0] || null;
    const activeSubentity = activeSubentities.find(entity => entity.id === controller?.subentityId) || activeSubentities[0] || null;
    const awareness = runtime.metacognitive?.awareness || {};
    const scenarios = runtime.metacognitive?.scenarios || [];
    const citizenEnergy = (physicsState.summary?.byCitizen || []).find(item => item.citizenId === citizenId)?.energy;
    const focus = workspace.innerOuterFocus ?? physicsWorkspace.innerOuterFocus;
    const focusDynamics = workspace.focusDynamics || physicsWorkspace.focusDynamics || {};
    const questionAgenda = workspace.questionAgenda || [];
    const questionLedger = workspace.questionLedger || {};
    const shadowMetrics = shadowState.metrics || {};
    const latestMoment = summary.latestMoment;

    const status = {
      schemaVersion: "citizen-status-v1",
      citizenId,
      name: workspace.citizenName || workspace.actorName || citizenId,
      graphId: workspace.graphId || physicsState.graphId || null,
      observedAt: workspace.observedAt || runtime.updatedAt || generatedAt,
      tick: workspace.physics?.tick ?? physicsState.summary?.tick ?? null,
      revision: summary.revision,
      executive: {
        cortexState: workspace.cortexState || physicsWorkspace.cortexState || null,
        metacognitiveMode: runtime.metacognitive?.mode || null,
        workspaceMode: workspace.mode || null,
        activeTask: workspace.activeTask || null,
        goalIds: workspace.goalIds || physicsWorkspace.goalIds || [],
        activeNodeIds: workspace.activeNodeIds || [],
        queue: workspace.queue || null
      },
      attention: {
        innerOuterFocus: finite(focus),
        previousFocus: finite(focusDynamics.previousFocus),
        target: finite(focusDynamics.target),
        internalDemand: finite(focusDynamics.internalDemand),
        externalDemand: finite(focusDynamics.externalDemand)
      },
      energy: {
        availability: finite(awareness.energyAvailability),
        citizenEnergy: finite(citizenEnergy),
        graphEnergy: finite(physicsState.summary?.totalEnergy),
        injected: finite(physicsState.summary?.injected),
        liveLinks: finite(physicsState.summary?.liveLinks),
        activeFlows: finite(physicsState.summary?.activeFlows),
        hotClusters: workspace.physics?.hotClusters || physicsState.summary?.byCluster || []
      },
      affect: {
        vector: affectVector,
        dominant: dominantAffect(affectVector)
      },
      awareness,
      agency: {
        activeSubentityId: activeSubentity?.id || null,
        activeSubentityName: activeSubentity?.name || null,
        controllerConfidence: finite(controller?.confidence),
        controllerAttribution: controller?.attribution || null,
        gate: finite(activeSubentity?.behavioralState?.gate),
        activeGoalIds: (activeSubentity?.goals || []).map(goal => typeof goal === "string" ? goal : goal.key).filter(Boolean),
        activeStrategy: activeSubentity?.behavioralState?.strategies?.[0]
          || (typeof activeSubentity?.strategies?.[0] === "string" ? activeSubentity.strategies[0] : activeSubentity?.strategies?.[0]?.key)
          || null
      },
      cognition: {
        scenarioCount: scenarios.length,
        scenarios,
        openQuestionCount: questionAgenda.length,
        questionBudget: finite(workspace.questionBudget),
        unresolvedGapCount: Object.values(questionLedger).filter(entry => !["resolved", "exhausted"].includes(entry?.status)).length,
        questionAgenda
      },
      learning: latestReinforcement(latestMoment),
      integrity: {
        projectionStatus: projection.status || null,
        projectionRevision: finite(projection.revision),
        fragmentationPressure: finite(shadowMetrics.fragmentationPressure),
        candidateChurnPerTick: finite(shadowMetrics.candidateChurnPerTick),
        controllerCoverage: finite(shadowMetrics.controllerCoverage),
        conserved: workspace.conservation?.conserved ?? null
      },
      subentities: activeSubentities,
      controllers: summary.controllers,
      counts: summary.counts,
      recentEvents: summary.recentEvents,
      narratives: summary.narratives,
      sourceAvailability
    };
    return { ...status, text: describeCitizenStatus(status, textConfig) };
  });

  return { schemaVersion: "citizen-status-collection-v1", generatedAt, citizens };
}
