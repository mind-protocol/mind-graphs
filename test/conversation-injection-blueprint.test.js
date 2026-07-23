import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const blueprintPath = new URL("../data/conversation-injection-blueprint.json", import.meta.url);

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

test("conversation ingestion makes encounter response precede mission projections", async () => {
  const { nodes, links } = indexBlueprint(await loadBlueprint());
  const encounter = nodes.get("mech-ci-citizen-encounter-response");

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
