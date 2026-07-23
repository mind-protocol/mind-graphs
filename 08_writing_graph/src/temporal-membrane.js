import { createHash } from "node:crypto";
import { injectAtNode } from "./l4-physics.js";

const REPEATS = new Set(["once", "hourly", "daily", "weekly"]);
const PROSPECTIVE_MARKERS = [
  /\b(plus tard|demain|ce soir|la semaine prochaine|à \d{1,2}[h:]\d{0,2})\b/iu,
  /\b(later|tomorrow|tonight|next week|at \d{1,2}(?::\d{2})?)\b/iu,
  /\b(reprendre|continuer|rappelle|réveill|resume|continue|remind|wake)\b/iu
];
const VAGUE_PROMPTS = new Set(["continue", "reprendre", "rappelle-moi", "wake me", "resume"]);

const uniqueStrings = values => [...new Set(
  (values || []).map(value => String(value || "").trim()).filter(Boolean)
)];

const normalize = value => String(value || "").trim().replace(/\s+/gu, " ").toLocaleLowerCase("fr");

const stableId = value => createHash("sha256").update(value).digest("hex").slice(0, 20);

export function resolveWakeTime(time, now = new Date()) {
  const source = String(time || "").trim();
  const clock = source.match(/^(\d{1,2}):(\d{2})$/u);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours > 23 || minutes > 59) throw new Error("wake time must be a valid local HH:MM");
    const due = new Date(now);
    due.setHours(hours, minutes, 0, 0);
    if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
    return due.toISOString();
  }
  const due = new Date(source);
  if (!source || Number.isNaN(due.getTime())) {
    throw new Error("wake time must be a local HH:MM or a complete date");
  }
  if (due.getTime() <= now.getTime()) throw new Error("a complete wake date must be in the future");
  return due.toISOString();
}

export function detectProspectiveWakeIntent({
  text,
  time,
  prompt,
  actorId = "actor-nlr",
  handle,
  place,
  repeat = "once",
  recurrenceExplicit = false,
  goalIds = [],
  sourceNodeIds = [],
  activeNodeIds = []
} = {}) {
  const utterance = String(text || prompt || "").trim();
  const signals = [];
  if (PROSPECTIVE_MARKERS.some(pattern => pattern.test(utterance))) signals.push("prospective_language");
  if (String(time || "").trim()) signals.push("explicit_time");
  if (repeat !== "once") signals.push("recurrence");
  if (!signals.length) return null;
  return {
    actorId,
    handle: handle || null,
    time: String(time || "").trim() || null,
    prompt: String(prompt || text || "").trim(),
    place: String(place || "").trim() || null,
    repeat,
    recurrenceExplicit: Boolean(recurrenceExplicit),
    goalIds: uniqueStrings(goalIds),
    sourceNodeIds: uniqueStrings(sourceNodeIds),
    activeNodeIds: uniqueStrings(activeNodeIds),
    l1: {
      signals,
      confidence: Number(Math.min(1, 0.45 + signals.length * 0.25).toFixed(2)),
      recommendation: "submit_to_l2_gate"
    }
  };
}

function proposalKey(proposal, dueAt) {
  return [
    proposal.actorId,
    dueAt,
    proposal.repeat,
    normalize(proposal.prompt),
    normalize(proposal.place)
  ].join("|");
}

export function evaluateWakeProposal(proposal, {
  existingCommitments = [],
  activeGoalIds,
  now = new Date()
} = {}) {
  const reasons = [];
  if (!proposal || typeof proposal !== "object") {
    return { eligible: false, reasons: ["missing_proposal"], l2: { decision: "reject" } };
  }
  if (!String(proposal.actorId || "").trim()) reasons.push("missing_actor");
  const prompt = String(proposal.prompt || "").trim();
  if (prompt.length < 8 || VAGUE_PROMPTS.has(normalize(prompt))) reasons.push("prompt_not_actionable");
  if (!REPEATS.has(proposal.repeat || "once")) reasons.push("invalid_repeat");
  if ((proposal.repeat || "once") !== "once" && !proposal.recurrenceExplicit) {
    reasons.push("recurrence_requires_explicit_intent");
  }
  const continuityIds = uniqueStrings([
    ...(proposal.goalIds || []),
    ...(proposal.sourceNodeIds || []),
    ...(proposal.activeNodeIds || [])
  ]);
  if (!continuityIds.length) reasons.push("missing_graph_context");
  if (Array.isArray(activeGoalIds)) {
    const active = new Set(activeGoalIds);
    if ((proposal.goalIds || []).some(goalId => !active.has(goalId))) reasons.push("inactive_goal");
  }

  let dueAt = null;
  try {
    dueAt = resolveWakeTime(proposal.time, now);
  } catch (error) {
    reasons.push(error.message);
  }
  const key = dueAt ? proposalKey(proposal, dueAt) : null;
  if (key && existingCommitments.some(commitment => (
    commitment.status !== "cancelled"
    && (commitment.dedupeKey === key || commitment.idempotencyKey === key)
  ))) reasons.push("duplicate_commitment");

  if (reasons.length) return {
    eligible: false,
    reasons: [...new Set(reasons)],
    dueAt,
    dedupeKey: key,
    l2: { decision: "reject", sovereigntyPreserved: true }
  };

  const id = `temporal-commitment-${stableId(key)}`;
  const scheduleCall = {
    time: dueAt,
    prompt,
    ...(proposal.place ? { place: proposal.place } : {}),
    ...(proposal.handle ? { handle: proposal.handle } : {}),
    repeat: proposal.repeat || "once"
  };
  return {
    ...proposal,
    id,
    eligible: true,
    reasons: [],
    dueAt,
    dedupeKey: key,
    idempotencyKey: key,
    status: "dormant",
    scheduleCall,
    continuityTargetIds: continuityIds,
    l2: {
      decision: "approve",
      sovereigntyPreserved: true,
      checks: ["actor", "time", "actionable_prompt", "graph_context", "dedupe", "recurrence_consent"]
    }
  };
}

export function buildTemporalCommitmentCluster(approved) {
  if (!approved?.eligible) throw new Error("an approved wake proposal is required");
  const momentId = `moment-${approved.id}`;
  const targetIds = uniqueStrings([
    ...(approved.goalIds || []),
    ...(approved.sourceNodeIds || []),
    ...(approved.activeNodeIds || [])
  ]);
  const links = [
    {
      source: momentId,
      target: approved.actorId,
      type: "AUTHORED_BY",
      justification: "L’engagement futur est attribué à l’Actor qui a exprimé l’intention ; cette attribution ne délègue aucune autorité supplémentaire."
    },
    {
      source: momentId,
      target: "thing-schedule-wake",
      type: "USES_METHOD",
      justification: "Le Moment futur utilise schedule_wake comme transport temporel ; la méthode transporte l’engagement mais ne décide pas de son admissibilité."
    },
    ...targetIds.map(target => ({
      source: momentId,
      target,
      type: "TARGETS",
      justification: "La cible capturée permet au réveil de restaurer le contexte actif sans transformer cette proximité en autorisation d’action."
    }))
  ];
  if (approved.place) links.push({
    source: momentId,
    target: approved.place,
    type: "APPLIES_IN",
    justification: "Le Space optionnel borne le contexte dans lequel l’intention doit être restaurée au réveil."
  });
  return {
    nodes: [{
      id: momentId,
      name: `Engagement temporel · ${approved.prompt}`,
      nodeType: "moment",
      semanticType: "task",
      phrase: approved.prompt,
      summary: `Engagement dormant jusqu’au ${approved.dueAt}.`,
      epistemicStatus: "documented",
      clusterId: approved.id,
      workStatus: "scheduled",
      scheduledFor: approved.dueAt,
      repeat: approved.repeat,
      status: "dormant",
      dedupeKey: approved.dedupeKey
    }],
    links
  };
}

function nextRecurringDue(dueAt, repeat, now) {
  if (repeat === "once") return null;
  const next = new Date(dueAt);
  const advance = () => {
    if (repeat === "hourly") next.setHours(next.getHours() + 1);
    if (repeat === "daily") next.setDate(next.getDate() + 1);
    if (repeat === "weekly") next.setDate(next.getDate() + 7);
  };
  do advance(); while (next.getTime() <= now.getTime());
  return next.toISOString();
}

export function deliverTemporalWake({
  commitment,
  state,
  index,
  now = new Date(),
  amount = 1,
  maxReservoir = 3
}) {
  if (!commitment?.eligible) throw new Error("an approved wake commitment is required");
  if (!state || !index) throw new Error("L4 state and index are required");
  const due = new Date(commitment.dueAt);
  if (now.getTime() < due.getTime()) {
    return { status: "dormant", injected: 0, dueAt: commitment.dueAt, targets: [] };
  }
  if (!(state.temporalWakeLedger instanceof Set)) state.temporalWakeLedger = new Set();
  const occurrenceId = `${commitment.id}|${commitment.dueAt}`;
  if (state.temporalWakeLedger.has(occurrenceId)) {
    return { status: "already_delivered", injected: 0, dueAt: commitment.dueAt, targets: [] };
  }

  const targets = uniqueStrings([
    commitment.actorId,
    commitment.place,
    ...(commitment.goalIds || []),
    ...(commitment.sourceNodeIds || []),
    ...(commitment.activeNodeIds || [])
  ]).filter(nodeId => (index.outOf.get(nodeId) || []).length + (index.inTo.get(nodeId) || []).length > 0);
  if (!targets.length) {
    return { status: "no_reachable_target", injected: 0, dueAt: commitment.dueAt, targets: [] };
  }

  const before = Number(state.injected || 0);
  const share = amount / targets.length;
  for (const nodeId of targets) {
    injectAtNode(state, index, nodeId, share, {
      flowId: `temporal-wake|${occurrenceId}|${nodeId}`,
      citizenId: commitment.actorId,
      originThingId: "thing-schedule-wake",
      flowKind: "temporal_wake",
      trigger: "scheduled_wake_due",
      budgetSource: "temporal_commitment",
      goalIds: commitment.goalIds || [],
      injectedAt: now.toISOString(),
      remainingBudget: share,
      maxReservoir: Math.min(share, maxReservoir / targets.length)
    });
  }
  const injected = Number((Number(state.injected || 0) - before).toFixed(9));
  if (injected > 0) state.temporalWakeLedger.add(occurrenceId);
  return {
    status: injected > 0 ? "delivered" : "saturated",
    injected,
    dueAt: commitment.dueAt,
    targets,
    nextDueAt: nextRecurringDue(commitment.dueAt, commitment.repeat || "once", now)
  };
}
