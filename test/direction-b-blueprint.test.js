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

test("Direction B pre-indexing and manual block reader decision pipeline", async () => {
  const { nodes, links } = indexBlueprint(await loadBlueprint());

  const decisionB = nodes.get("decision-ci-direction-b-preindex-then-read");
  assert.ok(decisionB, "Direction B decision node must exist");
  assert.equal(decisionB.decisionStatus, "approved");
  assert.equal(decisionB.chosenOptionId, "option-ci-direction-b-conversation-card");

  const indexCard = nodes.get("thing-ci-conversation-index-card");
  assert.ok(indexCard, "ConversationIndexCard component must exist");
  assert.ok(indexCard.cardContract.forbiddenMeanings.includes("experiencedByCitizen"));
  assert.ok(indexCard.cardContract.forbiddenMeanings.includes("assimilated"));
  assert.ok(indexCard.cardContract.forbiddenMeanings.includes("human_trait"));

  const weightCalc = nodes.get("thing-ci-conversation-weight-calculator");
  assert.ok(weightCalc, "ConversationWeightCalculator component must exist");
  assert.match(weightCalc.weightContract.energyRule, /never forces current workspace activation/);

  const entityExtractor = nodes.get("thing-ci-entity-candidate-extractor");
  assert.ok(entityExtractor, "EntityCandidateExtractor must exist");
  assert.equal(entityExtractor.candidateContract.automaticCreation, "forbidden");
  assert.equal(entityExtractor.candidateContract.automaticMerge, "forbidden");

  const blockReader = nodes.get("thing-ci-agentic-block-reader");
  assert.ok(blockReader, "AgenticConversationReader must exist");
  assert.ok(blockReader.readerContract.allowedOutputs.includes("no_write"));

  const mvpTask = nodes.get("task-ci-direction-b-mvp");
  assert.ok(mvpTask, "Task Direction B MVP must exist");
  assert.equal(mvpTask.workStatus, "ready");
  assert.equal(mvpTask.priority, 98);

  assert.ok(hasLink(links, "decision-ci-direction-b-preindex-then-read", "decision-ci-latent-memory-first", "REFINES"));
  assert.ok(hasLink(links, "thing-ci-conversation-index-card", "decision-ci-direction-b-preindex-then-read", "IMPLEMENTS"));
  assert.ok(hasLink(links, "task-ci-direction-b-mvp", "decision-ci-direction-b-preindex-then-read", "IMPLEMENTS"));
});
