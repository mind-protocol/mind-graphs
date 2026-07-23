function sentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export function buildRelationJustification(link, sourceName, targetName, relationType = {}) {
  const authored = link.justification || link.story || link.logic;
  if (String(authored || "").trim()) return sentence(authored);

  const label = relationType.label || link.relationLabel || link.type;
  const direction = relationType.direction || `${sourceName} → ${targetName}`;
  const scope = relationType.scope || "non qualifiée";
  const causalNature = relationType.causalClaim
    ? "Elle porte une affirmation causale qui reste à justifier empiriquement."
    : "Elle décrit une structure ou une proposition sans affirmer à elle seule une causalité.";
  return `${sourceName} « ${label} » ${targetName}. Nature précise : ${direction}. Portée : ${scope}. ${causalNature}`;
}
