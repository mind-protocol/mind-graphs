import { createHash } from "node:crypto";
import { getGraphByName } from "./db.js";
import { loadManifest } from "./graph-manifest.js";

const asTime = (value, field) => {
  if (value === null || value === undefined || value === "") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${field} must be an ISO date-time.`);
  return time;
};

const parseJson = (value, fallback) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return structuredClone(value);
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export function normalizeL1Task(task = {}) {
  return {
    ...structuredClone(task),
    wakeManagement: parseJson(task.wakeManagement ?? task.wakeManagementJson, {}),
    targetDiscovery: parseJson(task.targetDiscovery ?? task.targetDiscoveryJson, {}),
    deliveryPlan: parseJson(task.deliveryPlan ?? task.deliveryPlanJson, []),
    blocker: parseJson(task.blocker ?? task.blockerJson, null)
  };
}

const isActive = task => task.nodeType === "objective" && task.status === "active";
const isReadyAt = (task, nowMs) => {
  if (!isActive(task) || task.wakeStatus === "blocked") return false;
  const nextWakeMs = asTime(task.nextWakeAt, "nextWakeAt");
  return nextWakeMs === null || nextWakeMs <= nowMs;
};

const deadlineMs = task => asTime(task.dueAt, "dueAt") ?? Number.POSITIVE_INFINITY;

export function selectNextL1TaskWake(tasks, { now = new Date().toISOString() } = {}) {
  const nowMs = asTime(now, "now");
  const active = tasks.map(normalizeL1Task).filter(isActive);
  const ready = active.filter(task => isReadyAt(task, nowMs))
    .sort((left, right) => deadlineMs(left) - deadlineMs(right)
      || String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
      || left.id.localeCompare(right.id, "fr"));
  const scheduled = active
    .filter(task => !ready.some(candidate => candidate.id === task.id) && task.wakeStatus !== "blocked")
    .map(task => task.nextWakeAt)
    .filter(Boolean)
    .sort();
  const blocked = active.filter(task => task.wakeStatus === "blocked");
  const task = ready[0] || null;
  return {
    generatedAt: new Date(nowMs).toISOString(),
    task: task ? {
      ...task,
      timing: {
        dueAt: task.dueAt || null,
        overdue: deadlineMs(task) < nowMs,
        millisecondsRemaining: Number.isFinite(deadlineMs(task)) ? deadlineMs(task) - nowMs : null
      }
    } : null,
    activeCount: active.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    blockedTaskIds: blocked.map(item => item.id),
    nextScheduledAt: scheduled[0] || null
  };
}

export async function readActiveL1Tasks(graph) {
  try {
    const result = await graph.roQuery(`
      MATCH (task:L1Node)
      WHERE task.nodeType = 'objective' AND task.status = 'active'
      RETURN properties(task) AS task
    `);
    return (result.data || []).map(row => normalizeL1Task(row.task || row));
  } catch (error) {
    if (/empty key/i.test(error.message)) return [];
    throw error;
  }
}

export async function resolveConfiguredL1Graph({
  graphId = null,
  manifest = null,
  selectGraphByName = getGraphByName
} = {}) {
  const resolvedManifest = manifest || await loadManifest();
  const configured = resolvedManifest.graphs.filter(graph => graph.status === "active" && graph.blueprintSync?.enabled);
  const target = graphId
    ? configured.find(graph => graph.id === graphId)
    : configured.length === 1 ? configured[0] : null;
  if (!target) {
    if (graphId) throw new Error(`No active L1 task runtime configured for ${graphId}.`);
    throw new Error(`L1 graphId is required when ${configured.length} active L1 runtimes are configured.`);
  }
  return { config: target, graph: await selectGraphByName(target.falkorGraph) };
}

export async function getNextL1TaskWake(options = {}) {
  const { config, graph } = await resolveConfiguredL1Graph(options);
  const tasks = await readActiveL1Tasks(graph);
  return { graphId: config.id, falkorGraph: config.falkorGraph, ...selectNextL1TaskWake(tasks, { now: options.now }) };
}

function ensureNonEmpty(values, field) {
  if (!Array.isArray(values) || !values.length || values.some(value => !String(value || "").trim())) {
    throw new Error(`${field} must contain at least one non-empty item.`);
  }
  return values.map(value => String(value).trim());
}

function notificationFor(task, report) {
  const lines = [
    `🚧 Citizen AI bloqué · ${task.name || task.id}`,
    `Échéance : ${task.dueAt || "non déclarée"}`,
    `Cause : ${report.blockerCause}`,
    `Déjà tenté : ${report.attemptedActions.join(" ; ")}`,
    `Options restantes : ${report.remainingOptions.join(" ; ")}`,
    `Attendu de Nicolas : ${report.needsFromCitizen}`
  ];
  return {
    required: true,
    platform: "telegram",
    recipient: "Nicolas (NLR)",
    message: lines.join("\n")
  };
}

export function validateL1TaskReport(input, task, { now = new Date().toISOString() } = {}) {
  if (!["progressed", "completed", "blocked"].includes(input.outcome)) {
    throw new Error("outcome must be progressed, completed or blocked.");
  }
  const reportedAt = input.reportedAt || now;
  const reportedAtMs = asTime(reportedAt, "reportedAt");
  const summary = String(input.summary || "").trim();
  if (!summary) throw new Error("summary is required.");
  const report = { ...input, summary, reportedAt: new Date(reportedAtMs).toISOString() };
  if (input.outcome === "progressed") {
    const nextWakeMs = asTime(input.nextWakeAt, "nextWakeAt");
    if (nextWakeMs === null || nextWakeMs <= reportedAtMs) throw new Error("A progressed task requires nextWakeAt after reportedAt.");
    const dueMs = asTime(task.dueAt, "dueAt");
    if (dueMs !== null && nextWakeMs > dueMs) throw new Error("nextWakeAt cannot be after the task deadline.");
    report.nextWakeAt = new Date(nextWakeMs).toISOString();
  }
  if (input.outcome === "blocked") {
    report.blockerCause = String(input.blockerCause || "").trim();
    report.needsFromCitizen = String(input.needsFromCitizen || "").trim();
    if (!report.blockerCause || !report.needsFromCitizen) {
      throw new Error("A blocked task requires blockerCause and needsFromCitizen.");
    }
    report.attemptedActions = ensureNonEmpty(input.attemptedActions, "attemptedActions");
    report.remainingOptions = ensureNonEmpty(input.remainingOptions, "remainingOptions");
  }
  return report;
}

const slug = value => String(value || "task").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export async function reportL1TaskWake({
  graphId = null,
  objectiveId,
  outcome,
  summary,
  reportedAt,
  nextWakeAt,
  blockerCause,
  attemptedActions,
  remainingOptions,
  needsFromCitizen,
  evidence = [],
  manifest = null,
  selectGraphByName = getGraphByName,
  now = new Date().toISOString()
} = {}) {
  if (!objectiveId) throw new Error("objectiveId is required.");
  const { config, graph } = await resolveConfiguredL1Graph({ graphId, manifest, selectGraphByName });
  const result = await graph.roQuery(`
    MATCH (task:L1Node {id:$objectiveId})
    WHERE task.nodeType = 'objective'
    RETURN properties(task) AS task
  `, { params: { objectiveId } });
  const rawTask = result.data?.[0]?.task;
  if (!rawTask) throw new Error(`Unknown L1 objective ${objectiveId}.`);
  const task = normalizeL1Task(rawTask);
  const report = validateL1TaskReport({
    outcome, summary, reportedAt, nextWakeAt, blockerCause,
    attemptedActions, remainingOptions, needsFromCitizen, evidence
  }, task, { now });
  const digest = createHash("sha256")
    .update(JSON.stringify([objectiveId, report.reportedAt, report.outcome, report.summary]))
    .digest("hex")
    .slice(0, 12);
  const observationId = `observation-${slug(objectiveId)}-${digest}`;
  const taskStatus = report.outcome === "completed" ? "completed" : "active";
  const wakeStatus = report.outcome === "blocked" ? "blocked" : report.outcome === "completed" ? "completed" : "scheduled";
  const notification = report.outcome === "blocked" ? notificationFor(task, report) : null;
  const observation = {
    id: observationId,
    name: `Réveil · ${task.name || objectiveId}`,
    nodeType: "observation",
    family: "Volition · journal de réveil",
    phrase: report.summary,
    summary: report.summary,
    updateType: `task_wake_${report.outcome}`,
    statusAfter: taskStatus,
    contextId: objectiveId,
    observedAt: report.reportedAt,
    evidence: Array.isArray(evidence) ? evidence.map(String) : [],
    blockerCause: report.blockerCause || null,
    attemptedActions: report.attemptedActions || [],
    remainingOptions: report.remainingOptions || [],
    needsFromCitizen: report.needsFromCitizen || null,
    epistemicStatus: "observed",
    layer: "citizen_state"
  };
  const blockerJson = report.outcome === "blocked" ? JSON.stringify({
    cause: report.blockerCause,
    attemptedActions: report.attemptedActions,
    remainingOptions: report.remainingOptions,
    needsFromCitizen: report.needsFromCitizen,
    reportedAt: report.reportedAt
  }) : null;
  await graph.query(`
    MATCH (task:L1Node {id:$objectiveId})
    MERGE (observation:L1Node {id:$observationId})
    SET observation = $observation
    MERGE (observation)-[relation:REL {id:$relationId}]->(task)
    SET relation.type = 'DESCRIBES',
        relation.justification = 'Cette observation append-only consigne le résultat réel d un réveil de tâche L1.',
        relation.layer = 'citizen_state'
    SET task.status = $taskStatus,
        task.wakeStatus = $wakeStatus,
        task.lastWakeAt = $reportedAt,
        task.lastWakeOutcome = $outcome,
        task.lastWakeObservationId = $observationId,
        task.nextWakeAt = $nextWakeAt,
        task.blockerJson = $blockerJson,
        task.wakeCount = coalesce(task.wakeCount, 0) + 1
    RETURN task.id AS objectiveId
  `, { params: {
    objectiveId,
    observationId,
    relationId: `relation-${observationId}-describes-${slug(objectiveId)}`,
    observation,
    taskStatus,
    wakeStatus,
    reportedAt: report.reportedAt,
    outcome: report.outcome,
    nextWakeAt: report.nextWakeAt || null,
    blockerJson
  } });
  return {
    graphId: config.id,
    objectiveId,
    outcome: report.outcome,
    observationId,
    taskStatus,
    wakeStatus,
    nextWakeAt: report.nextWakeAt || null,
    notification
  };
}

export function formatNextL1TaskWake(result) {
  if (!result.task) {
    return `Aucune tâche L1 prête · ${result.activeCount} active(s), ${result.blockedCount} bloquée(s)`
      + (result.nextScheduledAt ? ` · prochain réveil ${result.nextScheduledAt}` : "");
  }
  return `${result.task.name || result.task.id} · échéance ${result.task.dueAt || "non déclarée"}`
    + (result.task.timing.overdue ? " · EN RETARD" : "")
    + ` · ${result.readyCount}/${result.activeCount} prête(s)`;
}

export function formatL1TaskReport(result) {
  const base = `${result.objectiveId} · réveil ${result.outcome} · observation ${result.observationId}`;
  return result.notification ? `${base}\nNotification Telegram obligatoire :\n${result.notification.message}` : base;
}
