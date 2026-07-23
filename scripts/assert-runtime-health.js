import { runtimeHealthInvariants } from "../src/continuous-verification.js";

const endpoint = process.env.MIND_HEALTH_URL || "http://localhost:4173/api/runtime-health";

try {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const result = runtimeHealthInvariants(payload.checks || []);
  console.log(JSON.stringify({ endpoint, ...result }));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ endpoint, ok: false, error: error.message }));
  process.exitCode = 1;
}
