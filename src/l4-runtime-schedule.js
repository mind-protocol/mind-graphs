export const DEFAULT_L4_TICK_SECONDS = 5;
export const DEFAULT_L4_PERSIST_SECONDS = 300;

export function resolveL4RuntimeSchedule({
  tickSeconds = DEFAULT_L4_TICK_SECONDS,
  persistSeconds = DEFAULT_L4_PERSIST_SECONDS
} = {}) {
  const tick = Number(tickSeconds);
  const persist = Number(persistSeconds);
  if (!Number.isFinite(tick) || tick < 1) {
    throw new Error("--period must be at least 1 second");
  }
  if (!Number.isFinite(persist) || persist < tick) {
    throw new Error("--persist-seconds must be greater than or equal to --period");
  }
  return {
    tickSeconds: tick,
    persistSeconds: persist,
    tickPeriodMs: tick * 1000,
    persistPeriodMs: persist * 1000
  };
}
