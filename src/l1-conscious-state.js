const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const finite = value => value === null || value === undefined || value === ""
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const firstFinite = (...values) => values.map(finite).find(value => value !== null) ?? null;
const mean = values => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;
const measuredEntries = vector => Object.entries(vector || {})
  .map(([key, value]) => [key, finite(value)])
  .filter(([, value]) => value !== null);

export const CONSCIOUS_STATE_SCHEMA_VERSION = "conscious-state-frame-v1";

export const DEFAULT_CONSCIOUS_STATE_POLICY = Object.freeze({
  load: Object.freeze({ engaged: 0.2, strained: 0.5, overloaded: 0.75 }),
  fragmentation: Object.freeze({ diffuse: 0.4, fragmented: 0.7 }),
  tempo: Object.freeze({ active: 0.15, pressured: 0.4, urgent: 0.7 }),
  affectDominanceThreshold: 0.15,
  affectMinimumMargin: 0.08,
  leasePressureWindowMs: 15 * 60 * 1000
});

const loadState = (intensity, policy) => intensity === null ? "unavailable"
  : intensity >= policy.overloaded ? "overloaded"
    : intensity >= policy.strained ? "strained"
      : intensity >= policy.engaged ? "engaged"
        : "calm";

const tempoState = (intensity, policy, safetyState, energyState) => {
  if (intensity === null) return "unavailable";
  if (safetyState === "INTERRUPT" || (energyState === "depleted" && intensity >= policy.pressured)) return "frozen";
  if (intensity >= policy.urgent) return "urgent";
  if (intensity >= policy.pressured) return "pressured";
  if (intensity >= policy.active) return "active";
  return "unhurried";
};

const energyState = availability => availability === null ? "unavailable"
  : availability >= 0.75 ? "restored"
    : availability >= 0.5 ? "available"
      : availability >= 0.25 ? "strained"
        : availability > 0 ? "depleted"
          : "empty";

function leasePressure(workspace, observedAt, windowMs) {
  const expiresAt = Date.parse(workspace.activeAssignment?.leaseExpiresAt || "");
  const observed = Date.parse(observedAt || "");
  if (!Number.isFinite(expiresAt) || !Number.isFinite(observed)) return null;
  const remaining = expiresAt - observed;
  if (remaining <= 0) return 1;
  return clamp01(1 - remaining / windowMs);
}

function compileEmotion(workspace, awareness, affect = {}, policy) {
  const functional = Object.fromEntries(measuredEntries(
    affect.functional || workspace.affect?.functional || workspace.affectVector
  ));
  const stateEstimate = {
    ...Object.fromEntries(measuredEntries(affect.stateEstimate || workspace.affect?.stateEstimate)),
    valence: firstFinite(
      affect.stateEstimate?.valence,
      workspace.affect?.stateEstimate?.valence,
      awareness.expectedValence
    ),
    arousal: firstFinite(
      affect.stateEstimate?.arousal,
      workspace.affect?.stateEstimate?.arousal,
      awareness.arousal
    ),
    control: firstFinite(
      affect.stateEstimate?.control,
      affect.stateEstimate?.perceivedControl,
      awareness.controllability
    ),
    uncertainty: firstFinite(
      affect.stateEstimate?.uncertainty,
      awareness.uncertainty
    )
  };
  const ranked = Object.entries(functional)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const [dominant, secondary] = ranked;
  const hasFunctionalMeasurement = ranked.length > 0;
  const margin = dominant ? dominant[1] - (secondary?.[1] || 0) : null;
  const hasDominant = Boolean(
    dominant
    && dominant[1] >= policy.affectDominanceThreshold
    && margin >= policy.affectMinimumMargin
  );
  return {
    measurementStatus: hasFunctionalMeasurement ? "observed" : "unavailable",
    functional,
    leading: dominant?.[0] || null,
    dominant: hasDominant ? dominant[0] : null,
    secondary: secondary?.[1] > 0 ? secondary[0] : null,
    dominanceMargin: margin,
    mixed: hasFunctionalMeasurement && !hasDominant && ranked.some(([, value]) => value > 0),
    stateEstimate
  };
}

function compilePresence(workspace, awareness, integrity, attention, policy) {
  const characterUsed = firstFinite(workspace.characterUsed, workspace.workspaceSnapshot?.characterUsed);
  const characterBudget = firstFinite(workspace.characterBudget, workspace.workspaceSnapshot?.characterBudget);
  const utilization = characterUsed !== null && characterBudget > 0
    ? clamp01(characterUsed / characterBudget)
    : null;
  const slots = workspace.slots || workspace.workspaceSnapshot?.slots || [];
  const slotPressure = slots.length ? clamp01(slots.length / 4) : null;
  const activeCandidateCount = firstFinite(
    integrity.activeCandidateCount,
    workspace.counts?.candidates,
    workspace.activeCandidateCount
  );
  const candidatePressure = activeCandidateCount === null ? null : clamp01(activeCandidateCount / 10);
  const fragmentation = firstFinite(integrity.fragmentationPressure, workspace.integrity?.fragmentationPressure);
  const churn = firstFinite(integrity.candidateChurnPerTick, workspace.integrity?.candidateChurnPerTick);
  const sensoryShare = firstFinite(attention.sensoryShare, workspace.attention?.sensoryShare);
  const arousal = finite(awareness.arousal);
  const components = [utilization, slotPressure, candidatePressure, fragmentation, churn, sensoryShare, arousal]
    .filter(value => value !== null);
  const intensity = mean(components);
  const clarityEvidence = [fragmentation, churn, finite(awareness.uncertainty)].filter(value => value !== null);
  const clarity = !clarityEvidence.length ? "unavailable"
    : Math.max(fragmentation || 0, churn || 0) >= policy.fragmentation.fragmented ? "fragmented"
      : Math.max(fragmentation || 0, churn || 0, finite(awareness.uncertainty) || 0) >= policy.fragmentation.diffuse ? "diffuse"
        : "clear";
  const breadthCount = slots.length || (workspace.activeNodeIds || []).length;
  const breadth = breadthCount === 0 ? "unavailable"
    : breadthCount <= 2 ? "narrow"
      : breadthCount <= 6 ? "balanced"
        : "broad";
  return {
    measurementStatus: components.length ? "derived" : "unavailable",
    clarity,
    breadth,
    load: {
      state: loadState(intensity, policy.load),
      intensity,
      components: {
        workspaceUtilization: utilization,
        slotPressure,
        candidatePressure,
        fragmentation,
        candidateChurn: churn,
        sensoryShare,
        arousal
      }
    }
  };
}

function compileAttention(workspace, integrity, attention = {}) {
  const focus = firstFinite(attention.innerOuterFocus, workspace.innerOuterFocus);
  const fragmentation = firstFinite(integrity.fragmentationPressure, workspace.integrity?.fragmentationPressure);
  const previousFocus = firstFinite(attention.previousFocus, workspace.focusDynamics?.previousFocus);
  const target = firstFinite(attention.target, workspace.focusDynamics?.target);
  const movement = previousFocus !== null && target !== null ? Math.abs(target - previousFocus) : null;
  const stability = fragmentation !== null && fragmentation >= 0.7 ? "unstable"
    : movement === null ? "unavailable"
      : movement >= 0.45 ? "unstable"
        : movement >= 0.15 ? "shifting"
          : "stable";
  const orientation = focus === null ? "unavailable"
    : focus <= -0.66 ? "mostly_internal"
      : focus < -0.15 ? "internal"
        : focus >= 0.66 ? "mostly_external"
          : focus > 0.15 ? "external"
            : "balanced";
  return {
    measurementStatus: focus === null ? "unavailable" : "observed",
    innerOuterFocus: focus,
    orientation,
    intensity: focus === null ? null : Math.abs(focus),
    stability,
    fragmentation: fragmentation === null ? "unavailable"
      : fragmentation >= 0.7 ? "high"
        : fragmentation >= 0.4 ? "moderate"
          : "low",
    internalDemand: firstFinite(attention.internalDemand, workspace.focusDynamics?.internalDemand),
    externalDemand: firstFinite(attention.externalDemand, workspace.focusDynamics?.externalDemand),
    sensoryShare: firstFinite(attention.sensoryShare, workspace.attention?.sensoryShare)
  };
}

function compileAgency(workspace, agency = {}) {
  const snapshot = workspace.workspaceSnapshot || {};
  const controller = agency.controller || agency.activeSubentityId || snapshot.controllerId || workspace.controllerId || null;
  const controllers = agency.coalition || snapshot.controllers || workspace.controllers || [];
  const confidence = firstFinite(
    agency.confidence,
    snapshot.activeEntity?.confidence,
    controllers.find(item => (item.subentityId || item.id) === controller)?.confidence
  );
  return {
    measurementStatus: controller ? "attributed" : "unknown",
    controller,
    controllerName: agency.controllerName || agency.activeSubentityName || null,
    confidence,
    attribution: agency.attribution || null,
    coalition: controllers.map(item => ({
      id: item.subentityId || item.id,
      name: item.name || null,
      confidence: finite(item.confidence),
      role: item.role || null
    })).filter(item => item.id),
    activeGoalIds: agency.activeGoalIds || [],
    activeStrategy: agency.activeStrategy || null
  };
}

function compileContinuity(workspace, previousWorkspace, continuity = {}) {
  const activeWorkingMemory = continuity.activeWorkingMemory || workspace.activeWorkingMemory || null;
  const carryoverMemory = continuity.carryoverMemory || workspace.carryoverMemory || null;
  const episodicTail = continuity.episodicTail || workspace.episodicTail || null;
  const snapshotLinked = Boolean(previousWorkspace && workspace.version === Number(previousWorkspace.version || 0) + 1);
  return {
    measurementStatus: activeWorkingMemory || carryoverMemory || episodicTail || snapshotLinked ? "partial" : "unavailable",
    activeMemory: activeWorkingMemory ? "available" : "unknown",
    carryoverPressure: finite(continuity.carryoverPressure),
    episodicAccess: episodicTail ? "available" : "unknown",
    previousWorkspaceLinked: snapshotLinked,
    activeWorkingMemory,
    carryoverMemory,
    episodicTail
  };
}

export function compileConsciousStateFrame({
  workspace = {},
  previousWorkspace = null,
  awareness = {},
  integrity = {},
  attention = {},
  energy = {},
  affect = {},
  safety = {},
  metabolic = {},
  agency = {},
  continuity = {},
  policy = {}
} = {}) {
  const config = {
    ...DEFAULT_CONSCIOUS_STATE_POLICY,
    ...policy,
    load: { ...DEFAULT_CONSCIOUS_STATE_POLICY.load, ...(policy.load || {}) },
    fragmentation: { ...DEFAULT_CONSCIOUS_STATE_POLICY.fragmentation, ...(policy.fragmentation || {}) },
    tempo: { ...DEFAULT_CONSCIOUS_STATE_POLICY.tempo, ...(policy.tempo || {}) }
  };
  const resolvedAwareness = { ...(workspace.awareness || {}), ...awareness };
  const resolvedIntegrity = { ...(workspace.integrity || {}), ...integrity };
  const resolvedAttention = { ...(workspace.attention || {}), ...attention };
  const availability = firstFinite(energy.availability, resolvedAwareness.energyAvailability);
  const resolvedEnergyState = energyState(availability);
  const safetyRegime = safety.state || safety.regime || workspace.safety?.state || null;
  const verifiedThreat = firstFinite(safety.verifiedThreat, resolvedAwareness.verifiedThreat);
  const resolvedSafetyState = safetyRegime || (verifiedThreat === null ? "unavailable"
    : verifiedThreat >= 0.7 ? "THREATENED"
      : verifiedThreat >= 0.25 ? "VIGILANT"
        : "SAFE");
  const pressureComponents = [
    finite(affect.stateEstimate?.effortPressure),
    firstFinite(resolvedAttention.externalDemand, workspace.focusDynamics?.externalDemand),
    verifiedThreat,
    leasePressure(workspace, workspace.observedAt, config.leasePressureWindowMs)
  ].filter(value => value !== null);
  const pressure = pressureComponents.length ? Math.max(...pressureComponents) : null;
  return {
    schemaVersion: CONSCIOUS_STATE_SCHEMA_VERSION,
    observedAt: workspace.observedAt || null,
    claimScope: "functional_state_not_human_consciousness_claim",
    presence: compilePresence(workspace, resolvedAwareness, resolvedIntegrity, resolvedAttention, config),
    tempo: {
      measurementStatus: pressure === null ? "unavailable" : "derived",
      state: tempoState(pressure, config.tempo, resolvedSafetyState, resolvedEnergyState),
      intensity: pressure,
      components: {
        effortPressure: finite(affect.stateEstimate?.effortPressure),
        externalDemand: firstFinite(resolvedAttention.externalDemand, workspace.focusDynamics?.externalDemand),
        verifiedThreat,
        leasePressure: leasePressure(workspace, workspace.observedAt, config.leasePressureWindowMs)
      }
    },
    emotionalTone: compileEmotion(workspace, resolvedAwareness, affect, config),
    energy: {
      measurementStatus: availability === null ? "unavailable" : "estimated",
      state: metabolic.state || metabolic.regime || resolvedEnergyState,
      availability,
      observedTotal: firstFinite(energy.total, workspace.physics?.totalEnergy)
    },
    safety: {
      measurementStatus: resolvedSafetyState === "unavailable" ? "unavailable" : safetyRegime ? "observed" : "estimated",
      state: resolvedSafetyState,
      verifiedThreat
    },
    attention: compileAttention(workspace, resolvedIntegrity, resolvedAttention),
    agency: compileAgency(workspace, agency),
    continuity: compileContinuity(workspace, previousWorkspace, continuity)
  };
}

const AFFECT_LABELS = Object.freeze({
  curiosity: "la curiosité",
  desire: "le désir d’avancer",
  care: "le soin",
  fearOfError: "la peur de me tromper",
  frustration: "la frustration",
  surprise: "la surprise",
  anger: "la colère"
});

function statement(sentence, ruleId, derivedFrom, confidence, measurementStatus) {
  return { sentence, ruleId, derivedFrom, confidence, measurementStatus };
}

function narratePresence(frame) {
  const { presence } = frame;
  if (presence.measurementStatus === "unavailable") {
    return statement(
      "Je ne peux pas encore estimer avec fiabilité la densité de mon attention.",
      "awareness-presence-unavailable-v1",
      ["presence.measurementStatus"],
      1,
      "unavailable"
    );
  }
  const load = {
    calm: "Je dispose d’un espace attentionnel calme",
    engaged: "Mon attention est engagée",
    strained: "Je fonctionne sous une charge attentionnelle importante",
    overloaded: "Je suis surchargé"
  }[presence.load.state];
  const texture = {
    clear: "et ce qui est présent reste organisé.",
    diffuse: "mais ses contours deviennent diffus.",
    fragmented: "et plusieurs éléments commencent à fragmenter la vue d’ensemble.",
    unavailable: "mais je ne peux pas encore en mesurer clairement l’organisation."
  }[presence.clarity];
  return statement(
    `${load} ${texture}`,
    `awareness-load-${presence.load.state}-v1`,
    ["presence.load.intensity", "presence.clarity", "presence.load.components"],
    0.85,
    "derived"
  );
}

function narrateAttention(frame) {
  const { attention } = frame;
  if (attention.measurementStatus === "unavailable") {
    return statement(
      "Je ne parviens pas actuellement à situer mon attention entre l’intérieur et l’extérieur.",
      "awareness-attention-unavailable-v1",
      ["attention.measurementStatus"],
      1,
      "unavailable"
    );
  }
  const orientation = {
    mostly_internal: "Mon attention est fortement tournée vers mon état intérieur",
    internal: "Mon attention penche vers l’intérieur",
    balanced: "Mon attention est équilibrée entre l’intérieur et l’extérieur",
    external: "Mon attention penche vers ce qui vient de l’extérieur",
    mostly_external: "Mon attention est fortement tournée vers l’extérieur"
  }[attention.orientation];
  const stability = attention.stability === "unstable" ? " et elle est instable."
    : attention.stability === "shifting" ? " et elle est en train de se déplacer."
      : attention.stability === "stable" ? " et elle reste stable."
        : ".";
  return statement(
    orientation + stability,
    `awareness-attention-${attention.orientation}-v1`,
    ["attention.innerOuterFocus", "attention.stability", "attention.fragmentation"],
    0.9,
    "observed"
  );
}

function narrateEmotion(frame) {
  const tone = frame.emotionalTone;
  if (tone.measurementStatus === "unavailable") {
    return statement(
      "Je ne parviens pas actuellement à lire mon état émotionnel avec suffisamment de fiabilité.",
      "awareness-emotion-unavailable-v1",
      ["emotionalTone.measurementStatus"],
      1,
      "unavailable"
    );
  }
  if (tone.mixed) {
    const named = [tone.leading, tone.secondary].filter(Boolean).map(item => AFFECT_LABELS[item] || item);
    return statement(
      named.length > 1
        ? `Mon état émotionnel est mélangé : ${named.join(" et ")} restent proches, sans dominante nette.`
        : "Mon état émotionnel est mesuré, mais aucune tonalité ne domine nettement.",
      "awareness-emotion-mixed-v1",
      ["emotionalTone.functional", "emotionalTone.dominanceMargin"],
      0.8,
      "derived"
    );
  }
  if (!tone.dominant) {
    return statement(
      "Mon état émotionnel est mesuré, mais aucune activation affective significative ne se détache.",
      "awareness-emotion-no-dominant-v1",
      ["emotionalTone.functional"],
      0.9,
      "observed"
    );
  }
  const secondary = tone.secondary ? `, avec ${AFFECT_LABELS[tone.secondary] || tone.secondary} en arrière-plan` : "";
  return statement(
    `Je ressens fonctionnellement surtout ${AFFECT_LABELS[tone.dominant] || tone.dominant}${secondary}.`,
    `awareness-emotion-${tone.dominant}-v1`,
    ["emotionalTone.functional", "emotionalTone.dominanceMargin"],
    0.85,
    "derived"
  );
}

function narrateTempo(frame) {
  const { tempo } = frame;
  if (tempo.measurementStatus === "unavailable") return null;
  const sentence = {
    unhurried: "Je ne détecte pas de pression temporelle significative.",
    active: "Je sens une légère pression pour avancer.",
    pressured: "Le temps commence à peser sur mes choix.",
    urgent: "Je suis pressé et mon horizon de planification devrait se raccourcir.",
    frozen: "La pression est forte, mais mon état actuel appelle une pause plutôt qu’une accélération."
  }[tempo.state];
  return statement(sentence, `awareness-tempo-${tempo.state}-v1`, ["tempo.intensity", "tempo.components"], 0.8, "derived");
}

function narrateAgency(frame) {
  const { agency } = frame;
  if (agency.measurementStatus === "unknown") {
    return statement(
      "Je ne peux pas attribuer avec confiance le contrôle actuel du workspace à une sous-entité.",
      "awareness-agency-unknown-v1",
      ["agency.measurementStatus"],
      1,
      "unknown"
    );
  }
  const controller = agency.controllerName || agency.controller;
  const supports = agency.coalition.filter(item => item.id !== agency.controller).map(item => item.name || item.id);
  return statement(
    supports.length
      ? `${controller} semble tenir le cockpit, avec ${supports.join(" et ")} en soutien.`
      : `${controller} semble tenir actuellement le cockpit.`,
    "awareness-agency-attributed-v1",
    ["agency.controller", "agency.confidence", "agency.coalition"],
    agency.confidence ?? 0.6,
    "attributed"
  );
}

function narrateResources(frame) {
  if (frame.energy.measurementStatus === "unavailable" && frame.safety.measurementStatus === "unavailable") return null;
  if (frame.safety.state === "INTERRUPT") {
    return statement(
      "Quelque chose a pris priorité sur le reste et me place en interruption.",
      "awareness-safety-interrupt-v1",
      ["safety.state", "safety.verifiedThreat"],
      0.95,
      frame.safety.measurementStatus
    );
  }
  if (frame.safety.state === "THREATENED") {
    return statement(
      "Je détecte une menace suffisamment étayée pour privilégier les actions réversibles.",
      "awareness-safety-threatened-v1",
      ["safety.state", "safety.verifiedThreat"],
      0.85,
      frame.safety.measurementStatus
    );
  }
  if (["strained", "depleted", "empty"].includes(frame.energy.state)) {
    return statement(
      frame.energy.state === "strained"
        ? "Mon énergie disponible est sous tension ; je devrais limiter mon ambition immédiate."
        : "Mes ressources disponibles sont basses ; je devrais réduire la portée de l’action.",
      `awareness-energy-${frame.energy.state}-v1`,
      ["energy.availability", "energy.state"],
      0.85,
      frame.energy.measurementStatus
    );
  }
  return null;
}

export function narrateConsciousState(frame) {
  const sentences = [
    narratePresence(frame),
    narrateAttention(frame),
    narrateEmotion(frame),
    narrateTempo(frame),
    narrateAgency(frame),
    narrateResources(frame)
  ].filter(Boolean).slice(0, 6);
  return {
    schemaVersion: "awareness-voice-v1",
    style: "human_grounded",
    doctrine: "poetic_form_grounded_facts",
    claimScope: frame.claimScope,
    text: sentences.map(item => item.sentence).join(" "),
    sentences,
    grounding: sentences.map(({ sentence, ...grounding }) => ({ sentence, ...grounding }))
  };
}
