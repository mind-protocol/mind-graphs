import { spawn } from "node:child_process";
import { checkVerificationCommand } from "./verification-command.js";
import { semanticTypeOf } from "../public/node-semantics.js";

const idOf = value => typeof value === "object" ? value.id : value;

export function buildHealthProofMatrix(nodes) {
  const contracts = nodes.filter(node => Array.isArray(node.healthProofSemanticTypes));
  const bySemanticType = new Map();
  const conflicts = [];
  for (const contract of contracts) {
    for (const semanticType of contract.healthProofSemanticTypes) {
      if (bySemanticType.has(semanticType)) conflicts.push({ semanticType, contracts: [bySemanticType.get(semanticType).id, contract.id] });
      else bySemanticType.set(semanticType, contract);
    }
  }
  return { contracts, bySemanticType, conflicts };
}

function proofContractOf(node, matrix) {
  return matrix.bySemanticType.get(semanticTypeOf(node));
}

export function isContinuousSafeCommand(command) {
  if (typeof command !== "string") return false;
  return command.split(" && ").every(segment => segment === "npm test"
    || segment === "npm run validate"
    || segment === "npm run health:assert-runtime"
    || segment.startsWith("node --test "));
}

export function discoverContinuousProbes(nodes, links = []) {
  const matrix = buildHealthProofMatrix(nodes);
  if (matrix.conflicts.length) throw new Error(`Contrats de preuve en conflit : ${matrix.conflicts.map(item => item.semanticType).join(", ")}`);
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const implementedTargets = new Map();
  const observableTypes = new Set(["system_state", "observation", "dataset", "metric", "estimate"]);
  const directlyTestableTypes = new Set([...observableTypes, "protocol", "mechanism", "economic_mechanism", "experiment", "method", "subentity_action", "subentity_state_machine"]);
  const testedObservableTargets = new Map();
  const observedTargets = new Map();
  for (const link of links) {
    const source = idOf(link.source);
    const target = idOf(link.target);
    if (link.type === "IMPLEMENTS") {
      if (!implementedTargets.has(source)) implementedTargets.set(source, []);
      implementedTargets.get(source).push(target);
    }
    if (link.type === "TESTS" && directlyTestableTypes.has(semanticTypeOf(nodeById.get(target) || {}))) {
      if (!testedObservableTargets.has(source)) testedObservableTargets.set(source, []);
      testedObservableTargets.get(source).push(target);
    }
    if (["OBSERVES", "MEASURES"].includes(link.type) && observableTypes.has(semanticTypeOf(nodeById.get(target) || {}))) {
      if (!observedTargets.has(source)) observedTargets.set(source, []);
      observedTargets.get(source).push(target);
    }
  }
  const groups = new Map();
  for (const node of nodes) {
    const semanticType = semanticTypeOf(node);
    const contract = proofContractOf(node, matrix);
    const verificationCommand = node.verificationCommand
      || (contract?.healthProofKind === "observable" ? node.observationCommand : "");
    if (!verificationCommand) continue;
    const explicitTargets = node.probeTargetIds?.length ? node.probeTargetIds : null;
    const deliveredWork = semanticType === "task" && node.workStatus === "done"
      || semanticType === "change" && node.workStatus === "delivered";
    if (!explicitTargets && contract?.healthProofAutomation !== "declared_command" && !deliveredWork) continue;
    if (!isContinuousSafeCommand(verificationCommand)) continue;
    // Une relation IMPLEMENTS attribue explicitement la portée de la preuve :
    // si l'artefact exécutable passe son test, les mécanismes qu'il matérialise
    // reçoivent le même verdict. TESTS n'est pas propagé automatiquement, car il
    // peut ne vérifier qu'une condition nécessaire d'une hypothèse plus large.
    const targets = explicitTargets
      ? [node.id, ...explicitTargets]
      : [node.id, ...(implementedTargets.get(node.id) || []), ...(testedObservableTargets.get(node.id) || []), ...(observedTargets.get(node.id) || [])];
    const dimension = contract?.healthProofDimension || "functional";
    const groupKey = `${dimension}::${verificationCommand}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        ...node,
        id: `continuous-${node.id}`,
        verificationCommand,
        probeTargetIds: [],
        probeDimension: dimension,
        probeIntervalSeconds: Number(node.probeIntervalSeconds || 300),
        probeFreshnessSeconds: Number(node.probeFreshnessSeconds || 420)
      });
    }
    const probe = groups.get(groupKey);
    // Un identifiant de sonde explicitement écrit dans le graphe reste stable :
    // il écrase ainsi son propre statut précédent au lieu de laisser une ancienne
    // panne fraîche coexister sous un identifiant devenu orphelin.
    if (explicitTargets) probe.id = node.id;
    probe.probeTargetIds.push(...targets);
    probe.probeTargetIds = [...new Set(probe.probeTargetIds)];
    probe.probeIntervalSeconds = Math.min(probe.probeIntervalSeconds, Number(node.probeIntervalSeconds || 300));
    probe.probeFreshnessSeconds = Math.max(probe.probeFreshnessSeconds, Number(node.probeFreshnessSeconds || 420));
  }
  for (const contract of matrix.contracts.filter(item => item.healthProofAutomation === "corpus_validation")) {
    const targets = nodes.filter(node => contract.healthProofSemanticTypes.includes(semanticTypeOf(node))).map(node => node.id);
    targets.push(contract.id);
    groups.set(`contract::${contract.id}`, {
      ...contract,
      id: contract.id,
      verificationCommand: contract.healthDefaultVerificationCommand || "npm run validate",
      probeTargetIds: [...new Set(targets)],
      probeDimension: contract.healthProofDimension,
      probeIntervalSeconds: Number(contract.probeIntervalSeconds || 60),
      probeFreshnessSeconds: Number(contract.probeFreshnessSeconds || 180)
    });
  }
  return [...groups.values()];
}

export function structuralStatuses(nodes, links, { now = new Date(), freshnessSeconds = 180 } = {}) {
  const matrix = buildHealthProofMatrix(nodes);
  const degree = new Map(nodes.map(node => [node.id, 0]));
  for (const link of links) {
    degree.set(idOf(link.source), (degree.get(idOf(link.source)) || 0) + 1);
    degree.set(idOf(link.target), (degree.get(idOf(link.target)) || 0) + 1);
  }
  const checkedAt = now.toISOString();
  const freshUntil = new Date(now.getTime() + freshnessSeconds * 1000).toISOString();
  return nodes.map(node => {
    const contract = proofContractOf(node, matrix);
    const missing = ["id", "name", "nodeType", "semanticType", "phrase", "summary"].filter(field => !node[field]);
    // Une entrée de vocabulaire est un atome documentaire valide : elle peut définir
    // un mot sans prétendre participer à une chaîne causale. Les autres objets du
    // graphe doivent être reliés pour être actionnables ou interprétables.
    if (semanticTypeOf(node) !== "terme" && !(degree.get(node.id) > 0)) missing.push("relation");
    return {
      id: `${node.id}::builtin-structural-contract`, targetId: node.id,
      targetSemanticType: semanticTypeOf(node), probeId: "builtin-structural-contract",
      targetProofKind: contract?.healthProofKind || "unclassified",
      expectedDimension: contract?.healthProofDimension || "functional",
      dimension: "structure", state: missing.length ? "failing" : "partial",
      value: missing.length ? 0 : 1, checkedAt, freshUntil,
      message: missing.length ? `Champs ou relation manquants : ${missing.join(", ")}`
        : `Contrat structurel valide ; preuve ${contract?.healthProofKind || "fonctionnelle"} non conclue.`
    };
  });
}

function commandInvocation(segment) {
  const words = segment.split(" ");
  const npmCli = process.env.npm_execpath;
  if (segment === "npm test") {
    if (!npmCli) throw new Error("npm_execpath absent : lancer le runner par npm run health:check");
    return { file: process.execPath, args: [npmCli, "test"] };
  }
  if (words[0] === "npm" && words[1] === "run") {
    if (!npmCli) throw new Error("npm_execpath absent : lancer le runner par npm run health:check");
    return { file: process.execPath, args: [npmCli, ...words.slice(1)] };
  }
  if (words[0] === "node" && words[1] === "--test") return { file: process.execPath, args: words.slice(1) };
  throw new Error(`Commande non admise : ${segment}`);
}

function spawnSegment(segment, { cwd, timeoutMs }) {
  const invocation = commandInvocation(segment);
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(invocation.file, invocation.args, { cwd, shell: false, windowsHide: true });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { stderr += error.message; });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, exitCode: code ?? -1, timedOut, durationMs: Date.now() - started, stdout, stderr });
    });
  });
}

export async function executeProbe(probe, { declaredScripts, cwd, now = new Date(), timeoutMs = 120000, executeSegment = spawnSegment } = {}) {
  const reasons = checkVerificationCommand(probe.verificationCommand, declaredScripts);
  if (reasons.length) throw new Error(`${probe.id}: ${reasons.join("; ")}`);
  const started = Date.now();
  let result = { ok: true, exitCode: 0, timedOut: false, durationMs: 0, stdout: "", stderr: "" };
  for (const segment of probe.verificationCommand.split(" && ")) {
    result = await executeSegment(segment, { cwd, timeoutMs });
    if (!result.ok) break;
  }
  const checkedAt = now.toISOString();
  const freshUntil = new Date(now.getTime() + Number(probe.probeFreshnessSeconds || 180) * 1000).toISOString();
  return (probe.probeTargetIds || []).map(targetId => ({
    id: `${targetId}::${probe.id}`, targetId, probeId: probe.id, dimension: probe.probeDimension || "functional",
    state: result.ok ? "passing" : "failing", value: result.ok ? 1 : 0,
    checkedAt, freshUntil, durationMs: Date.now() - started,
    message: result.ok ? `Commande réussie : ${probe.verificationCommand}` : `Échec ${result.exitCode}${result.timedOut ? " · timeout" : ""}`,
    outputTail: `${result.stdout}\n${result.stderr}`.trim().slice(-2000)
  }));
}

export async function writeHealthRuntime(graph, statuses, {
  runId,
  checkedAt,
  activeTargetIds = null,
  activeProbeIds = null
}) {
  await graph.query("CREATE INDEX FOR (s:HealthStatus) ON (s.id)").catch(() => {});
  await graph.query("CREATE INDEX FOR (r:VerificationRun) ON (r.id)").catch(() => {});
  if (Array.isArray(activeTargetIds) && Array.isArray(activeProbeIds)) {
    await graph.query(
      "MATCH (s:HealthStatus) WHERE NOT s.targetId IN $targetIds OR NOT s.probeId IN $probeIds DELETE s",
      { params: {
        targetIds: [...new Set(activeTargetIds)],
        probeIds: [...new Set(activeProbeIds)]
      } }
    );
  }
  for (const status of statuses) {
    await graph.query(`MERGE (s:HealthStatus {id:$id}) SET s = $props`, { params: { id: status.id, props: status } });
  }
  await graph.query("CREATE (:VerificationRun {id:$id, checkedAt:$checkedAt, statusCount:$statusCount})", { params: { id: runId, checkedAt, statusCount: statuses.length } });
  const cutoff = new Date(new Date(checkedAt).getTime() - 24 * 60 * 60 * 1000).toISOString();
  await graph.query("MATCH (r:VerificationRun) WHERE r.checkedAt < $cutoff DELETE r", { params: { cutoff } }).catch(() => {});
}

export function aggregateHealthStatuses(statuses, now = new Date()) {
  const grouped = new Map();
  for (const status of statuses) {
    if (!grouped.has(status.targetId)) grouped.set(status.targetId, []);
    grouped.get(status.targetId).push(status);
  }
  return [...grouped.entries()].map(([targetId, checks]) => {
    const fresh = checks.filter(item => new Date(item.freshUntil).getTime() > now.getTime());
    const evidence = fresh.filter(item => item.dimension !== "structure");
    const failure = fresh.find(item => item.state === "failing");
    const evidenceSuccess = [...evidence].sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)))[0];
    const state = failure ? "failing"
      : evidence.length && evidence.every(item => item.state === "passing") ? "passing"
      : fresh.length ? "partial" : "stale";
    const latest = [...checks].sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)))[0];
    const representative = failure || evidenceSuccess || latest;
    return { targetId, state, checkedAt: representative?.checkedAt, freshUntil: representative?.freshUntil, checks: checks.length, message: representative?.message || "" };
  });
}

export function runtimeHealthInvariants(statuses, now = new Date()) {
  const targets = new Map();
  for (const status of statuses) {
    if (!targets.has(status.targetId)) targets.set(status.targetId, []);
    targets.get(status.targetId).push(status);
  }
  const freshTargets = [...targets.values()].filter(checks => checks.some(item => new Date(item.freshUntil).getTime() > now.getTime())).length;
  const aggregated = aggregateHealthStatuses(statuses, now);
  const falseGreenTargetIds = aggregated.filter(item => item.state === "passing").filter(item => {
    const checks = targets.get(item.targetId) || [];
    return !checks.some(check => check.dimension !== "structure"
      && check.state === "passing"
      && new Date(check.freshUntil).getTime() > now.getTime());
  }).map(item => item.targetId);
  const targetCount = targets.size;
  const freshnessRate = targetCount ? freshTargets / targetCount : 0;
  return {
    ok: targetCount > 0 && freshnessRate === 1 && falseGreenTargetIds.length === 0,
    targetCount,
    freshTargets,
    freshnessRate,
    falseGreenTargetIds
  };
}

export const HEALTH_THING_ENERGY_POLICY = Object.freeze({
  amount: 1,
  maxReservoir: 3,
  cooldownSeconds: 300,
  flowKind: "health_gap",
  trigger: "health_transition_to_partial",
  budgetSource: "continuous_verification"
});

export function healthThingEnergyEvents(aggregated, previousLedger = {}, now = new Date(), policy = HEALTH_THING_ENERGY_POLICY) {
  const nowMs = now.getTime();
  const nextLedger = {};
  const events = [];
  for (const status of aggregated) {
    const previous = previousLedger[status.targetId] || {};
    const lastInjectedMs = Date.parse(previous.lastInjectedAt || "");
    const transitioned = status.state === "partial" && previous.state !== "partial";
    const cooldownElapsed = status.state === "partial"
      && (!Number.isFinite(lastInjectedMs) || nowMs - lastInjectedMs >= Number(policy.cooldownSeconds) * 1000);
    const inject = transitioned || cooldownElapsed;
    const lastInjectedAt = inject ? now.toISOString() : (previous.lastInjectedAt || null);
    nextLedger[status.targetId] = { state: status.state, lastInjectedAt };
    if (!inject) continue;
    events.push({
      type: "THING_ENERGY_INJECTION",
      nodeIds: [status.targetId],
      amount: Number(policy.amount),
      maxReservoir: Number(policy.maxReservoir),
      flowId: `thing-event|${policy.flowKind}|${status.targetId}`,
      citizenId: null,
      originThingId: status.targetId,
      flowKind: policy.flowKind,
      trigger: policy.trigger,
      budgetSource: policy.budgetSource,
      injectedAt: now.toISOString()
    });
  }
  return { events, ledger: nextLedger };
}

export function healthTasksForPartial(aggregated, nodes, now = new Date()) {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const matrix = buildHealthProofMatrix(nodes);
  const priorities = { executable: 90, observable: 85, lifecycle: 60, documentary: 40, unclassified: 35 };
  return aggregated.filter(item => item.state === "partial" && nodeById.has(item.targetId)).map(item => {
    const target = nodeById.get(item.targetId);
    const contract = proofContractOf(target, matrix);
    const proofKind = contract?.healthProofKind || "unclassified";
    const dimension = contract?.healthProofDimension || "functional";
    return {
      id: `task-health-proof-${item.targetId}`,
      nodeType: "narrative", semanticType: "task",
      epistemicStatus: "documented", workStatus: "proposed",
      autonomyMode: "review_required",
      name: `Tâche auto · Apporter la preuve ${proofKind} de ${target.name}`,
      phrase: `Définir et brancher une preuve ${proofKind} de dimension ${dimension} pour ${target.name}.`,
      family: `Vérification continue · preuve ${proofKind} manquante`,
      summary: `Le contrat structurel de ${target.name} passe, mais le contrat ${contract?.name || proofKind} ne possède aucune preuve fraîche concluante.`,
      priority: priorities[proofKind] || priorities.unclassified,
      healthProofKind: proofKind,
      healthProofDimension: dimension,
      healthProofContractId: contract?.id || "",
      acceptanceCriteria: [
        `Une preuve ${proofKind} autorisée cible explicitement ce nœud.`,
        "Le résultat écrit passing ou failing avec checkedAt et freshUntil.",
        "Le voyant ne déduit jamais la vérité du contenu depuis le succès technique."
      ],
      verificationCommand: "npm run health:check",
      updatedAt: now.toISOString().slice(0, 10), clusterId: "continuous-verification-tasks",
      runtimeManaged: true, runtimeKind: "health_task", targetId: item.targetId
    };
  });
}

export async function syncHealthTasks(graph, tasks) {
  const targetIds = tasks.map(task => task.targetId);
  await graph.query("MATCH (t:MindNode) WHERE t.runtimeManaged = true AND t.runtimeKind = 'health_task' AND NOT t.targetId IN $targetIds DETACH DELETE t", { params: { targetIds } });
  if (!tasks.length) return;
  await graph.query(`UNWIND $tasks AS task
    MATCH (target:MindNode {id:task.targetId})
    MERGE (t:MindNode {id:task.id}) SET t = task
    MERGE (t)-[r:TARGETS]->(target)
    SET r.justification = 'La tâche automatique cible le nœud dont le contrat structurel passe mais dont le fonctionnement reste non prouvé.',
        r.relationFamily = 'workflow', r.relationScope = 'project_work',
        r.canonicalPredicate = 'TARGETS', r.schemaVersion = 'runtime-health-1'`, { params: { tasks } });
  await graph.query("MATCH (t:MindNode) WHERE t.runtimeManaged = true AND t.runtimeKind = 'health_task' AND NOT (t)-[:TARGETS]->(:MindNode) DETACH DELETE t");
}
