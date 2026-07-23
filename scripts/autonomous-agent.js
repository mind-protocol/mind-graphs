// Boucle autonome locale : queue -> location -> workspace -> réveil Codex.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  assignTasksToCitizens, buildPersonalWakePrompt, buildWakePrompt, collectTaskQueue, composeGlobalWorkspace,
  resolveCitizenTaskChoice
} from "../src/autonomous-agent-runtime.js";
import { DEFAULT_CLUSTER_QUESTION_POLICY } from "../src/cluster-question-compiler.js";
import { relocateActorToSubjectSpace } from "../src/actor-location.js";
import {
  datasetLinks, datasetNodes, loadManifest, projectDir, readDatasets, selectGraph
} from "../src/graph-manifest.js";
import {
  DEFAULT_L4_PERSIST_SECONDS, DEFAULT_L4_TICK_SECONDS, resolveL4RuntimeSchedule
} from "../src/l4-runtime-schedule.js";
import { acquireLock } from "../src/runtime-manager.js";
import { buildWakeNotification, showWindowsNotification } from "../src/windows-notification.js";

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const found = args.find(arg => arg.startsWith(`--${flag}=`));
  return found ? found.slice(flag.length + 3) : fallback;
};
const intervalMs = Number(valueOf("interval-minutes", "5")) * 60_000;
const personalIntervalMs = Number(valueOf("personal-minutes", "15")) * 60_000;
const tickSeconds = Number(valueOf("tick-seconds", String(DEFAULT_L4_TICK_SECONDS)));
const persistSeconds = Number(valueOf("persist-seconds", String(DEFAULT_L4_PERSIST_SECONDS)));
const actorId = valueOf("actor", "actor-nlr");
const senseHandle = valueOf("sense-handle", process.env.MIND_CITIZEN_HANDLE || "") || null;
const once = args.includes("--once");
const dryRun = args.includes("--dry-run");
const noCodex = args.includes("--no-codex");
// Which agent the wake spawns. Codex stays the default; --agent=claude (or WAKE_AGENT=claude)
// switches to Claude Code headless. Codex is not installed on every host, Claude may be.
const wakeAgent = String(valueOf("agent", process.env.WAKE_AGENT || "codex") || "codex").toLowerCase();
const liveQueue = args.includes("--live-queue");
const questionCount = Number(valueOf("question-count", String(DEFAULT_CLUSTER_QUESTION_POLICY.maxQuestions)));
const questionBudget = Number(valueOf("question-budget", String(DEFAULT_CLUSTER_QUESTION_POLICY.totalEnergyBudget)));
const noNotification = args.includes("--no-notification");
const noPersonal = args.includes("--no-personal");
const personalNow = args.includes("--personal-now");
const personalOnly = args.includes("--personal-only");
if (!Number.isFinite(intervalMs) || intervalMs < 1_000) throw new Error("--interval-minutes must be positive");
if (!Number.isFinite(personalIntervalMs) || personalIntervalMs < 1_000) throw new Error("--personal-minutes must be positive");
resolveL4RuntimeSchedule({ tickSeconds, persistSeconds });
if (!Number.isInteger(questionCount) || questionCount < 0) throw new Error("--question-count must be a non-negative integer");
if (!Number.isFinite(questionBudget) || questionBudget < 0) throw new Error("--question-budget must be non-negative");

const runtimeDir = path.resolve(projectDir, "artifacts/autonomy");
const queuePath = path.join(runtimeDir, "task-queue.json");
const workspacePath = path.join(runtimeDir, "global-workspace.json");
const wakeLogPath = path.join(runtimeDir, "wake-log.jsonl");
const personalLatestPath = path.join(runtimeDir, "personal-latest.json");
const personalLogPath = path.join(runtimeDir, "personal-log.jsonl");
const physicsPath = path.resolve(projectDir, "artifacts/l4/physics-state.json");
const lockPath = path.join(runtimeDir, "autonomous-agent.lock");

if (!once && !dryRun) {
  await acquireLock(lockPath, { label: "autonomous agent" });
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function persistJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function codexExecutable() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  if (process.platform !== "win32") return path.resolve(projectDir, "node_modules/.bin/codex");
  const platformPackage = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
  const target = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  return path.resolve(projectDir, "node_modules/@openai", platformPackage, "vendor", target, "bin/codex.exe");
}

function runCodex(prompt, { sandbox = "workspace-write", liveSearch = false } = {}) {
  return new Promise((resolve, reject) => {
    let finalMessage = "";
    const executable = codexExecutable();
    const codexArgs = [...(liveSearch ? ["--search"] : []), "exec", "--ephemeral", "--sandbox", sandbox];
    const child = spawn(executable, codexArgs, {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true
    });
    child.once("error", reject);
    child.stdout.on("data", chunk => {
      const text = chunk.toString();
      finalMessage += text;
      process.stdout.write(text);
    });
    child.once("exit", code => code === 0
      ? resolve(finalMessage.trim())
      : reject(new Error(`codex exec exited with ${code}`)));
    child.stdin.end(prompt);
  });
}

let codexTail = Promise.resolve();
function enqueueCodex(prompt, options) {
  const pending = codexTail.then(
    () => runCodex(prompt, options),
    () => runCodex(prompt, options)
  );
  codexTail = pending.catch(() => {});
  return pending;
}

let physicsProcess = null;
function startPhysics() {
  if (once || dryRun || physicsProcess) return;
  physicsProcess = spawn(process.execPath, [
    "scripts/l4-tick.js",
    "--watch",
    `--period=${tickSeconds}`,
    `--persist-seconds=${persistSeconds}`,
    "--workspace=artifacts/autonomy/global-workspace.json"
  ], { cwd: projectDir, stdio: "inherit", windowsHide: true });
  physicsProcess.once("exit", code => {
    physicsProcess = null;
    if (code && code !== 0) console.error(`Le tick L4 s'est arrêté avec le code ${code}.`);
  });
}

async function wake() {
  const startedAt = new Date().toISOString();
  const manifest = await loadManifest();
  const physicsState = await readJson(physicsPath, {});
  const queue = await collectTaskQueue({ manifest, now: startedAt, live: liveQueue, physicsState });
  const previousWorkspace = await readJson(workspacePath, {});
  const assignmentPlan = assignTasksToCitizens(queue, {
    physicsState,
    globalWorkspaceState: previousWorkspace,
    fallbackActorId: actorId,
    now: startedAt,
    leaseMinutes: Math.max(10, intervalMs / 60_000 * 2)
  });
  const routes = assignmentPlan.assignments.length
    ? assignmentPlan.assignments
    : [{ citizenId: actorId, task: null, taskId: null, graphId: physicsState?.graphId || "design" }];
  const workspaces = {};
  const locations = [];
  const datasetCache = new Map();

  for (const route of routes) {
    const graphId = route.task?.graphId || route.graphId || physicsState?.graphId || "design";
    if (!datasetCache.has(graphId)) {
      const graphConfig = selectGraph(manifest, graphId);
      const datasets = await readDatasets(graphConfig);
      datasetCache.set(graphId, {
        nodes: datasets.flatMap(datasetNodes),
        links: datasets.flatMap(datasetLinks)
      });
    }
    const graph = datasetCache.get(graphId);
    const citizenQueue = { ...queue, nextTask: route.task || null };
    const workspace = composeGlobalWorkspace({
      queue: citizenQueue,
      physicsState,
      previousWorkspace: previousWorkspace?.citizens?.[route.citizenId],
      actorId: route.citizenId,
      senseHandle,
      observedAt: startedAt,
      graphNodes: graph.nodes,
      graphLinks: graph.links,
      assignment: route.task ? route : null,
      questionPolicy: {
        ...DEFAULT_CLUSTER_QUESTION_POLICY,
        maxQuestions: questionCount,
        totalEnergyBudget: questionBudget
      }
    });
    workspaces[route.citizenId] = workspace;
    if (route.task) {
      locations.push(await relocateActorToSubjectSpace({
        graphId: route.task.graphId,
        subjectId: route.task.id,
        actorId: route.citizenId,
        dryRun
      }));
    }
  }

  const primaryWorkspace = workspaces[routes[0].citizenId];
  const report = {
    startedAt,
    queue: { ...queue, assignments: assignmentPlan.assignments },
    assignmentPlan,
    workspaces,
    workspace: primaryWorkspace,
    locations,
    location: locations[0] || null,
    codex: dryRun || noCodex ? "skipped" : "pending",
    citizenRuns: []
  };
  if (dryRun) {
    console.log(JSON.stringify({
      startedAt,
      queue: { total: queue.total, eligible: queue.eligibleCount, nextTask: queue.nextTask?.id || null, graphs: queue.graphs },
      assignments: assignmentPlan.assignments.map(assignment => ({
        taskId: assignment.taskId,
        citizenId: assignment.citizenId,
        score: assignment.score,
        factors: assignment.factors
      })),
      workspaces,
      locations,
      codex: report.codex
    }, null, 2));
    return report;
  }

  await persistJson(queuePath, report.queue);
  await persistJson(workspacePath, { citizens: workspaces });
  startPhysics();
  if (!noCodex) {
    for (const route of routes) {
      const citizenWorkspace = workspaces[route.citizenId];
      const citizenRun = {
        citizenId: route.citizenId,
        taskId: route.taskId,
        codex: "pending"
      };
      try {
        citizenRun.codexResult = await enqueueCodex(buildWakePrompt(citizenWorkspace));
        citizenRun.codex = "completed";
        if (citizenWorkspace.activeTask) {
          // Le lease est confirmé, basculé, décliné ou laissé au défaut selon le choix réel du citoyen.
          const resolution = resolveCitizenTaskChoice({
            activeAssignment: citizenWorkspace.activeAssignment,
            taskProposals: citizenWorkspace.taskProposals,
            reportText: citizenRun.codexResult,
            now: new Date().toISOString()
          });
          citizenRun.leaseResolution = resolution;
          citizenRun.taskId = resolution.taskId;
        }
      } catch (error) {
        citizenRun.codex = "failed";
        citizenRun.error = error.message;
      }
      report.citizenRuns.push(citizenRun);
    }
    report.codex = report.citizenRuns.every(run => run.codex === "completed") ? "completed" : "failed";
    report.codexResult = report.citizenRuns.map(run => run.codexResult).filter(Boolean).join("\n\n");
    report.error = report.citizenRuns.map(run => run.error).filter(Boolean).join("; ") || null;
  }
  report.completedAt = new Date().toISOString();
  if (!noNotification) {
    report.notification = await showWindowsNotification(buildWakeNotification(report));
  }
  await fs.appendFile(wakeLogPath, `${JSON.stringify({
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    codex: report.codex,
    error: report.error || null,
    notification: report.notification || null,
    queueTotal: queue.total,
    eligibleCount: queue.eligibleCount,
    assignments: assignmentPlan.assignments.map(assignment => ({
      taskId: assignment.taskId,
      citizenId: assignment.citizenId,
      kind: assignment.kind,
      score: assignment.score,
      leaseId: assignment.leaseId
    })),
    resolutions: report.citizenRuns.map(run => ({
      citizenId: run.citizenId,
      status: run.leaseResolution?.status || null,
      taskId: run.leaseResolution?.taskId ?? null,
      leaseId: run.leaseResolution?.leaseId ?? null,
      leaseConfirmed: run.leaseResolution?.leaseConfirmed ?? null
    })),
    graphId: primaryWorkspace.graphId,
    workspaceVersion: primaryWorkspace.version,
    workspaceHash: primaryWorkspace.contentHash,
    physicsTick: primaryWorkspace.physics.tick,
    locations: locations.map(location => ({
      actorId: location.actorId,
      moved: location.moved,
      spaceId: location.space?.id || null,
      reason: location.reason || null
    }))
  })}\n`, "utf8");
  console.log(`Réveil ${report.codex} · ${assignmentPlan.assignments.length} attribution(s) · queue ${queue.eligibleCount}/${queue.total}.`);
  return report;
}

async function personalWake() {
  const startedAt = new Date().toISOString();
  const storedWorkspace = await readJson(workspacePath, null);
  let workspace = storedWorkspace?.citizens?.[actorId] || storedWorkspace;
  if (!workspace) {
    const physicsState = await readJson(physicsPath, {});
    const queue = await collectTaskQueue({ now: startedAt, live: false, physicsState });
    workspace = composeGlobalWorkspace({ queue, physicsState, actorId, senseHandle, observedAt: startedAt });
  }
  const report = {
    kind: "personal",
    startedAt,
    workspaceVersion: workspace?.version ?? null,
    workspaceHash: workspace?.contentHash || null,
    codex: dryRun || noCodex ? "skipped" : "pending"
  };

  if (dryRun) {
    console.log(JSON.stringify({ ...report, prompt: buildPersonalWakePrompt(workspace, startedAt) }, null, 2));
    return report;
  }

  if (!noCodex) {
    try {
      report.codexResult = await enqueueCodex(buildPersonalWakePrompt(workspace, startedAt), {
        sandbox: "read-only",
        liveSearch: true
      });
      report.codex = "completed";
    } catch (error) {
      report.codex = "failed";
      report.error = error.message;
    }
  }
  report.completedAt = new Date().toISOString();
  if (!noNotification) {
    report.notification = await showWindowsNotification({
      title: report.codex === "completed" ? "Codex personal · curiosité trouvée" : "Codex personal · réveil terminé",
      body: report.codexResult || report.error || "Réveil personnel sans exécution Codex."
    });
  }
  await persistJson(personalLatestPath, report);
  await fs.appendFile(personalLogPath, `${JSON.stringify({
    kind: report.kind,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    codex: report.codex,
    error: report.error || null,
    workspaceVersion: report.workspaceVersion,
    workspaceHash: report.workspaceHash,
    resultPreview: String(report.codexResult || "").slice(0, 500),
    notification: report.notification || null
  })}\n`, "utf8");
  console.log(`Réveil personal ${report.codex} · workspace v${report.workspaceVersion ?? "?"}.`);
  return report;
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function workLoop() {
  do {
    const cycleStarted = Date.now();
    await wake();
    if (once) break;
    await wait(Math.max(0, intervalMs - (Date.now() - cycleStarted)));
  } while (true);
}

async function personalLoop() {
  while (true) {
    await wait(personalIntervalMs);
    try {
      await personalWake();
    } catch (error) {
      console.error(`Réveil personal impossible : ${error.message}`);
    }
  }
}

async function main() {
  if (personalOnly) {
    do {
      const cycleStarted = Date.now();
      await personalWake();
      if (once) break;
      await wait(Math.max(0, personalIntervalMs - (Date.now() - cycleStarted)));
    } while (true);
    return;
  }
  if (!once && !noPersonal) void personalLoop();
  await workLoop();
  if (once && personalNow && !noPersonal) await personalWake();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    physicsProcess?.kill();
    process.exit(0);
  });
}

await main();
