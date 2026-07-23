import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_L4_PERSIST_SECONDS,
  DEFAULT_L4_TICK_SECONDS,
  resolveL4RuntimeSchedule
} from "../src/l4-runtime-schedule.js";

test("L4 ticks in memory every five seconds but checkpoints only every five minutes", () => {
  const schedule = resolveL4RuntimeSchedule();
  assert.equal(schedule.tickSeconds, DEFAULT_L4_TICK_SECONDS);
  assert.equal(schedule.persistSeconds, DEFAULT_L4_PERSIST_SECONDS);
  assert.equal(schedule.tickPeriodMs, 5_000);
  assert.equal(schedule.persistPeriodMs, 300_000);
});

test("L4 refuses a persistence cadence faster than its physics cadence", () => {
  assert.throws(
    () => resolveL4RuntimeSchedule({ tickSeconds: 10, persistSeconds: 5 }),
    /persist-seconds/u
  );
});
