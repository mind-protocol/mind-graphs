import test from "node:test";
import assert from "node:assert/strict";
import { toFalkorProperties } from "../src/falkor-properties.js";

test("Falkor properties preserve primitives and serialize nested JSON reversibly", () => {
  const source = {
    id: "objective-1",
    active: true,
    score: 0,
    tags: ["public", "verified"],
    wakeManagement: { mode: "adaptive", fixedCadence: false },
    deliveryPlan: [{ id: "step-1", status: "ready" }]
  };

  const properties = toFalkorProperties(source);
  assert.equal(properties.id, source.id);
  assert.equal(properties.active, true);
  assert.equal(properties.score, 0);
  assert.deepEqual(properties.tags, source.tags);
  assert.deepEqual(JSON.parse(properties.wakeManagementJson), source.wakeManagement);
  assert.deepEqual(JSON.parse(properties.deliveryPlanJson), source.deliveryPlan);
  assert.equal("wakeManagement" in properties, false);
  assert.equal("deliveryPlan" in properties, false);
});

test("Falkor property serialization refuses an ambiguous Json suffix collision", () => {
  assert.throws(
    () => toFalkorProperties({ plan: { status: "ready" }, planJson: "authored value" }),
    /Falkor property collision/u
  );
});
