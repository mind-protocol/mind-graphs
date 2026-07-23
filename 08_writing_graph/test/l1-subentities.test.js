import test from "node:test";
import assert from "node:assert/strict";
import { capacityPressure, createMemoryMoment, decideSubentityMerge, mergeSubentities, promoteSubentity, promotionThreshold, reconcileSubentities } from "../src/l1-subentities.js";

const low = overrides => ({ id: "belief-a", level: "low", status: "candidate", weight: 1, stability: 0.3, certainty: 0.55, signature: { safety: 1, retreat: 0.8 }, goals: ["safety"], strategies: ["retreat"], preferences: [], beliefs: [], evidenceMomentIds: ["m1"], ...overrides });

test("similar low-level subentities merge and preserve provenance", () => {
  const a = low({ id: "a", certainty: 0.8 });
  const b = low({ id: "b", signature: { safety: 0.95, retreat: 0.75 }, evidenceMomentIds: ["m2"] });
  const decision = decideSubentityMerge(a, b);
  assert.equal(decision.action, "merge");
  const result = mergeSubentities(a, b, decision);
  assert.deepEqual(result.entities[0].evidenceMomentIds.sort(), ["m1", "m2"]);
  assert.equal(result.entities[1].supersededBy, "a");
});

test("population reconciliation applies pair rules and emits an audit trail", () => {
  const a = low({ id: "a", certainty: 0.8 });
  const b = low({ id: "b", signature: { safety: 0.97, retreat: 0.79 } });
  const distinct = low({ id: "c", signature: { curiosity: 1 }, goals: ["learn"], strategies: ["explore"] });
  const result = reconcileSubentities([a, b, distinct]);
  assert.equal(result.active.length, 2);
  assert.equal(result.retired.length, 1);
  assert.equal(result.events[0].type, "SUBENTITY_MERGED");
});

test("high-certainty contradiction absorbs a low belief without deleting dissent", () => {
  const certain = low({ id: "certain", certainty: 0.95, signature: { explore: 1 }, beliefs: [{ key: "door-safe", stance: 1, confidence: 0.95 }], evidenceMomentIds: ["m-safe"] });
  const uncertain = low({ id: "uncertain", certainty: 0.35, signature: { avoid: 1 }, beliefs: [{ key: "door-safe", stance: -1, confidence: 0.5 }], evidenceMomentIds: ["m-fear"] });
  const decision = decideSubentityMerge(certain, uncertain);
  assert.equal(decision.reason, "certainty_dominates_low_level_conflict");
  const result = mergeSubentities(certain, uncertain, decision);
  assert.equal(result.entities[0].conflicts[0].with, "uncertain");
  assert.deepEqual(result.entities[0].conflicts[0].preservedEvidenceMomentIds, ["m-fear"]);
});

test("contradictory high-level IFS-like parts remain distinct", () => {
  const protector = low({ id: "protector", level: "high", weight: 12, stability: 0.95, certainty: 0.9, signature: { protect: 1 }, beliefs: [{ key: "risk", stance: -1, confidence: 0.9 }] });
  const explorer = low({ id: "explorer", level: "high", weight: 10, stability: 0.9, certainty: 0.85, signature: { explore: 1 }, beliefs: [{ key: "risk", stance: 1, confidence: 0.9 }] });
  const decision = decideSubentityMerge(protector, explorer, { highLevelCount: 14 });
  assert.equal(decision.action, "keep_distinct");
  assert.equal(decision.reason, "protected_high_level_conflict");
});

test("capacity is a soft attractor, not a maximum", () => {
  assert.ok(capacityPressure(14) > capacityPressure(8));
  assert.ok(promotionThreshold(14) > promotionThreshold(8));
  const exceptional = low({ id: "novel", weight: 30, stability: 1, certainty: 1, coherence: 1, evidenceMomentIds: Array.from({ length: 30 }, (_, i) => `m${i}`), goals: [{ key: "create", score: 1 }], preferences: [{ key: "novelty", score: 0.9 }] });
  const result = promoteSubentity(exceptional, 14);
  assert.equal(result.promoted, true);
  assert.equal(result.entity.level, "high");
  assert.ok(result.narratives.some(node => node.semanticType === "SubentityPersonalityNarrative"));
  assert.ok(result.narratives.every(node => node.evidenceMomentIds.length > 0));
  assert.ok(result.relations.some(edge => edge.type === "DESCRIBES_SUBENTITY" && edge.target === "novel"));
  assert.ok(result.relations.some(edge => edge.type === "SUPPORTS" && edge.source === "m0"));
});

test("memory creation captures the active controller and alternatives", () => {
  const result = createMemoryMoment({ id: "moment-42", occurredAt: "2026-07-23T10:00:00.000Z", content: "decision", workspaceSnapshot: { id: "ws-42", controllers: [
    { subentityId: "protector", confidence: 0.78, active: true }, { subentityId: "explorer", confidence: 0.42, active: true }, { subentityId: "inactive", confidence: 0.99, active: false }
  ] } });
  assert.equal(result.moment.controllerAttributionStatus, "captured_at_creation");
  assert.deepEqual(result.relations.map(edge => edge.source), ["protector", "explorer"]);
  assert.equal(result.relations[0].type, "CONTROLLED_WORKSPACE_DURING");
  assert.equal(result.relations[0].attribution, "primary");
  assert.equal(result.relations[1].attribution, "alternative");
});

test("memory explicitly stays unknown when no controller is observable", () => {
  const result = createMemoryMoment({ id: "moment-unknown", content: "blur", occurredAt: "2026-07-23T10:01:00.000Z" });
  assert.equal(result.moment.controllerAttributionStatus, "unknown");
  assert.deepEqual(result.relations, []);
});
