import test from "node:test";
import assert from "node:assert/strict";
import {
  attributeMemoryMoment,
  correctMemoryAttribution
} from "../src/l1-subentity-memory-attribution.js";

const moment = { id: "moment-choice", occurredAt: "2026-07-23T18:00:00Z" };
const workspaceSnapshot = {
  id: "workspace-snapshot-1",
  controllerId: "protector",
  controllers: [
    { subentityId: "protector", confidence: 0.82, active: true },
    { subentityId: "planner", confidence: 0.55, active: true }
  ],
  slots: [
    { role: "lead", controllerId: "protector" },
    { role: "support", controllerId: "planner" }
  ]
};

test("the Moment points to controller and contributors without changing ownership", () => {
  const result = attributeMemoryMoment({ moment, workspaceSnapshot });
  assert.equal(result.attribution.mode, "ambiguous");
  assert.ok(result.relations.some(edge => edge.source === moment.id && edge.type === "ENCODED_UNDER" && edge.target === "protector"));
  assert.ok(result.relations.some(edge => edge.source === moment.id && edge.type === "INVOLVES" && edge.target === "planner"));
  assert.ok(result.relations.every(edge => edge.source === moment.id));
  assert.ok(result.relations.every(edge => edge.type !== "OWNS"));
});

test("GENERATED_BY requires independent evidence and cannot confirm itself", () => {
  const result = attributeMemoryMoment({
    moment,
    workspaceSnapshot,
    functionalSources: [
      { subentityId: "protector", confidence: 0.9, evidenceIds: [moment.id] },
      { subentityId: "planner", confidence: 0.7, evidenceIds: ["prior-observation"] }
    ]
  });
  assert.ok(!result.relations.some(edge => edge.type === "GENERATED_BY" && edge.target === "protector"));
  assert.ok(result.relations.some(edge => edge.type === "GENERATED_BY" && edge.target === "planner"));
  assert.ok(result.attribution.warnings.some(warning => warning.includes("protector")));
});

test("resonance is explicitly non-causal and cannot support identity", () => {
  const result = attributeMemoryMoment({
    moment,
    workspaceSnapshot: {},
    semanticProfile: { "goal:safety": 1 },
    subentities: [{ id: "protector", status: "active", signature: { "goal:safety": 1 } }]
  });
  const resonance = result.relations.find(edge => edge.type === "RESONATES_WITH");
  assert.equal(resonance.causal, false);
  assert.equal(resonance.maySupportIdentity, false);
  assert.equal(result.attribution.mode, "unknown");
});

test("human correction versions rather than overwrites attribution", () => {
  const first = attributeMemoryMoment({ moment, workspaceSnapshot }).attribution;
  const corrected = correctMemoryAttribution(first, {
    correctedBy: "actor-human",
    controllerId: "planner",
    involvedSubentityIds: ["protector"],
    note: "Le planificateur menait réellement."
  });
  assert.equal(corrected.superseded.status, "superseded");
  assert.equal(corrected.attribution.version, 2);
  assert.equal(corrected.attribution.correctedByHuman, true);
  assert.ok(corrected.relations.some(edge => edge.type === "ENCODED_UNDER" && edge.target === "planner"));
});

test("unknown remains a first-class attribution result", () => {
  const result = attributeMemoryMoment({ moment, workspaceSnapshot: {} });
  assert.equal(result.attribution.mode, "unknown");
  assert.equal(result.attribution.controllerId, null);
  assert.deepEqual(result.relations, []);
});
