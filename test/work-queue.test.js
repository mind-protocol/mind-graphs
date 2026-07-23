import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskQueue, eligibleAutonomousTasks, nextAutonomousTask, nodeEnergyFromPhysicsState } from "../src/work-queue.js";

test("the autonomous queue selects the highest-priority eligible task", () => {
  const nodes = [
    { id: "done", nodeType: "task", workStatus: "done", autonomyMode: "autonomous", priority: 10 },
    { id: "high", nodeType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 90 },
    { id: "low", nodeType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 50 },
    { id: "review", nodeType: "task", workStatus: "ready", autonomyMode: "review_required", priority: 100 }
  ];
  const links = [{ source: "high", target: "done", type: "DEPENDS_ON" }];
  assert.deepEqual(eligibleAutonomousTasks(nodes, links).map(task => task.id), ["high", "low"]);
  assert.equal(nextAutonomousTask(nodes, links).id, "high");
});

test("an unfinished dependency blocks an otherwise ready task", () => {
  const nodes = [
    { id: "prerequisite", nodeType: "task", workStatus: "in_progress", autonomyMode: "autonomous", priority: 40 },
    { id: "dependent", nodeType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 90 }
  ];
  assert.equal(nextAutonomousTask(nodes, [{ source: "dependent", target: "prerequisite", type: "DEPENDS_ON" }]), null);
});

test("the queue includes graph-native semantic tasks while keeping governance reasons", () => {
  const queue = buildTaskQueue([
    { id: "ready", nodeType: "moment", semanticType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 10 },
    { id: "review", nodeType: "moment", semanticType: "task", workStatus: "proposed", autonomyMode: "review_required", priority: 20 }
  ], []);
  assert.deepEqual(queue.map(task => task.id), ["review", "ready"]);
  assert.equal(queue.find(task => task.id === "ready").eligible, true);
  assert.deepEqual(queue.find(task => task.id === "review").queueReasons, ["status:proposed", "autonomy:review_required"]);
});

test("live attributed energy outranks a static priority without bypassing eligibility", () => {
  const nodes = [
    { id: "static-high", semanticType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 90 },
    { id: "heated", semanticType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 10, targetId: "orange" },
    { id: "forbidden", semanticType: "task", workStatus: "proposed", autonomyMode: "review_required", priority: 100, targetId: "hot" }
  ];
  const energyByNode = nodeEnergyFromPhysicsState({
    energy: {
      "source|TARGETS|orange": 4,
      "source|TARGETS|hot": 20
    }
  });
  const queue = buildTaskQueue(nodes, [], { energyByNode });
  assert.deepEqual(queue.map(task => task.id), ["forbidden", "heated", "static-high"]);
  assert.equal(nextAutonomousTask(nodes, [], { energyByNode }).id, "heated");
  assert.equal(queue[0].eligible, false);
});
