import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateAttentionBudget, createAttentionState, innerOuterFocusOf, updateInnerOuterFocus
} from "../src/l1-attention-arbitrator.js";

const connection = { graphId: "g", source: "C", target: "x", weight: 0.8, timestamp: 1000 };
const line = { ...connection, sensoryLineHash: "same-signal" };

const allocate = ({ previousState = createAttentionState(), workspaceState = {}, now = 1000 } = {}) =>
  allocateAttentionBudget({
    totalBudget: 1,
    connections: [connection],
    embeddedLines: [line],
    workspaceState,
    previousState,
    now,
    recentWindowMs: 1000
  });

test("a novel external signal gets more attention than the same repeated signal", () => {
  const first = allocate();
  const second = allocate({ previousState: first.nextState });
  const third = allocate({ previousState: second.nextState });
  assert.equal(first.external.novelty, 1);
  assert.ok(second.external.novelty < first.external.novelty);
  assert.ok(third.external.novelty < second.external.novelty);
  assert.ok(first.focusDynamics.externalDemand > second.focusDynamics.externalDemand);
  assert.ok(second.focusDynamics.externalDemand > third.focusDynamics.externalDemand);
  assert.ok(first.focusDynamics.target > second.focusDynamics.target);
  assert.ok(second.focusDynamics.target > third.focusDynamics.target);
});

test("the active workspace entity can bias attention inward or outward", () => {
  const internal = allocate({
    workspaceState: { activeEntity: { id: "protector", attentionalOrientation: "internal", focusIntensity: 1, homeostaticError: 1 } }
  });
  const balanced = allocate();
  const external = allocate({
    workspaceState: { activeEntity: { id: "explorer", attentionalOrientation: "external", focusIntensity: 1 } }
  });
  assert.ok(internal.sensoryShare < balanced.sensoryShare);
  assert.ok(balanced.sensoryShare < external.sensoryShare);
  assert.equal(internal.workspace.entityId, "protector");
  assert.equal(external.sensoryShare, 0.8);
});

test("one continuous inner-outer float replaces the categorical focus pair", () => {
  const internal = allocate({ workspaceState: { activeEntity: { id: "inner", innerOuterFocus: -1, homeostaticError: 1 } } });
  const mostlyInternal = allocate({ workspaceState: { activeEntity: { id: "inner-soft", innerOuterFocus: -0.5, homeostaticError: 1 } } });
  const mostlyExternal = allocate({ workspaceState: { activeEntity: { id: "outer-soft", innerOuterFocus: 0.5 } } });
  const external = allocate({ workspaceState: { activeEntity: { id: "outer", innerOuterFocus: 1 } } });
  assert.ok(internal.sensoryShare < mostlyInternal.sensoryShare);
  assert.ok(mostlyInternal.sensoryShare < mostlyExternal.sensoryShare);
  assert.ok(mostlyExternal.sensoryShare < external.sensoryShare);
  assert.equal(internal.workspace.innerOuterFocus, -1);
  assert.equal(external.workspace.innerOuterFocus, 1);
  assert.equal(innerOuterFocusOf({ attentionalOrientation: "internal", focusIntensity: 0.4 }), -0.4);
  assert.throws(() => innerOuterFocusOf({ innerOuterFocus: 1.01 }), /\[-1,1\]/);
});

test("no available external signal leaves the complete budget local", () => {
  const allocation = allocateAttentionBudget({
    totalBudget: 1,
    connections: [],
    embeddedLines: [],
    now: 1000,
    recentWindowMs: 1000
  });
  assert.equal(allocation.sensoryShare, 0);
  assert.equal(allocation.sensoryBudget, 0);
  assert.equal(allocation.reservedLocalBudget, 1);
});

test("an absolute sensory cap remains available as an explicit safety override", () => {
  const allocation = allocateAttentionBudget({
    totalBudget: 1,
    connections: [connection],
    embeddedLines: [line],
    now: 1000,
    recentWindowMs: 1000,
    absoluteSensoryCap: 0.2
  });
  assert.equal(allocation.sensoryBudget, 0.2);
  assert.equal(allocation.reservedLocalBudget, 0.8);
});

test("focus moves toward external novelty without using its current orientation as evidence", () => {
  const first = allocate({ previousState: createAttentionState({ innerOuterFocus: -0.8 }) });
  assert.ok(first.focusDynamics.target > 0);
  assert.ok(first.focusDynamics.nextFocus > -0.8);
  const sameEvidenceDifferentFocus = allocate({ previousState: createAttentionState({ innerOuterFocus: 0.8 }) });
  assert.equal(first.focusDynamics.target, sameEvidenceDifferentFocus.focusDynamics.target);
});

test("internal pressure moves focus inward and no demand relaxes it toward balance", () => {
  const internal = allocateAttentionBudget({
    totalBudget: 1,
    connections: [],
    embeddedLines: [],
    previousState: createAttentionState({ innerOuterFocus: 0.5 }),
    workspaceState: { activeEntity: { homeostaticError: 1, affectIntensity: 1, goalPressure: 1, cognitiveLoad: 1 } },
    now: 1000,
    recentWindowMs: 1000
  });
  assert.ok(internal.focusDynamics.target < 0);
  assert.ok(internal.focusDynamics.nextFocus < 0.5);
  const relaxation = updateInnerOuterFocus({ previousFocus: -0.8, externalDemand: 0, internalDemand: 0, adaptationRate: 0.25 });
  assert.equal(relaxation.target, 0);
  assert.equal(relaxation.nextFocus, -0.6);
});
