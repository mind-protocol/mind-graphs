/**
  * Moteur de promotion L2 (Organisation & Design) -> L4 (Protocol Registry & Kernel).
  * 
  * Gère le cycle de ratification :
  * DesignProposal (L2) -> Prototype -> ValidationSuite -> ValidationResult -> DesignDecision -> ProtocolPromotionRequest -> L4RegistryEntry (L4)
  */

export function createPromotionRequest({
  decisionId,
  title,
  summary,
  targetL4Type = "L4RegistryEntry",
  schemaVersion = "1.0.0",
  author
}) {
  if (!decisionId || !title) throw new Error("A promotion request requires a decisionId and a title.");

  const timestamp = new Date().toISOString();
  return {
    id: `promotion-${decisionId.replace(/^decision-/, "")}`,
    nodeType: "thing",
    semanticType: "ProtocolPromotionRequest",
    title,
    summary: summary || title,
    decisionId,
    targetL4Type,
    schemaVersion,
    status: "proposed",
    author: author || "l2-mind-governance",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function ratifyPromotionToL4(request, { ratifiedBy = "mind-protocol-council", l4Version = "1.2.0" } = {}) {
  if (!request || request.status !== "proposed") {
    throw new Error("Only a proposed ProtocolPromotionRequest can be ratified to L4.");
  }

  const timestamp = new Date().toISOString();
  const registryEntry = {
    id: `l4-entry-${request.id.replace(/^promotion-/, "")}`,
    nodeType: "thing",
    semanticType: "L4RegistryEntry",
    title: request.title,
    summary: request.summary,
    version: l4Version,
    schemaVersion: request.schemaVersion,
    status: "active",
    ratifiedBy,
    ratifiedAt: timestamp,
    justifiedByDecisionId: request.decisionId
  };

  return {
    ratifiedRequest: {
      ...request,
      status: "ratified",
      promotedAt: timestamp,
      l4EntryId: registryEntry.id
    },
    registryEntry,
    link: {
      source: registryEntry.id,
      target: request.decisionId,
      type: "JUSTIFIED_BY",
      justification: "Cette entrée canonique L4 est formellement justifiée par la décision d'organisation L2."
    }
  };
}
