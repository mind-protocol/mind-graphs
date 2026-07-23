import test from "node:test";
import assert from "node:assert/strict";
import { buildPhysicsIndex, createState, summarize } from "../src/l4-physics.js";
import {
  buildTemporalCommitmentCluster,
  deliverTemporalWake,
  detectProspectiveWakeIntent,
  evaluateWakeProposal,
  resolveWakeTime
} from "../src/temporal-membrane.js";

const NOW = new Date("2026-07-23T10:00:00.000Z");
const physical = { P: 0.8, S: 0.8, G: 1, W: 1 };

const proposal = (overrides = {}) => detectProspectiveWakeIntent({
  text: "Demain, continue la présentation pour NLR",
  time: "2026-07-24T08:30:00.000Z",
  prompt: "Continue la présentation pour NLR",
  actorId: "actor-nlr",
  handle: "nlr",
  place: "space:mind-protocol:hall",
  goalIds: ["goal-presentation"],
  sourceNodeIds: ["slide-outline"],
  activeNodeIds: ["active-note"],
  ...overrides
});

test("L1 détecte l’intention prospective et L2 produit l’appel schedule_wake minimal", () => {
  const detected = proposal();
  assert.deepEqual(detected.l1.signals, ["prospective_language", "explicit_time"]);
  const approved = evaluateWakeProposal(detected, {
    now: NOW,
    activeGoalIds: ["goal-presentation"]
  });
  assert.equal(approved.eligible, true);
  assert.equal(approved.status, "dormant");
  assert.deepEqual(approved.scheduleCall, {
    time: "2026-07-24T08:30:00.000Z",
    prompt: "Continue la présentation pour NLR",
    place: "space:mind-protocol:hall",
    handle: "nlr",
    repeat: "once"
  });
  const cluster = buildTemporalCommitmentCluster(approved);
  assert.equal(cluster.nodes[0].status, "dormant");
  assert.ok(cluster.links.some(link => link.type === "AUTHORED_BY" && link.target === "actor-nlr"));
  assert.ok(cluster.links.some(link => link.type === "APPLIES_IN" && link.target === "space:mind-protocol:hall"));
  assert.equal(cluster.links.filter(link => link.type === "TARGETS").length, 3);
  assert.ok(cluster.links.every(link => link.justification));
});

test("L2 refuse doublons, objectifs fermés et récurrence implicite", () => {
  const first = evaluateWakeProposal(proposal(), {
    now: NOW,
    activeGoalIds: ["goal-presentation"]
  });
  const duplicate = evaluateWakeProposal(proposal(), {
    now: NOW,
    activeGoalIds: ["goal-presentation"],
    existingCommitments: [first]
  });
  assert.deepEqual(duplicate.reasons, ["duplicate_commitment"]);

  const inactive = evaluateWakeProposal(proposal(), { now: NOW, activeGoalIds: [] });
  assert.ok(inactive.reasons.includes("inactive_goal"));

  const implicitWeekly = evaluateWakeProposal(proposal({ repeat: "weekly" }), {
    now: NOW,
    activeGoalIds: ["goal-presentation"]
  });
  assert.ok(implicitWeekly.reasons.includes("recurrence_requires_explicit_intent"));
});

test("une heure locale déjà passée est résolue au lendemain", () => {
  const localNow = new Date(2026, 6, 23, 9, 0, 0, 0);
  const due = new Date(resolveWakeTime("08:30", localNow));
  assert.equal(due.getDate(), 24);
  assert.equal(due.getHours(), 8);
  assert.equal(due.getMinutes(), 30);
});

test("L4 ne crée aucune énergie avant l’échéance puis réinjecte une fois, de façon attribuée et bornée", () => {
  const nodes = [
    { id: "actor-nlr", nodeType: "actor", semanticType: "actor", citizen: true, clusterId: "wake" },
    { id: "space:mind-protocol:hall", nodeType: "space", semanticType: "context", clusterId: "wake" },
    { id: "goal-presentation", nodeType: "narrative", semanticType: "system_state", clusterId: "wake" },
    { id: "slide-outline", nodeType: "thing", semanticType: "context", clusterId: "wake" },
    { id: "active-note", nodeType: "narrative", semanticType: "context", clusterId: "wake" }
  ];
  const links = [
    { source: "actor-nlr", target: "space:mind-protocol:hall", type: "APPLIES_IN", physics: physical },
    { source: "space:mind-protocol:hall", target: "goal-presentation", type: "TARGETS", physics: physical },
    { source: "goal-presentation", target: "slide-outline", type: "USES_METHOD", physics: physical },
    { source: "slide-outline", target: "active-note", type: "LEADS_TO", physics: physical }
  ];
  const index = buildPhysicsIndex(nodes, links, []);
  const state = createState(index);
  const commitment = evaluateWakeProposal(proposal(), {
    now: NOW,
    activeGoalIds: ["goal-presentation"]
  });

  const early = deliverTemporalWake({
    commitment,
    state,
    index,
    now: new Date("2026-07-24T08:29:59.000Z")
  });
  assert.equal(early.status, "dormant");
  assert.equal(summarize(state, index).totalEnergy, 0);

  const due = deliverTemporalWake({
    commitment,
    state,
    index,
    now: new Date("2026-07-24T08:30:00.000Z"),
    amount: 1,
    maxReservoir: 1
  });
  assert.equal(due.status, "delivered");
  assert.ok(due.injected > 0 && due.injected <= 1);
  const flows = [...state.flows.values()].flatMap(bucket => [...bucket.values()]);
  assert.ok(flows.every(flow => flow.citizenId === "actor-nlr"));
  assert.ok(flows.every(flow => flow.originThingId === "thing-schedule-wake"));
  assert.ok(flows.every(flow => flow.flowKind === "temporal_wake"));

  const replay = deliverTemporalWake({
    commitment,
    state,
    index,
    now: new Date("2026-07-24T08:30:01.000Z")
  });
  assert.equal(replay.status, "already_delivered");
  assert.equal(replay.injected, 0);
});

test("une récurrence explicitement consentie calcule la prochaine occurrence sans la déclencher", () => {
  const approved = evaluateWakeProposal(proposal({
    repeat: "daily",
    recurrenceExplicit: true
  }), {
    now: NOW,
    activeGoalIds: ["goal-presentation"]
  });
  assert.equal(approved.eligible, true);
  const nodes = [
    { id: "actor-nlr", nodeType: "actor", semanticType: "actor", citizen: true, clusterId: "wake" },
    { id: "goal-presentation", nodeType: "narrative", semanticType: "system_state", clusterId: "wake" }
  ];
  const index = buildPhysicsIndex(nodes, [
    { source: "actor-nlr", target: "goal-presentation", type: "TARGETS", physics: physical }
  ], []);
  const result = deliverTemporalWake({
    commitment: approved,
    state: createState(index),
    index,
    now: new Date("2026-07-24T08:30:00.000Z")
  });
  assert.equal(result.nextDueAt, "2026-07-25T08:30:00.000Z");
});
