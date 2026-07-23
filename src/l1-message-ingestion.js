import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(String(value), "utf8").digest("hex");
const requiredText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value;
};
const stableMomentId = (kind, conversationId, externalId) =>
  `moment-${kind}-${hash(`${conversationId}\u0000${externalId}`).slice(0, 24)}`;
const stableConversationSpaceId = conversationId =>
  `space-conversation-${hash(conversationId).slice(0, 24)}`;
const validPosition = value => Number.isInteger(Number(value)) && Number(value) >= 0;
const isoDate = (value, field) => {
  requiredText(value, field);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO date.`);
  return new Date(value).toISOString();
};

function lifecycleInput({ kind, conversationId, externalId, position, content, occurredAt, ingestedAt, speakerRole, previousMomentId = null, authorNodeId = null, channel = null, timestampBasis, workspaceSnapshot = {} }) {
  const momentId = stableMomentId(kind, conversationId, externalId);
  const timestampIdentity = timestampBasis === "server_received_at" ? null : occurredAt;
  const canonical = JSON.stringify({ conversationId, externalId, position, content, occurredAt: timestampIdentity, speakerRole, previousMomentId, authorNodeId, channel, workspaceSnapshot });
  const sourceKind = kind === "message"
    ? String(channel || "").toLowerCase() === "telegram" ? "telegram_message" : "live_message"
    : kind === "utterance" ? "conversation_import_utterance" : "conversation_import_block";
  return {
    tickId: `ingest-${momentId}-${hash(canonical).slice(0, 16)}`,
    recordedAt: ingestedAt,
    candidates: [],
    workspaceSnapshot,
    memory: {
      id: momentId,
      occurredAt,
      content,
      metadata: {
        claimNature: "message_moment",
        semanticType: "Utterance",
        sourceKind,
        sourceMessageId: externalId,
        conversationId,
        conversationSpaceId: stableConversationSpaceId(conversationId),
        conversationPosition: Number(position),
        speakerRole,
        authorNodeId,
        previousMomentId,
        channel,
        ingestedAt,
        timestampBasis,
        contentHash: hash(content),
        indexingStatus: "indexed",
        assimilationStatus: kind === "message" ? "present" : "latent",
        memoryState: kind === "message" ? "active" : "indexed",
        experiencedByCitizen: kind === "message",
        segmentationUnit: kind === "utterance" ? "utterance" : kind === "conversation-block" ? "legacy_block" : "live_message",
        place: { kind: "conversation", conversationId, blockIndex: Number(position) }
      }
    }
  };
}

export function createLiveMessageTick(payload, { now = () => new Date().toISOString() } = {}) {
  const conversationId = requiredText(payload?.conversationId, "conversationId");
  const messageId = requiredText(payload?.messageId, "messageId");
  const content = requiredText(payload?.content, "content");
  if (!validPosition(payload?.position)) throw new Error("position must be a non-negative integer.");
  const ingestedAt = new Date(now()).toISOString();
  const occurredAt = payload.occurredAt ? isoDate(payload.occurredAt, "occurredAt") : ingestedAt;
  return lifecycleInput({
    kind: "message",
    conversationId,
    externalId: messageId,
    position: payload.position,
    content,
    occurredAt,
    ingestedAt,
    speakerRole: "user",
    previousMomentId: payload.previousMessageId ? stableMomentId("message", conversationId, payload.previousMessageId) : null,
    authorNodeId: "self-nlr",
    channel: payload.channel || null,
    timestampBasis: payload.occurredAt ? "source_timestamp" : "server_received_at",
    workspaceSnapshot: payload.workspaceSnapshot || {}
  });
}

export function createConversationBlockTick(conversationIdValue, payload, { now = () => new Date().toISOString() } = {}) {
  const conversationId = requiredText(conversationIdValue, "conversationId");
  const blockId = requiredText(payload?.blockId, "blockId");
  const content = requiredText(payload?.content, "content");
  const speakerRole = requiredText(payload?.speakerRole, "speakerRole");
  if (!new Set(["user", "assistant", "system", "tool"]).has(speakerRole)) throw new Error("speakerRole must be user, assistant, system or tool.");
  if (!validPosition(payload?.blockIndex)) throw new Error("blockIndex must be a non-negative integer.");
  const occurredAt = isoDate(payload?.occurredAt, "occurredAt");
  const ingestedAt = new Date(now()).toISOString();
  return lifecycleInput({
    kind: "conversation-block",
    conversationId,
    externalId: blockId,
    position: payload.blockIndex,
    content,
    occurredAt,
    ingestedAt,
    speakerRole,
    previousMomentId: payload.previousBlockId ? stableMomentId("conversation-block", conversationId, payload.previousBlockId) : null,
    authorNodeId: payload.authorNodeId || (speakerRole === "user" ? "self-nlr" : null),
    channel: payload.channel || null,
    timestampBasis: "source_timestamp",
    workspaceSnapshot: payload.workspaceSnapshot || {}
  });
}

export function createConversationUtteranceTick(conversationIdValue, payload, { now = () => new Date().toISOString() } = {}) {
  const conversationId = requiredText(conversationIdValue, "conversationId");
  const utteranceId = requiredText(payload?.utteranceId, "utteranceId");
  const content = requiredText(payload?.content, "content");
  const speakerRole = requiredText(payload?.speakerRole, "speakerRole");
  if (!new Set(["user", "assistant", "system", "tool"]).has(speakerRole)) throw new Error("speakerRole must be user, assistant, system or tool.");
  if (!validPosition(payload?.position)) throw new Error("position must be a non-negative integer.");
  const occurredAt = isoDate(payload?.occurredAt, "occurredAt");
  const ingestedAt = new Date(now()).toISOString();
  return lifecycleInput({
    kind: "utterance",
    conversationId,
    externalId: utteranceId,
    position: payload.position,
    content,
    occurredAt,
    ingestedAt,
    speakerRole,
    previousMomentId: payload.previousUtteranceId ? stableMomentId("utterance", conversationId, payload.previousUtteranceId) : null,
    authorNodeId: payload.authorNodeId || (speakerRole === "user" ? "self-nlr" : null),
    channel: payload.channel || null,
    timestampBasis: "source_timestamp",
    workspaceSnapshot: payload.workspaceSnapshot || {}
  });
}

export { stableConversationSpaceId, stableMomentId };
