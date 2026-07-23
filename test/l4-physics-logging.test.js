import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPhysicsIndex, createState, injectAtNode, propagate, relax, tickActor,
  createPhysicsLogger, formatPhysicsEvent, citizenPumps
} from "../src/l4-physics.js";

const PROFILES = [
  { source: "FEEDS", polarity: [0.9, 0.2], permanence: 0.6, mode: "axis_dominant" },
  { source: "IMPLEMENTS", polarity: [0.9, 0.45], permanence: 0.8, mode: "composite" },
  { source: "BLOCKS", polarity: [-0.8, 0], permanence: 0.7, mode: "composite" }
];

const NODES = [
  { id: "A1", nodeType: "actor", semanticType: "actor", citizen: true, weight: 2, clusterId: "c1" },
  { id: "SUB1", nodeType: "actor", semanticType: "subentity", subentity: true, weight: 1.5, clusterId: "c1" },
  { id: "M1", nodeType: "moment", semanticType: "mechanism", clusterId: "c1" },
  { id: "X1", nodeType: "space", semanticType: "system_state", clusterId: "c1" }
];

const LINKS = [
  { source: "A1", target: "M1", type: "FEEDS" },
  { source: "SUB1", target: "M1", type: "FEEDS" },
  { source: "M1", target: "X1", type: "IMPLEMENTS" }
];

test("citizenPumps detects citizens and subentities", () => {
  const pumps = citizenPumps(NODES);
  assert.equal(pumps.length, 2);
  assert.equal(pumps.some(p => p.id === "A1"), true);
  assert.equal(pumps.some(p => p.id === "SUB1"), true);
});

test("createPhysicsLogger captures events and formats output", () => {
  const logger = createPhysicsLogger();
  logger.emit({
    type: "ACTOR_ACTIVATION",
    actorId: "A1",
    nodeType: "actor",
    semanticType: "actor",
    amount: 2.0,
    weight: 2
  });
  logger.emit({
    type: "SUBENTITY_ACTIVATION",
    actorId: "SUB1",
    nodeType: "actor",
    semanticType: "subentity",
    amount: 1.5,
    weight: 1.5
  });

  const summary = logger.getLogSummary();
  assert.equal(summary.totalEvents, 2);
  assert.equal(summary.activations, 2);

  const formattedActor = formatPhysicsEvent(logger.events[0]);
  assert.ok(formattedActor.includes("[PHYSICS:ACTOR]"));
  assert.ok(formattedActor.includes('Acteur "A1"'));

  const formattedSubentity = formatPhysicsEvent(logger.events[1]);
  assert.ok(formattedSubentity.includes("[PHYSICS:SUBENTITY]"));
  assert.ok(formattedSubentity.includes('Acteur "SUB1"'));
});

test("tickActor with verbose options emits activations and transfers", () => {
  const index = buildPhysicsIndex(NODES, LINKS, PROFILES);
  const state = createState(index);

  const events = [];
  const logger = createPhysicsLogger({
    onEvent: event => events.push(event)
  });

  tickActor(state, index, "A1", { logger });

  assert.ok(events.length > 0, "should emit physics events");
  const activations = events.filter(e => e.type === "ACTOR_ACTIVATION");
  assert.ok(activations.length >= 1, "should contain actor activation");
  assert.equal(activations[0].actorId, "A1");

  const relaxations = events.filter(e => e.type === "RELAXATION");
  assert.equal(relaxations.length, 1, "should contain relaxation event");
});
