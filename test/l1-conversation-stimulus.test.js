import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationStimulus,
  formatConversationStimulus,
  stimulateConversationBlock
} from "../src/l1-conversation-stimulus.js";
import { createLocalEmbedder } from "../src/local-embedding.js";
import { EMPTY_SUBENTITY_RUNTIME_STATE } from "../src/l1-subentity-runtime.js";

const baseArgs = {
  graphId: "l1-nlr-ai",
  conversationId: "choice-conversation",
  blockId: "block-001",
  content: "Je dois choisir entre la sécurité familiale et une nouvelle aventure.",
  sourceArtifact: "choix-de-vie-complexe.txt",
  sourceLocator: "block:1",
  consentId: "consent-human-1",
  speakerRole: "human",
  occurredAt: "2026-07-23T12:00:00Z",
  timestampBasis: "source",
  recordedAt: "2026-07-23T12:05:00Z"
};

test("conversation block becomes a stable, provenance-preserving stimulus", async () => {
  const nodes = [
    { id: "memory-family", name: "Sécurité familiale et choix de vie" },
    { id: "memory-unrelated", name: "Réparer une base de données" }
  ];
  const first = await buildConversationStimulus(baseArgs, {
    l1Nodes: nodes,
    embed: createLocalEmbedder()
  });
  const replay = await buildConversationStimulus(baseArgs, {
    l1Nodes: nodes,
    embed: createLocalEmbedder()
  });
  assert.equal(first.stimulus.id, replay.stimulus.id);
  assert.equal(first.stimulus.consentId, "consent-human-1");
  assert.equal(first.stimulus.epistemicStatus, "reported");
  assert.ok(first.routing.transfers.some(transfer => transfer.targetNodeId === "memory-family"));
  assert.equal(first.embedding.identityInferenceAllowed, false);
});

test("dry-run executes bounded ticks and returns the Global Workspace without persistence", async () => {
  let applyCalls = 0;
  const result = await stimulateConversationBlock(baseArgs, {
    resolveGraph: async () => ({
      config: { id: "l1-nlr-ai", falkorGraph: "nlr_ai" },
      graph: {}
    }),
    readState: async () => ({ state: structuredClone(EMPTY_SUBENTITY_RUNTIME_STATE) }),
    readNodes: async () => [{ id: "choice", name: "Choix sécurité familiale aventure" }],
    applyStable: async () => {
      applyCalls += 1;
      throw new Error("apply must not run");
    }
  });
  assert.equal(applyCalls, 0);
  assert.equal(result.persisted, false);
  assert.equal(result.runtimeReport.stopReason, "stable");
  assert.ok(result.workspace.activeNodeIds.includes("choice"));
  assert.equal(result.safeguards.directSemanticLinksCreated, 0);
  assert.equal(result.safeguards.embeddingCannotEstablishIdentity, true);
  assert.match(formatConversationStimulus(result), /Simulation seulement/);
});

test("persistence requires explicit apply and still creates no semantic identity link", async () => {
  let receivedInput = null;
  const result = await stimulateConversationBlock({ ...baseArgs, apply: true }, {
    resolveGraph: async () => ({
      config: { id: "l1-nlr-ai", falkorGraph: "nlr_ai" },
      graph: { id: "fake" }
    }),
    readState: async () => ({ state: structuredClone(EMPTY_SUBENTITY_RUNTIME_STATE) }),
    readNodes: async () => [{ id: "person-similar", name: "Personne famille aventure" }],
    applyStable: async args => {
      receivedInput = args.input;
      return {
        persisted: true,
        workspace: {
          id: "workspace-applied",
          controllerId: "candidate",
          characterBudget: 1200,
          usedCharacters: 100,
          slots: [{ nodeIds: ["person-similar"], goalIds: [] }]
        },
        stabilization: { stopReason: "stable", history: [] },
        report: { microTickCount: 2, stopReason: "stable" }
      };
    }
  });
  assert.equal(result.persisted, true);
  assert.equal(receivedInput.observationId, result.stimulus.id);
  assert.equal(result.safeguards.directSemanticLinksCreated, 0);
  assert.equal(result.safeguards.runtimeRelationsOnly, true);
});
