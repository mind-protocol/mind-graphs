// Compile un état lisible du cerveau : pour chaque sous-entité, ce qu'elle fait,
// pourquoi, et ce qu'on sait de son affect.
//
// Règle unique de ce module : ne jamais transformer une absence en valeur. Chaque
// bloc porte un `measurementStatus`, et `unavailable` est un résultat, pas un
// trou à combler par un zéro.
import { FRENCH_AFFECT_PHRASES } from "./l1-affective-runtime.js";

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const itemKey = item => String(typeof item === "string" ? item : item?.key ?? item?.id ?? item?.name ?? "").trim();
const unknown = reason => ({ measurementStatus: "unavailable", reason });

/** Nœuds portés par la signature de coalition, ordonnés par part d'activation. */
function signatureNodes(entity) {
  return Object.entries(entity.signature || {})
    .filter(([key]) => key.startsWith("node:"))
    .map(([key, share]) => ({ id: key.slice(5), share: Number(share) || 0 }))
    .sort((left, right) => right.share - left.share);
}

function affectOf(entity) {
  if (!entity.dominantAffect) {
    return unknown("aucun affect dominant n'a été mesuré pendant les ticks qui ont formé cette sous-entité");
  }
  const key = String(entity.dominantAffect);
  return {
    measurementStatus: "inferred",
    affect: key,
    phrase: FRENCH_AFFECT_PHRASES[key] || key,
    intensity: Number(entity.signature?.[`affect:${key}`]) || null
  };
}

function behaviourOf(entity) {
  const behavioural = entity.behavioralState;
  if (!behavioural) {
    return unknown("aucun tick métacognitif n'a encore attribué de mode ni de gate à cette sous-entité");
  }
  return {
    measurementStatus: "derived",
    mode: behavioural.mode || null,
    gate: clamp01(behavioural.gate),
    gateDelta: Number(behavioural.gateDelta) || 0,
    scenarioSupport: clamp01(behavioural.scenarioSupport),
    strategies: behavioural.strategies || [],
    planningHorizon: behavioural.planningHorizon || null
  };
}

/** Place de la sous-entité dans le workspace : elle mène, elle soutient, ou elle se tait. */
function workspacePlaceOf(entity, snapshot) {
  const slot = (snapshot?.slots || []).find(item => item.controllerId === entity.id);
  const bid = (snapshot?.bids || []).find(item => item.controllerId === entity.id);
  if (!slot) {
    return {
      role: "silent",
      admitted: false,
      rank: bid?.rank ?? null,
      score: bid ? Number(bid.score) : null,
      penalty: bid ? Number(bid.penalty) : null,
      characterAllocation: 0
    };
  }
  return {
    role: slot.role,
    admitted: true,
    rank: slot.rank,
    score: Number(slot.score),
    positiveScore: Number(slot.positiveScore),
    penalty: Number(slot.penalty),
    characterAllocation: Number(slot.characterAllocation) || 0
  };
}

export function latestWorkspaceSnapshot(state = {}) {
  return [...(state.workspaceSnapshots || [])]
    .sort((left, right) => String(right.occurredAt || "").localeCompare(String(left.occurredAt || "")))[0] || null;
}

function metacognitionOf(state) {
  const metacognitive = state.metacognitive;
  if (!metacognitive) {
    return unknown("aucun scénario de traversée n'a encore été soumis au runtime métacognitif");
  }
  return {
    measurementStatus: "derived",
    mode: metacognitive.mode,
    revision: metacognitive.revision,
    awareness: metacognitive.awareness,
    scenarioCount: (metacognitive.scenarios || []).length
  };
}

/**
 * @param state état runtime des sous-entités (source d'autorité)
 * @param citizen workspace vivant du citoyen, déjà publié par le runtime L4
 */
export function compileBrainFrame(state = {}, { citizen = null, source = null } = {}) {
  const snapshot = latestWorkspaceSnapshot(state);
  const active = (state.subentities || []).filter(entity => entity.status !== "merged");
  const subentities = active
    .map(entity => {
      const place = workspacePlaceOf(entity, snapshot);
      return {
        id: entity.id,
        name: entity.name || null,
        level: entity.level || "low",
        status: entity.status || "candidate",
        coalitionKey: entity.coalitionKey || null,
        doing: { ...place, behaviour: behaviourOf(entity) },
        why: {
          goals: (entity.goals || []).map(itemKey).filter(Boolean),
          strategies: (entity.strategies || []).map(itemKey).filter(Boolean),
          activatedNodes: signatureNodes(entity).slice(0, 8),
          evidenceMomentCount: (entity.evidenceMomentIds || []).length,
          observationCount: Number(entity.observationCount) || 0,
          lastObservedAt: entity.lastObservedAt || null,
          lastActivation: Number(entity.lastActivation) || 0
        },
        feeling: affectOf(entity),
        structure: {
          weight: Number(entity.weight) || 0,
          stability: clamp01(entity.stability),
          certainty: clamp01(entity.certainty),
          coherence: clamp01(entity.coherence)
        }
      };
    })
    .sort((left, right) => right.doing.characterAllocation - left.doing.characterAllocation
      || right.structure.weight - left.structure.weight
      || left.id.localeCompare(right.id));

  return {
    revision: Number(state.revision || 0),
    updatedAt: state.updatedAt || null,
    source,
    counts: {
      active: active.length,
      highLevel: active.filter(entity => entity.level === "high").length,
      candidates: active.filter(entity => entity.level !== "high").length,
      merged: (state.subentities || []).filter(entity => entity.status === "merged").length,
      admitted: subentities.filter(entity => entity.doing.admitted).length,
      moments: (state.moments || []).length,
      snapshots: (state.workspaceSnapshots || []).length
    },
    workspace: snapshot
      ? {
        measurementStatus: "observed",
        id: snapshot.id,
        version: snapshot.version,
        occurredAt: snapshot.occurredAt,
        characterBudget: snapshot.characterBudget,
        characterUsed: snapshot.characterUsed,
        controllerId: snapshot.controllerId,
        controllerStatus: snapshot.controllerStatus,
        slots: snapshot.slots || [],
        bids: snapshot.bids || [],
        audit: snapshot.audit || null
      }
      : unknown("aucun snapshot de workspace n'a encore été arbitré"),
    metacognition: metacognitionOf(state),
    citizen: citizen
      ? {
        measurementStatus: "observed",
        actorId: citizen.actorId || null,
        mode: citizen.mode || null,
        cortexState: citizen.cortexState || null,
        observedAt: citizen.observedAt || null,
        activeTask: citizen.activeTask ? { id: citizen.activeTask.id, name: citizen.activeTask.name } : null,
        consciousState: citizen.consciousState || null,
        voice: citizen.voice?.text || null,
        hotClusters: citizen.physics?.hotClusters || []
      }
      : unknown("le workspace vivant du citoyen n'a pas pu être lu"),
    subentities,
    events: [...(state.events || [])].slice(-12).reverse()
  };
}
