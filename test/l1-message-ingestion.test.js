import test from "node:test";
import assert from "node:assert/strict";
import { createConversationBlockTick, createConversationUtteranceTick, createLiveMessageTick } from "../src/l1-message-ingestion.js";
import { createMemoryMoment } from "../src/l1-subentities.js";

const now = () => "2026-07-23T18:00:00.000Z";

test("a live user message becomes a dated and placed Moment", () => {
  const tick = createLiveMessageTick({ conversationId: "thread-1", messageId: "msg-1", position: 4, content: "Bonjour" }, { now });
  assert.equal(tick.memory.occurredAt, now());
  assert.equal(tick.memory.metadata.timestampBasis, "server_received_at");
  assert.deepEqual(tick.memory.metadata.place, { kind: "conversation", conversationId: "thread-1", blockIndex: 4 });
  assert.equal(tick.memory.metadata.authorNodeId, "self-nlr");
});

test("an inbound Telegram message is an explicit human observation source", () => {
  const tick = createLiveMessageTick({
    conversationId: "telegram-chat-1",
    messageId: "telegram-message-1",
    position: 0,
    content: "Je travaille encore sur le L1",
    channel: "telegram",
    occurredAt: "2026-07-23T17:59:00Z"
  }, { now });
  assert.equal(tick.memory.metadata.sourceKind, "telegram_message");
  assert.equal(tick.memory.metadata.channel, "telegram");
  assert.equal(tick.memory.metadata.authorNodeId, "self-nlr");
  assert.equal(tick.memory.metadata.timestampBasis, "source_timestamp");
});

test("message identifiers and payloads produce stable idempotency keys", () => {
  const input = { conversationId: "thread-1", messageId: "msg-1", position: 4, content: "Bonjour", occurredAt: "2026-07-23T17:59:00Z" };
  assert.deepEqual(createLiveMessageTick(input, { now }), createLiveMessageTick(input, { now }));
  assert.notEqual(createLiveMessageTick(input, { now }).tickId, createLiveMessageTick({ ...input, content: "Texte corrigé" }, { now }).tickId);
});

test("a transport retry without a source timestamp keeps the same tick identity", () => {
  const input = { conversationId: "thread-1", messageId: "msg-retry", position: 6, content: "Une seule fois" };
  const first = createLiveMessageTick(input, { now: () => "2026-07-23T18:00:00Z" });
  const retry = createLiveMessageTick(input, { now: () => "2026-07-23T18:00:05Z" });
  assert.equal(first.tickId, retry.tickId);
  assert.notEqual(first.memory.occurredAt, retry.memory.occurredAt);
});

test("historical conversation ingestion requires one dated positioned block", () => {
  assert.throws(() => createConversationBlockTick("archive-1", { blockId: "b1", blockIndex: 0, speakerRole: "user", content: "Sans date" }, { now }), /occurredAt is required/);
  const tick = createConversationBlockTick("archive-1", { blockId: "b2", previousBlockId: "b1", blockIndex: 1, speakerRole: "assistant", occurredAt: "2025-01-02T03:04:05Z", content: "Réponse" }, { now });
  assert.equal(tick.memory.metadata.sourceKind, "conversation_import_block");
  assert.equal(tick.memory.metadata.authorNodeId, null);
  assert.match(tick.memory.metadata.previousMomentId, /^moment-conversation-block-/);
  assert.equal(tick.memory.metadata.assimilationStatus, "latent");
  assert.equal(tick.memory.metadata.experiencedByCitizen, false);
  assert.equal(tick.memory.metadata.segmentationUnit, "legacy_block");
});

test("archive utterances are indexed as latent memories without claiming assimilation", () => {
  const tick = createConversationUtteranceTick("archive-1", {
    utteranceId: "u2",
    previousUtteranceId: "u1",
    position: 1,
    speakerRole: "assistant",
    occurredAt: "2025-01-02T03:04:05Z",
    content: "Réponse exacte"
  }, { now });
  assert.equal(tick.memory.metadata.semanticType, "Utterance");
  assert.equal(tick.memory.metadata.sourceKind, "conversation_import_utterance");
  assert.equal(tick.memory.metadata.indexingStatus, "indexed");
  assert.equal(tick.memory.metadata.assimilationStatus, "latent");
  assert.equal(tick.memory.metadata.memoryState, "indexed");
  assert.equal(tick.memory.metadata.experiencedByCitizen, false);
  assert.equal(tick.memory.metadata.segmentationUnit, "utterance");
  assert.match(tick.memory.metadata.contentHash, /^[a-f0-9]{64}$/);
  assert.match(tick.memory.metadata.previousMomentId, /^moment-utterance-/);
});

test("Moment creation writes author and conversational placement relations", () => {
  const workspaceSnapshot = { id: "workspace-1", controllers: [{ subentityId: "subentity-captain", confidence: 0.8 }] };
  const tick = createLiveMessageTick({ conversationId: "thread-1", messageId: "msg-2", previousMessageId: "msg-1", position: 5, content: "Suite", workspaceSnapshot }, { now });
  const result = createMemoryMoment({ ...tick.memory, workspaceSnapshot: tick.workspaceSnapshot });
  assert.ok(result.relations.some(relation => relation.type === "AUTHORED_BY" && relation.target === "self-nlr"));
  assert.ok(result.relations.some(relation => relation.type === "FOLLOWS_IN_CONVERSATION" && relation.target === tick.memory.metadata.previousMomentId));
  assert.ok(result.relations.some(relation => relation.type === "CONTROLLED_WORKSPACE_DURING" && relation.source === "subentity-captain"));
});
