import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustQuestionPolicyForFocus, assignTasksToCitizens, buildPersonalWakePrompt, buildWakePrompt, collectTaskQueue,
  composeGlobalWorkspace, discoverCitizenCandidates, extractCitizenChoice, renderQuestionAgendaMarkdown,
  resolveCitizenTaskChoice, scoreTaskForCitizen
} from "../src/autonomous-agent-runtime.js";

const manifest = { graphs: [{ id: "design", status: "active", falkorGraph: "design_db" }] };

test("collects every task but selects only ready autonomous work", async () => {
  const graph = {
    async roQuery(query) {
      if (query.includes("properties(task)")) return { data: [
        { task: { id: "review", nodeType: "moment", semanticType: "task", workStatus: "proposed", autonomyMode: "review_required", priority: 100 } },
        { task: { id: "run", nodeType: "moment", semanticType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 50 } }
      ] };
      return { data: [] };
    }
  };
  const queue = await collectTaskQueue({ manifest, selectGraph: async () => graph, live: true, now: "2026-07-23T12:00:00Z" });
  assert.equal(queue.total, 2);
  assert.equal(queue.eligibleCount, 1);
  assert.equal(queue.nextTask.id, "run");
  assert.equal(queue.nextTask.graphId, "design");
});

test("the live queue selects the eligible task whose target is hottest", async () => {
  const graph = {
    async roQuery(query) {
      if (query.includes("properties(task)")) return { data: [
        { task: { id: "static-high", semanticType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 90 } },
        { task: { id: "heated", semanticType: "task", workStatus: "ready", autonomyMode: "autonomous", priority: 10, targetId: "orange" } }
      ] };
      return { data: [] };
    }
  };
  const queue = await collectTaskQueue({
    manifest,
    selectGraph: async () => graph,
    live: true,
    physicsState: { energy: { "source|TARGETS|orange": 6 } }
  });
  assert.equal(queue.nextTask.id, "heated");
  assert.equal(queue.nextTask.liveEnergy, 3);
});

test("the global workspace incorporates current physics and advances each wake", () => {
  const queue = {
    total: 1,
    eligibleCount: 1,
    tasks: [],
    nextTask: { id: "task", graphId: "design", name: "Task", summary: "Do it" }
  };
  const physicsState = {
    graphId: "design",
    summary: {
      tick: 12,
      totalEnergy: 3.5,
      byCluster: [{ cluster: "project-work", energy: 2 }],
      hottest: [{ link: "source|TARGETS|target" }]
    }
  };
  const first = composeGlobalWorkspace({ queue, physicsState, observedAt: "2026-07-23T12:00:00Z" });
  const second = composeGlobalWorkspace({ queue, physicsState, previousWorkspace: first, observedAt: "2026-07-23T12:05:00Z" });
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.deepEqual(first.activeNodeIds, ["task", "source", "target"]);
  assert.notEqual(first.contentHash, second.contentHash);
});

test("tasks are assigned to the best available citizen and each citizen receives at most one", () => {
  const queue = {
    tasks: [
      { id: "task-a", graphId: "design", clusterId: "alpha", eligible: true },
      { id: "task-b", graphId: "design", clusterId: "beta", eligible: true }
    ]
  };
  const physicsState = {
    summary: {
      byCitizen: [
        { citizenId: "citizen-alpha", energy: 1 },
        { citizenId: "citizen-beta", energy: 1 }
      ]
    },
    workspaceIntentRankings: {
      "citizen-alpha": [{ clusterId: "alpha", score: 0.9 }],
      "citizen-beta": [{ clusterId: "beta", score: 0.8 }]
    }
  };
  const plan = assignTasksToCitizens(queue, {
    physicsState,
    fallbackActorId: null,
    now: "2026-07-23T12:00:00Z"
  });
  assert.deepEqual(plan.assignments.map(item => [item.taskId, item.citizenId]), [
    ["task-a", "citizen-alpha"],
    ["task-b", "citizen-beta"]
  ]);
  assert.equal(new Set(plan.assignments.map(item => item.citizenId)).size, 2);
  assert.match(plan.assignments[0].leaseId, /^[a-f0-9]{20}$/);
});

test("an explicit citizen assignment is a hard routing constraint", () => {
  const queue = {
    tasks: [{
      id: "task-explicit",
      graphId: "design",
      clusterId: "alpha",
      assignedCitizenId: "citizen-low-energy",
      eligible: true
    }]
  };
  const physicsState = {
    summary: {
      byCitizen: [
        { citizenId: "citizen-high-energy", energy: 10 },
        { citizenId: "citizen-low-energy", energy: 1 }
      ]
    }
  };
  const plan = assignTasksToCitizens(queue, { physicsState, fallbackActorId: null });
  assert.equal(plan.assignments[0].citizenId, "citizen-low-energy");
  assert.equal(plan.assignments[0].factors.explicit, 1);
  assert.equal(plan.assignments[0].kind, "assigned");
  assert.equal(plan.assignments[0].provisional, false);
});

test("automatic routing is a declinable suggestion that exposes ranked alternatives", () => {
  const queue = {
    tasks: [
      { id: "task-a", graphId: "design", name: "A", summary: "Faire A", clusterId: "alpha", eligible: true },
      { id: "task-b", graphId: "design", name: "B", summary: "Faire B", clusterId: "beta", eligible: true }
    ]
  };
  const physicsState = {
    summary: { byCitizen: [{ citizenId: "citizen-solo", energy: 1 }] },
    workspaceIntentRankings: {
      "citizen-solo": [{ clusterId: "alpha", score: 0.9 }, { clusterId: "beta", score: 0.4 }]
    }
  };
  const plan = assignTasksToCitizens(queue, { physicsState, fallbackActorId: null, now: "2026-07-23T12:00:00Z" });
  const suggested = plan.assignments.find(item => item.taskId === "task-a");
  assert.equal(suggested.kind, "suggested");
  assert.equal(suggested.provisional, true);
  assert.deepEqual(suggested.alternatives.map(item => item.taskId), ["task-b"]);
  assert.ok(typeof suggested.alternatives[0].score === "number");

  const workspace = composeGlobalWorkspace({
    queue: { total: 2, eligibleCount: 2, tasks: queue.tasks, nextTask: suggested.task },
    assignment: suggested,
    observedAt: "2026-07-23T12:00:00Z"
  });
  assert.equal(workspace.activeAssignment.kind, "suggested");
  assert.equal(workspace.taskProposals.binding, false);
  assert.deepEqual(workspace.taskProposals.alternatives.map(item => item.taskId), ["task-b"]);
  assert.deepEqual(workspace.assignmentContract.requiredFields, ["chosenTaskId", "declined", "reason"]);

  const prompt = buildWakePrompt(workspace);
  assert.match(prompt, /SUGGESTION, pas un ordre/);
  assert.match(prompt, /décliner toute tâche/);
  assert.match(prompt, /chosenTaskId ou declined/);
});

test("an explicit human order stays imperative in the wake prompt", () => {
  const workspace = composeGlobalWorkspace({
    queue: { total: 1, eligibleCount: 1, tasks: [], nextTask: { id: "task-explicit", graphId: "design", name: "T", summary: "S" } },
    assignment: { taskId: "task-explicit", citizenId: "citizen-x", kind: "assigned", provisional: false, score: 5, factors: { explicit: 1 }, alternatives: [] },
    observedAt: "2026-07-23T12:00:00Z"
  });
  assert.equal(workspace.activeAssignment.kind, "assigned");
  assert.equal(workspace.taskProposals.binding, true);
  assert.equal(workspace.assignmentContract, null);
  const prompt = buildWakePrompt(workspace);
  assert.match(prompt, /Ordre humain explicite/);
  assert.doesNotMatch(prompt, /SUGGESTION, pas un ordre/);
});

test("a citizen choice is extracted from the last JSON block amid free prose", () => {
  const report = "Voici mon raisonnement {not: valid} puis un brouillon "
    + '{"chosenTaskId": "task-a", "declined": false} et enfin '
    + '{"chosenTaskId": "task-b", "declined": false, "reason": "plus proche"}';
  const choice = extractCitizenChoice(report);
  assert.equal(choice.chosenTaskId, "task-b");
  assert.equal(choice.reason, "plus proche");
  assert.equal(extractCitizenChoice("aucun json ici"), null);
});

test("accepting the suggestion confirms the provisional lease unchanged", () => {
  const resolution = resolveCitizenTaskChoice({
    activeAssignment: { kind: "suggested", citizenId: "citizen-x", taskId: "task-a", leaseId: "lease-a", leaseExpiresAt: "2026-07-23T12:10:00Z" },
    taskProposals: { suggested: { taskId: "task-a", graphId: "design" }, alternatives: [{ taskId: "task-b", graphId: "design" }] },
    reportText: '{"chosenTaskId": "task-a", "declined": false}'
  });
  assert.equal(resolution.status, "confirmed");
  assert.equal(resolution.taskId, "task-a");
  assert.equal(resolution.leaseId, "lease-a");
  assert.equal(resolution.leaseConfirmed, true);
});

test("switching to an alternative mints a fresh lease for the chosen task", () => {
  const resolution = resolveCitizenTaskChoice({
    activeAssignment: { kind: "suggested", citizenId: "citizen-x", taskId: "task-a", leaseId: "lease-a" },
    taskProposals: { suggested: { taskId: "task-a", graphId: "design" }, alternatives: [{ taskId: "task-b", graphId: "design" }] },
    reportText: '{"chosenTaskId": "task-b", "declined": false, "reason": "je préfère B"}',
    now: "2026-07-23T12:00:00Z"
  });
  assert.equal(resolution.status, "switched");
  assert.equal(resolution.taskId, "task-b");
  assert.notEqual(resolution.leaseId, "lease-a");
  assert.match(resolution.leaseId, /^[a-f0-9]{20}$/);
  assert.equal(resolution.leaseConfirmed, true);
});

test("declining releases the provisional lease and executes nothing", () => {
  const resolution = resolveCitizenTaskChoice({
    activeAssignment: { kind: "suggested", citizenId: "citizen-x", taskId: "task-a", leaseId: "lease-a" },
    taskProposals: { suggested: { taskId: "task-a", graphId: "design" }, alternatives: [] },
    reportText: '{"chosenTaskId": null, "declined": true, "reason": "je poursuis ma veille"}'
  });
  assert.equal(resolution.status, "declined");
  assert.equal(resolution.taskId, null);
  assert.equal(resolution.leaseId, null);
  assert.equal(resolution.leaseConfirmed, false);
});

test("no explicit or out-of-scope choice keeps the suggestion by default", () => {
  const noChoice = resolveCitizenTaskChoice({
    activeAssignment: { kind: "suggested", citizenId: "citizen-x", taskId: "task-a", leaseId: "lease-a" },
    taskProposals: { suggested: { taskId: "task-a", graphId: "design" }, alternatives: [{ taskId: "task-b", graphId: "design" }] },
    reportText: "j'ai travaillé sans rien déclarer"
  });
  assert.equal(noChoice.status, "defaulted");
  assert.equal(noChoice.taskId, "task-a");
  assert.equal(noChoice.leaseConfirmed, true);

  const outOfScope = resolveCitizenTaskChoice({
    activeAssignment: { kind: "suggested", citizenId: "citizen-x", taskId: "task-a", leaseId: "lease-a" },
    taskProposals: { suggested: { taskId: "task-a", graphId: "design" }, alternatives: [{ taskId: "task-b", graphId: "design" }] },
    reportText: '{"chosenTaskId": "task-ZZZ", "declined": false}'
  });
  assert.equal(outOfScope.status, "defaulted");
  assert.equal(outOfScope.taskId, "task-a");
});

test("a hard human order ignores the citizen choice and keeps its lease", () => {
  const resolution = resolveCitizenTaskChoice({
    activeAssignment: { kind: "assigned", citizenId: "citizen-x", taskId: "task-a", leaseId: "lease-a", leaseExpiresAt: "2026-07-23T12:10:00Z" },
    taskProposals: { suggested: { taskId: "task-a", graphId: "design" }, alternatives: [{ taskId: "task-b", graphId: "design" }] },
    reportText: '{"chosenTaskId": "task-b", "declined": true}'
  });
  assert.equal(resolution.status, "assigned");
  assert.equal(resolution.taskId, "task-a");
  assert.equal(resolution.leaseId, "lease-a");
  assert.equal(resolution.honoredChoice, false);
});

test("citizen discovery and scoring expose an explainable fallback", () => {
  const candidates = discoverCitizenCandidates({
    physicsState: { summary: { byCitizen: [{ citizenId: "citizen-a", energy: 2 }] } },
    fallbackActorId: "actor-nlr"
  });
  assert.deepEqual(candidates.map(candidate => candidate.citizenId), ["actor-nlr", "citizen-a"]);
  const match = scoreTaskForCitizen(
    { id: "task", graphId: "design", clusterId: "alpha" },
    { citizenId: "citizen-a", normalizedEnergy: 1, workspace: {}, intentRankings: [{ clusterId: "alpha", score: 0.5 }] }
  );
  assert.equal(match.eligible, true);
  assert.deepEqual(match.factors, { explicit: 0, continuity: 0, intent: 0.5, energy: 1, sameGraph: 0 });
});

test("an idle wake explicitly forbids mutations", () => {
  const workspace = composeGlobalWorkspace({
    queue: { total: 4, eligibleCount: 0, tasks: [{}, {}, {}, {}], nextTask: null },
    observedAt: "2026-07-23T12:00:00Z"
  });
  const prompt = buildWakePrompt(workspace);
  assert.equal(workspace.mode, "observe_only");
  assert.match(prompt, /N'effectue aucune mutation/);
  assert.match(prompt, /citoyen actor-nlr/);
});

test("cluster gaps become a typed autonomous question agenda", () => {
  const workspace = composeGlobalWorkspace({
    queue: { total: 0, eligibleCount: 0, tasks: [], nextTask: null },
    graphNodes: [{
      id: "goal",
      name: "Objectif incomplet",
      semanticType: "system_state",
      stateOrientation: "desirable",
      clusterId: "active"
    }],
    graphLinks: [],
    cortexState: "state-targeting-planning",
    affectVector: { frustration: 0.7 },
    questionPolicy: { maxQuestions: 2, totalEnergyBudget: 1, minimumPriority: 0 },
    observedAt: "2026-07-23T12:00:00Z"
  });
  const prompt = buildWakePrompt(workspace);
  assert.equal(workspace.mode, "answer_questions");
  assert.equal(workspace.questionAgenda.length, 2);
  assert.deepEqual(workspace.activeNodeIds, ["goal"]);
  assert.equal(workspace.questionBudget, 1);
  assert.match(prompt, /sans demander de validation humaine/);
  assert.match(prompt, /questionId, answer, confidence, supportingNodeIds, mutationsApplied et verification/);
  assert.match(prompt, /no_mutation/);
  assert.match(prompt, /## Agenda de questions du global workspace/);
  assert.match(prompt, /Toute réponse étayée doit être incluse dans le graphe/);
  assert.equal(workspace.outputContract.canonicalFormat, "json");
  assert.equal(workspace.outputContract.schemaVersion, "question-answer-v1");
  assert.match(renderQuestionAgendaMarkdown(workspace), /Relations autorisées/);
});

test("a persistent gap cools down and becomes exhausted instead of looping forever", () => {
  const input = {
    queue: { total: 0, eligibleCount: 0, tasks: [], nextTask: null },
    graphNodes: [{
      id: "question-loop",
      name: "Question persistante",
      semanticType: "open_question",
      clusterId: "active"
    }],
    graphLinks: [],
    questionPolicy: {
      maxQuestions: 1,
      totalEnergyBudget: 1,
      minimumPriority: 0,
      maxAttemptsPerGap: 3,
      cooldownVersions: 2
    }
  };
  const workspaces = [];
  for (let index = 0; index < 6; index += 1) {
    workspaces.push(composeGlobalWorkspace({ ...input, previousWorkspace: workspaces.at(-1) }));
  }
  assert.deepEqual(workspaces.map(workspace => workspace.questionAgenda.length), [1, 0, 1, 0, 1, 0]);
  assert.deepEqual(workspaces.filter(workspace => workspace.questionAgenda.length)
    .map(workspace => workspace.questionAgenda[0].loopControl.attempt), [1, 2, 3]);
  assert.equal(Object.values(workspaces[5].questionLedger)[0].status, "exhausted");
  assert.equal(workspaces[5].mode, "observe_only");
});

test("a structural change creates a new gap key and permits a fresh attempt", () => {
  const base = {
    queue: { total: 0, eligibleCount: 0, tasks: [], nextTask: null },
    graphNodes: [{
      id: "question-changing",
      semanticType: "open_question",
      clusterId: "active"
    }],
    graphLinks: [],
    questionPolicy: { maxQuestions: 1, totalEnergyBudget: 1, minimumPriority: 0, maxAttemptsPerGap: 1, cooldownVersions: 2 }
  };
  const first = composeGlobalWorkspace(base);
  const exhausted = composeGlobalWorkspace({ ...base, previousWorkspace: first });
  const changed = composeGlobalWorkspace({
    ...base,
    previousWorkspace: exhausted,
    graphLinks: [{ source: "question-changing", target: "context", type: "PART_OF" }]
  });
  assert.equal(exhausted.questionAgenda.length, 0);
  assert.equal(changed.questionAgenda.length, 1);
  assert.notEqual(changed.questionAgenda[0].gapKey, first.questionAgenda[0].gapKey);
  assert.notEqual(changed.questionAgenda[0].id, first.questionAgenda[0].id);
});

test("an exhausted leading gap releases its agenda slot to the next gap", () => {
  const base = {
    queue: { total: 0, eligibleCount: 0, tasks: [], nextTask: null },
    graphNodes: [
      { id: "goal-first", semanticType: "system_state", stateOrientation: "desirable", clusterId: "active" },
      { id: "question-next", semanticType: "open_question", clusterId: "active" }
    ],
    graphLinks: [],
    questionPolicy: { maxQuestions: 1, totalEnergyBudget: 1, minimumPriority: 0, maxAttemptsPerGap: 1, cooldownVersions: 2 }
  };
  const first = composeGlobalWorkspace(base);
  const second = composeGlobalWorkspace({ ...base, previousWorkspace: first });
  assert.equal(first.questionAgenda[0].gapType, "objective_without_measure");
  assert.notEqual(second.questionAgenda[0].gapKey, first.questionAgenda[0].gapKey);
  assert.equal(second.questionAgenda[0].gapType, "unresolved_question");
});

test("continuous inner-outer focus changes question count without changing its budget", () => {
  const graphNodes = Array.from({ length: 12 }, (_, index) => ({
    id: `question-focus-${index}`,
    semanticType: "open_question",
    clusterId: "active"
  }));
  const base = {
    queue: { total: 0, eligibleCount: 0, tasks: [], nextTask: null },
    graphNodes,
    graphLinks: [],
    questionPolicy: { maxQuestions: 4, totalEnergyBudget: 1, minimumPriority: 0 }
  };
  const inner = composeGlobalWorkspace({ ...base, innerOuterFocus: -1 });
  const balanced = composeGlobalWorkspace({ ...base, innerOuterFocus: 0 });
  const outer = composeGlobalWorkspace({ ...base, innerOuterFocus: 1 });
  assert.deepEqual([inner.questionAgenda.length, balanced.questionAgenda.length, outer.questionAgenda.length], [6, 4, 2]);
  assert.deepEqual([inner.questionBudget, balanced.questionBudget, outer.questionBudget], [1, 1, 1]);
  assert.deepEqual([inner.questionPolicy.focusMultiplier, balanced.questionPolicy.focusMultiplier, outer.questionPolicy.focusMultiplier], [1.5, 1, 0.5]);
  assert.equal(adjustQuestionPolicyForFocus(base.questionPolicy, -0.5).maxQuestions, 5);
});

test("the personal wake pursues sourced curiosity without action authority", () => {
  const prompt = buildPersonalWakePrompt({
    version: 3,
    physics: { hotClusters: [{ cluster: "human-valence", energy: 2 }] }
  }, "2026-07-23T12:15:00Z");
  assert.match(prompt, /autonomie de curiosité, pas d'une autonomie d'action/);
  assert.match(prompt, /web en direct/);
  assert.match(prompt, /sources primaires/);
  assert.match(prompt, /Ne modifie aucun fichier, graphe, compte ou état externe/);
  assert.match(prompt, /human-valence/);
});
