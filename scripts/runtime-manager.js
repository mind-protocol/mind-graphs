import path from "node:path";
import { acquireLock, loadRuntimeConfig, projectDir, runtimeCycle } from "../src/runtime-manager.js";

const args = process.argv.slice(2);
const once = args.includes("--once");
const noRepair = args.includes("--no-repair");
const configPath = path.resolve(projectDir, args.find(arg => arg.startsWith("--config="))?.split("=")[1] || "data/runtime-services.json");
const config = await loadRuntimeConfig(configPath);
const intervalSeconds = Number(args.find(arg => arg.startsWith("--interval="))?.split("=")[1] || config.manager.defaultIntervalSeconds || 15);
const lockPath = path.resolve(projectDir, config.manager.lockPath || "artifacts/runtime/runtime-manager.lock");

if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1) throw new Error("--interval must be at least 1 second");

await acquireLock(lockPath);

async function runOnce() {
  const result = await runtimeCycle(config, { cwd: projectDir, repair: !noRepair });
  const counts = result.status.services.reduce((acc, service) => {
    acc[service.state] = (acc[service.state] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    checkedAt: result.status.checkedAt,
    overall: result.status.overall,
    counts,
    events: result.events.length
  }));
}

await runOnce();
if (!once) {
  setInterval(() => runOnce().catch(error => console.error(JSON.stringify({
    checkedAt: new Date().toISOString(),
    ok: false,
    error: error.message
  }))), intervalSeconds * 1000);
}
