import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
export const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HEALTHY = new Set(["healthy"]);
const REPAIRABLE = new Set(["down", "degraded", "stale", "unknown"]);

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export async function loadRuntimeConfig(configPath = path.join(projectDir, "data/runtime-services.json")) {
  return JSON.parse(await fs.readFile(configPath, "utf8"));
}

export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export function commandMatches(commandLine, includes = []) {
  const haystack = String(commandLine || "").toLowerCase();
  return includes.every(piece => haystack.includes(String(piece).toLowerCase()));
}

export async function listProcesses() {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
    ], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    const parsed = JSON.parse(stdout || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({
      pid: item.ProcessId,
      commandLine: item.CommandLine || ""
    }));
  }
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,command="], { maxBuffer: 10 * 1024 * 1024 });
  return stdout.split("\n").filter(Boolean).map(line => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    return { pid: match ? Number(match[1]) : null, commandLine: match ? match[2] : line };
  });
}

export function checkTcp({ host, port, timeoutMs = 1500 }) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done({ ok: true }));
    socket.once("timeout", () => done({ ok: false, error: "tcp timeout" }));
    socket.once("error", error => done({ ok: false, error: error.message }));
  });
}

async function checkHttp({ url, timeoutMs = 2000 }, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkArtifact({ path: artifactPath, maxAgeSeconds = 300 }, { cwd, now, stat = fs.stat }) {
  const absolutePath = path.resolve(cwd, artifactPath);
  try {
    const stats = await stat(absolutePath);
    const ageSeconds = Math.max(0, (now.getTime() - stats.mtime.getTime()) / 1000);
    return { ok: ageSeconds <= maxAgeSeconds, exists: true, path: artifactPath, ageSeconds, maxAgeSeconds };
  } catch (error) {
    return { ok: false, exists: false, path: artifactPath, error: error.message, maxAgeSeconds };
  }
}

export async function observeService(service, options = {}) {
  const now = options.now || new Date();
  const cwd = options.cwd || projectDir;
  const observation = { serviceId: service.id, checkedAt: now.toISOString(), checks: {}, errors: [] };
  const spec = service.observation || {};

  if (spec.process) {
    try {
      const processes = options.processes || await listProcesses();
      const matches = processes.filter(item => commandMatches(item.commandLine, spec.process.commandIncludes || []));
      observation.checks.process = { ok: matches.length > 0, count: matches.length, pids: matches.map(item => item.pid).filter(Boolean) };
    } catch (error) {
      observation.checks.process = { ok: false, unknown: true, error: error.message };
      observation.errors.push(error.message);
    }
  }

  if (spec.tcp) observation.checks.tcp = await (options.checkTcp || checkTcp)(spec.tcp);
  if (spec.http) observation.checks.http = await checkHttp(spec.http, options.fetchImpl || fetch);
  if (spec.artifact) observation.checks.artifact = await checkArtifact(spec.artifact, { cwd, now, stat: options.stat });

  return observation;
}

export function classifyService(service, observation, previous = {}, now = new Date()) {
  if (service.enabled === false) return { state: "blocked", reason: "service disabled in manifest" };

  const checks = observation.checks || {};
  const values = Object.values(checks);
  const unknown = values.length > 0 && values.every(check => check.unknown);
  if (unknown) return { state: "unknown", reason: "all measurements failed or were unavailable" };

  const processCheck = checks.process;
  const tcpCheck = checks.tcp;
  const httpCheck = checks.http;
  const artifactCheck = checks.artifact;

  if (service.observation?.process && processCheck && !processCheck.ok && !processCheck.unknown) {
    const lastStartedAt = previous.lastStartedAt ? new Date(previous.lastStartedAt).getTime() : 0;
    const graceMs = Number(service.observation?.grace?.startupSeconds || service.grace?.startupSeconds || 0) * 1000;
    if (graceMs && lastStartedAt && now.getTime() - lastStartedAt < graceMs) return { state: "starting", reason: "inside startup grace period" };
    return { state: service.required === false ? "degraded" : "down", reason: "expected process is not running" };
  }

  if (tcpCheck && !tcpCheck.ok) return { state: service.required === false ? "degraded" : "down", reason: tcpCheck.error || "tcp check failed" };
  if (httpCheck && !httpCheck.ok) return { state: "degraded", reason: httpCheck.error || `http ${httpCheck.status}` };
  if (artifactCheck && !artifactCheck.ok) {
    const reason = artifactCheck.exists === false ? "progress artifact missing" : `progress artifact stale (${Math.round(artifactCheck.ageSeconds)}s)`;
    return { state: artifactCheck.exists === false && service.required === false ? "degraded" : "stale", reason };
  }

  return { state: "healthy", reason: "all declared checks passed" };
}

export function applyDependencyBlocks(statusesById, services) {
  for (const service of services) {
    const status = statusesById.get(service.id);
    if (!status || HEALTHY.has(status.state) || status.state === "blocked") continue;
    const blockedBy = (service.dependencies || []).find(id => !HEALTHY.has(statusesById.get(id)?.state));
    if (blockedBy) {
      status.previousStateBeforeBlock = status.state;
      status.state = "blocked";
      status.reason = `dependency ${blockedBy} is not healthy`;
      status.blockedBy = blockedBy;
    }
  }
}

function recentAttempts(previous, service, now) {
  const windowMs = Number(service.repair?.windowSeconds || 900) * 1000;
  return (previous.repairAttempts || []).filter(item => now.getTime() - new Date(item.at).getTime() <= windowMs);
}

export function repairDecision(service, status, previous = {}, now = new Date()) {
  const repair = service.repair || {};
  const allowed = new Set(repair.allowedActions || []);
  if (status.state === "unknown") return { action: "none", reason: "measurement unknown; no autonomous restart" };
  if (!REPAIRABLE.has(status.state)) return { action: "none", reason: "state is not repairable" };
  if (!allowed.size) return { action: "none", reason: "no repair action allowed" };
  if (status.state === "blocked") return { action: "none", reason: status.reason || "blocked" };

  const attempts = recentAttempts(previous, service, now);
  const breaker = repair.circuitBreaker || {};
  if (breaker.openAfterFailures && attempts.length >= Number(breaker.openAfterFailures)) {
    const retryAfterMs = Number(breaker.retryAfterSeconds || 600) * 1000;
    const last = attempts.at(-1);
    if (last && now.getTime() - new Date(last.at).getTime() < retryAfterMs) {
      return { action: "circuit_open", reason: "restart circuit breaker is open", attempts: attempts.length };
    }
  }
  if (repair.maxAttempts && attempts.length >= Number(repair.maxAttempts)) {
    return { action: "none", reason: "restart budget exhausted", attempts: attempts.length };
  }

  if (allowed.has("restart") || allowed.has("start")) return { action: allowed.has("restart") ? "restart" : "start", command: repair.command, attempts: attempts.length };
  if (allowed.has("restart-dependency")) return { action: "restart-dependency", targetServiceId: repair.targetServiceId, attempts: attempts.length };
  return { action: "none", reason: "allowed repair action is not implemented" };
}

export function spawnDetached(command, { cwd = projectDir } = {}) {
  if (!Array.isArray(command) || !command.length) throw new Error("repair command must be a non-empty argv array");
  const executable = command[0] === "node" ? process.execPath : process.platform === "win32" && command[0] === "npm" ? "npm.cmd" : command[0];
  const spawnCommand = process.platform === "win32" && executable.endsWith(".cmd")
    ? ["cmd.exe", ["/d", "/s", "/c", executable, ...command.slice(1)]]
    : [executable, command.slice(1)];
  const child = spawn(spawnCommand[0], spawnCommand[1], {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.once("error", error => {
    console.error(JSON.stringify({
      type: "runtime_detached_spawn_error",
      command: [executable, ...command.slice(1)],
      error: error.message
    }));
  });
  child.unref();
  return child.pid;
}

function repairCommandFor(service) {
  const allowed = new Set(service?.repair?.allowedActions || []);
  if (allowed.has("restart") || allowed.has("start")) return service.repair.command;
  return null;
}

export function buildTransitionEvents(previousStatus, currentStatus, now = new Date()) {
  const previousServices = new Map((previousStatus?.services || []).map(service => [service.id, service]));
  const events = [];
  for (const service of currentStatus.services || []) {
    const previous = previousServices.get(service.id);
    if (!previous || previous.state !== service.state) {
      events.push({
        type: "runtime_state_transition",
        serviceId: service.id,
        previousState: previous?.state || null,
        state: service.state,
        reason: service.reason,
        observedAt: now.toISOString()
      });
    }
  }
  return events;
}

function unhealthyServices(status) {
  return (status?.services || []).filter(service => service.state !== "healthy");
}

export function buildRuntimeAlert(previousStatus, currentStatus, now = new Date()) {
  if (currentStatus.overall === "healthy") return null;
  const previousOverall = previousStatus?.overall || "unknown";
  const currentUnhealthy = unhealthyServices(currentStatus);
  const previousById = new Map((previousStatus?.services || []).map(service => [service.id, service]));
  const changedUnhealthy = currentUnhealthy.filter(service => previousById.get(service.id)?.state !== service.state);
  if (previousOverall === currentStatus.overall && changedUnhealthy.length === 0) return null;

  const lines = [
    `Mind runtime n'est pas healthy (${currentStatus.overall}).`,
    `Check: ${currentStatus.checkedAt || now.toISOString()}.`,
    ...currentUnhealthy.map(service => `- ${service.name || service.id}: ${service.state} (${service.reason || "raison inconnue"})`)
  ];
  return {
    type: "runtime_health_alert",
    platform: "telegram",
    observedAt: now.toISOString(),
    overall: currentStatus.overall,
    previousOverall,
    unhealthyServiceIds: currentUnhealthy.map(service => service.id),
    message: lines.join("\n")
  };
}

function envValue(env, names = []) {
  for (const name of names) {
    const value = env?.[name];
    if (value) return value;
  }
  return "";
}

async function sendTelegramAlert(alert, telegramConfig = {}, options = {}) {
  const env = options.env || process.env;
  const token = envValue(env, [telegramConfig.tokenEnv || "MIND_TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"]);
  const chatId = telegramConfig.chatId || envValue(env, [telegramConfig.chatIdEnv || "MIND_TELEGRAM_CHAT_ID", "TELEGRAM_CHAT_ID"]);
  if (!token || !chatId) return { delivered: false, reason: "telegram credentials missing" };

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: alert.message,
      disable_web_page_preview: true
    })
  });
  if (!response.ok) return { delivered: false, reason: `telegram http ${response.status}` };
  return { delivered: true, reason: "sent" };
}

async function emitRuntimeNotification(alert, config, options = {}) {
  const telegramConfig = config.manager?.notifications?.telegram || {};
  if (!telegramConfig.enabled || !alert) return [];
  const now = options.now || new Date();
  const cwd = options.cwd || projectDir;
  const outboxPath = path.resolve(cwd, telegramConfig.outboxPath || "artifacts/runtime/telegram-alerts.jsonl");
  const send = options.sendRuntimeAlert || ((payload, sendOptions) => sendTelegramAlert(payload, telegramConfig, sendOptions));
  let delivery;
  try {
    delivery = await send(alert, options);
  } catch (error) {
    delivery = { delivered: false, reason: error.message };
  }
  const record = { ...alert, delivery, recordedAt: now.toISOString() };
  await appendEvents(outboxPath, [record]);
  return [{
    type: delivery.delivered ? "runtime_notification_sent" : "runtime_notification_pending",
    platform: "telegram",
    delivered: delivery.delivered,
    reason: delivery.reason,
    observedAt: now.toISOString()
  }];
}

async function appendEvents(eventsPath, events) {
  if (!events.length) return;
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.appendFile(eventsPath, `${events.map(event => JSON.stringify(event)).join("\n")}\n`, "utf8");
}

export async function runtimeCycle(config, options = {}) {
  const now = options.now || new Date();
  const cwd = options.cwd || projectDir;
  const statusPath = path.resolve(cwd, config.manager.statusPath);
  const eventsPath = path.resolve(cwd, config.manager.eventsPath);
  const previousStatus = options.previousStatus ?? await readJson(statusPath, { services: [] });
  const previousById = new Map((previousStatus?.services || []).map(service => [service.id, service]));
  const services = (config.services || []).filter(service => service.enabled !== false || options.includeDisabled);
  const statuses = [];

  for (const service of services) {
    const observation = await observeService(service, { ...options, cwd, now });
    const classified = classifyService(service, observation, previousById.get(service.id), now);
    statuses.push({
      id: service.id,
      name: service.name,
      criticality: service.criticality || "supporting",
      required: service.required !== false,
      managedBy: service.managedBy || null,
      checkedAt: now.toISOString(),
      observation,
      ...classified,
      repairAttempts: previousById.get(service.id)?.repairAttempts || []
    });
  }

  const statusesById = new Map(statuses.map(status => [status.id, status]));
  applyDependencyBlocks(statusesById, services);

  const repairEvents = [];
  if (options.repair !== false) {
    for (const service of services) {
      const status = statusesById.get(service.id);
      const decision = repairDecision(service, status, previousById.get(service.id), now);
      status.repairDecision = decision;
      if (decision.action === "restart" || decision.action === "start" || decision.action === "restart-dependency") {
        const targetService = decision.action === "restart-dependency"
          ? services.find(candidate => candidate.id === decision.targetServiceId)
          : service;
        const command = decision.action === "restart-dependency" ? repairCommandFor(targetService) : decision.command;
        try {
          if (!command) throw new Error(`no restart command for target ${decision.targetServiceId || service.id}`);
          const pid = (options.spawnDetached || spawnDetached)(command, { cwd });
          const attempt = { at: now.toISOString(), action: decision.action, pid };
          status.repairAttempts = [...recentAttempts(previousById.get(service.id) || {}, service, now), attempt];
          status.lastStartedAt = now.toISOString();
          repairEvents.push({
            type: "runtime_repair_attempt",
            serviceId: service.id,
            action: decision.action,
            targetServiceId: targetService?.id || null,
            pid,
            observedAt: now.toISOString()
          });
        } catch (error) {
          status.repairError = error.message;
          repairEvents.push({ type: "runtime_repair_failed", serviceId: service.id, action: decision.action, error: error.message, observedAt: now.toISOString() });
        }
      }
    }
  }

  const serviceStates = statuses.map(status => status.state);
  const overall = serviceStates.some(state => ["down", "blocked", "unknown"].includes(state)) ? "degraded"
    : serviceStates.some(state => ["stale", "degraded", "starting", "flapping"].includes(state)) ? "degraded"
      : "healthy";
  const currentStatus = {
    schemaVersion: config.schemaVersion,
    managerId: config.manager.id,
    checkedAt: now.toISOString(),
    overall,
    services: statuses
  };
  const transitionEvents = buildTransitionEvents(previousStatus, currentStatus, now);
  const notificationEvents = await emitRuntimeNotification(buildRuntimeAlert(previousStatus, currentStatus, now), config, { ...options, cwd, now });
  await writeJsonAtomic(statusPath, currentStatus);
  await appendEvents(eventsPath, [...transitionEvents, ...repairEvents, ...notificationEvents]);
  return { status: currentStatus, events: [...transitionEvents, ...repairEvents, ...notificationEvents] };
}

async function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but cannot be signalled by this account.
    return error.code === "EPERM";
  }
}

export async function acquireLock(lockPath, { label = "runtime manager" } = {}) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString()
        }));
      } finally {
        await handle.close();
      }
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    let existing = null;
    try {
      existing = JSON.parse(await fs.readFile(lockPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
    }
    if (await processIsAlive(existing?.pid)) {
      throw new Error(`${label} already running as pid ${existing.pid}`);
    }

    // Rename is atomic: only one contender can claim and remove a stale lock.
    const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}-${attempt}`;
    try {
      await fs.rename(lockPath, stalePath);
      await fs.unlink(stalePath).catch(error => {
        if (error.code !== "ENOENT") throw error;
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  throw new Error(`unable to acquire ${label} lock`);
}
