import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const blueprintPath = new URL("../data/conversation-injection-blueprint.json", import.meta.url);
const interpretedFixturePath = new URL(
  "../l1/data/conversation-choix-de-vie-complexe-block-001-citizen-cluster.json",
  import.meta.url
);

async function loadBlueprint() {
  return JSON.parse(await readFile(blueprintPath, "utf8"));
}

function indexBlueprint(blueprint) {
  return {
    nodes: new Map(blueprint.nodes.map(node => [node.id, node])),
    links: blueprint.links
  };
}

function hasLink(links, source, target, type) {
  return links.some(link =>
    link.source === source &&
    link.target === target &&
    link.type === type
  );
}

test("latent-first is the selected ingestion path and encounter-first remains historical", async () => {
  const { nodes, links } = indexBlueprint(await loadBlueprint());
  const decision = nodes.get("decision-ci-latent-memory-first");
  const legacyTask = nodes.get("task-conversation-injection");
  const recallTask = nodes.get("task-ci-autobiographical-recall-mvp");
  const encounter = nodes.get("mech-ci-citizen-encounter-response");

  assert.equal(decision.decisionStatus, "approved");
  assert.equal(decision.chosenOptionId, "option-ci-latent-memory-first");
  assert.ok(decision.supersedesNodeIds.includes(encounter.id));
  assert.equal(encounter.lifecycleStatus, "superseded");
  assert.equal(encounter.supersededBy, decision.id);
  assert.equal(nodes.get("mech-ci-block-segmentation").lifecycleStatus, "superseded");
  assert.equal(nodes.get("mech-ci-block-atoms").lifecycleStatus, "superseded");
  assert.equal(legacyTask.workStatus, "superseded");
  assert.equal(legacyTask.supersededBy, recallTask.id);
  assert.equal(recallTask.workStatus, "ready");
  assert.ok(hasLink(
    links,
    "thing-ci-autobiographical-recall-engine",
    decision.id,
    "IMPLEMENTS"
  ));

  // The former contract remains inspectable so historical encounter clusters
  // can be audited without making it the active ingestion path.
  assert.ok(encounter);
  const encounterContract = encounter.encounterResponseContract;
  for (const facet of [
    "functional_reaction",
    "evocation",
    "empathic_hypothesis",
    "curiosity",
    "care_concern",
    "ambition",
    "idea"
  ]) {
    assert.ok(encounterContract.possibleFacets.includes(facet));
  }
  assert.ok(hasLink(
    links,
    "mech-ci-global-workspace-return",
    "mech-ci-citizen-encounter-response",
    "LEADS_TO"
  ));
  assert.ok(hasLink(
    links,
    "mech-ci-citizen-encounter-response",
    "mech-ci-block-atoms",
    "LEADS_TO"
  ));
  assert.equal(hasLink(
    links,
    "mech-ci-global-workspace-return",
    "mech-ci-block-atoms",
    "LEADS_TO"
  ), false);

  for (const missionId of [
    "mech-ci-mission-psych-profile",
    "mech-ci-mission-situation",
    "mech-ci-mission-objectives-prefs",
    "mech-ci-mission-financial"
  ]) {
    assert.ok(hasLink(links, "mech-ci-block-atoms", missionId, "LEADS_TO"));
  }
});

test("encounter response preserves authorship and epistemic boundaries", async () => {
  const { nodes } = indexBlueprint(await loadBlueprint());
  const encounter = nodes.get("mech-ci-citizen-encounter-response");
  const empathy = nodes.get("mech-ci-empathic-person-model");
  const shape = nodes.get("mech-ci-shape-audit");

  for (const field of [
    "authoredByCitizen",
    "triggeringEvidence",
    "workspaceSnapshotId",
    "epistemicStatus",
    "alternativesOrBoundary"
  ]) {
    assert.ok(encounter.encounterResponseContract.requiredForEachTrace.includes(field));
  }
  assert.ok(encounter.encounterResponseContract.forbiddenConversions.includes(
    "citizen reaction becomes human trait"
  ));
  assert.ok(encounter.encounterResponseContract.forbiddenConversions.includes(
    "idea becomes human commitment"
  ));
  for (const field of ["evidence", "alternatives", "falsifier"]) {
    assert.ok(empathy.hypothesisContract.required.includes(field));
  }
  assert.equal(shape.shapeContract.encounterResponse.requiredAuthorship, "Citizen AI");
});

test("valuable curiosity becomes bounded discovery work before completion", async () => {
  const { nodes, links } = indexBlueprint(await loadBlueprint());
  const curiosity = nodes.get("mech-ci-curiosity-task-loop");
  const completion = nodes.get("mech-ci-explicit-completion");
  const quality = nodes.get("mech-ci-quality-vector");

  for (const step of [
    "existing graph",
    "adjacent consented source",
    "non-sensitive observation",
    "precise human question"
  ]) {
    assert.ok(curiosity.curiosityContract.resolutionOrder.includes(step));
  }
  assert.ok(curiosity.curiosityContract.required.includes("stopCondition"));
  assert.ok(completion.completionContract.complete_sparse.some(rule =>
    rule.includes("high-value curiosities")
  ));
  assert.ok("curiosityConversion" in quality.qualityVector);
  assert.ok("empathicHonesty" in quality.qualityVector);
  assert.ok(hasLink(
    links,
    "verif-ci-curiosity-task-conversion",
    "mech-ci-curiosity-task-loop",
    "TESTS"
  ));
});

test("historical encounter reactions remain auditable and attributed to the live controller", async () => {
  const { nodes } = indexBlueprint(await loadBlueprint());
  const encounter = nodes.get("mech-ci-citizen-encounter-response");
  const shape = nodes.get("mech-ci-shape-audit");
  const task = nodes.get("task-conversation-injection");
  const contract = encounter.encounterResponseContract;
  const affect = contract.affectAppraisalContract;
  const controller = contract.activeControllerLinkContract;

  assert.match(contract.reactionAtomicityRule, /un nœud citizen_reaction par réaction/);
  assert.match(contract.overAggregationGap, /reaction_overaggregated/);
  assert.deepEqual(Object.keys(affect.dimensions), [
    "valence",
    "arousal",
    "perceivedControl",
    "uncertainty",
    "novelty",
    "careSalience"
  ]);
  assert.equal(affect.dimensions.valence[0], -1);
  assert.equal(affect.dimensions.arousal[1], 1);
  assert.equal(controller.relation, "CONTROLLED_WORKSPACE_DURING");
  assert.match(controller.causalBoundary, /ne vaut ni GENERATED_BY/);
  assert.equal(
    shape.shapeContract.encounterResponse.requiredRuntimeRelationWhenControllerObserved,
    "CONTROLLED_WORKSPACE_DURING"
  );
  assert.ok(task.acceptanceCriteria.some(criterion =>
    criterion.includes("plusieurs nœuds citizen_reaction")
  ));
  assert.ok(task.acceptanceCriteria.some(criterion =>
    criterion.includes("sous-entité active")
  ));
});

test("the historical four-mission contract remains available for legacy cluster audits", async () => {
  const { nodes } = indexBlueprint(await loadBlueprint());
  const missions = nodes.get("mech-ci-shape-audit").shapeContract.missions;
  const task = nodes.get("task-conversation-injection");

  assert.equal(
    missions.cardinality,
    "exactly_one_distinct_projection_node_per_mission_per_block"
  );
  assert.deepEqual(missions.requiredKeys, [
    "psychology",
    "situation",
    "objectives_preferences",
    "financial"
  ]);
  for (const field of [
    "missionKey",
    "resolutionState",
    "analysis",
    "evidence",
    "hypotheses",
    "unknowns",
    "nextValidation"
  ]) {
    assert.ok(missions.requiredFields.includes(field));
  }
  assert.match(missions.hypothesisRule, /alternatives/);
  assert.match(missions.unknownConversionRule, /tâche bornée/);
  assert.ok(task.acceptanceCriteria.some(criterion =>
    criterion.includes("un nœud de projection distinct")
  ));
});

test("the legacy fixture is preserved as an experienced encounter with explicit migration metadata", async () => {
  const fixture = JSON.parse(await readFile(interpretedFixturePath, "utf8"));
  const missionNodes = fixture.nodes.filter(node => node.claimNature === "mission_projection");
  const missionKeys = missionNodes.map(node => node.missionKey).sort();

  assert.deepEqual(missionKeys, [
    "financial",
    "objectives_preferences",
    "psychology",
    "situation"
  ]);
  for (const mission of missionNodes) {
    for (const field of [
      "resolutionState",
      "analysis",
      "evidence",
      "hypotheses",
      "unknowns",
      "nextValidation"
    ]) {
      assert.ok(field in mission, `${mission.id} lacks ${field}`);
    }
  }

  const discoveryTask = fixture.nodes.find(node =>
    node.id === "objective-citizen-block-001-recover-context"
  );
  assert.equal(discoveryTask.claimNature, "discovery_task");
  assert.match(discoveryTask.phrase, /référent de « elle »/);
  assert.ok(fixture.links.some(link =>
    link.source === "memory-citizen-block-001-mission-situation"
    && link.target === discoveryTask.id
    && link.type === "DESCRIBES"
  ));
  assert.equal(fixture.provenance.ingestionGeneration, "encounter_first_legacy");
  assert.equal(fixture.provenance.assimilationStatus, "legacy_assimilated");
  assert.equal(fixture.provenance.experiencedByCitizen, true);
});
