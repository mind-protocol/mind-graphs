import { runL1ShadowTick } from "./l1-shadow-runtime.js";

export function processShadowEventBatch({ shadowState, authoritativeState, events, maxEvents = Infinity, options = {} }) {
  if (!Array.isArray(events)) throw new Error("Shadow event batch requires an events array.");
  if (!(maxEvents === Infinity || Number.isInteger(maxEvents) && maxEvents > 0)) throw new Error("maxEvents must be a positive integer or Infinity.");
  let state = structuredClone(shadowState);
  const reports = [];
  let applied = 0;
  let skipped = 0;
  for (const event of events) {
    if (applied >= maxEvents) break;
    const result = runL1ShadowTick(state, authoritativeState, event, options);
    state = result.state;
    reports.push(result.report);
    if (result.report.changed) applied += 1;
    else skipped += 1;
  }
  return { state, reports, applied, skipped, scanned: reports.length };
}

export function parseShadowEventLog(raw) {
  const events = [];
  const errors = [];
  for (const [index, line] of String(raw || "").split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!event.tickId) throw new Error("missing tickId");
      events.push(event);
    } catch (error) {
      errors.push({ line: index + 1, error: error.message });
    }
  }
  return { events, errors };
}
