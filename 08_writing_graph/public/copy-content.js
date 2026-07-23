const visualNodeFields = new Set([
  "x", "y", "vx", "vy", "fx", "fy", "index", "width", "height", "radius",
  "titleLines", "phraseLines", "colorGroup"
]);

const visualLinkFields = new Set(["index"]);

const fieldLabels = {
  id: "Identifiant",
  name: "Nom",
  phrase: "Phrase",
  summary: "Résumé",
  nodeType: "Type technique",
  nodeTypeLabel: "Type",
  period: "Période",
  epistemicLabel: "Statut épistémique",
  epistemicStatus: "Statut épistémique technique",
  dateLabel: "Horizon",
  startYear: "Année de début",
  endYear: "Année de fin",
  region: "Région",
  family: "Famille",
  status: "Statut",
  phraseStatus: "Forme",
  context: "Contexte du terme",
  definition: "Définition",
  sourcePage: "Page source",
  sourceTitle: "Source",
  sourceUrl: "URL source",
  sourcePath: "Chemin source",
  sourceHash: "Empreinte SHA-256",
  documentSection: "Section",
  clusterId: "Cluster",
  forecastWindow: "Fenêtre",
  forecastConfidence: "Confiance",
  forecastSignals: "Signaux",
  forecastAssumptions: "Hypothèses",
  forecastImpact: "Impact",
  forecastResponse: "Réponse",
  hypothesisBasis: "Base",
  verificationNeeded: "À vérifier",
  questionCategory: "Catégorie",
  decisionNeeded: "Décision",
  decisionStatus: "Statut de décision",
  responsibleRole: "Responsable",
  decisionDue: "Échéance",
  chosenOptionId: "Option retenue",
  decisionRationale: "Justification de décision",
  reviewDate: "Date de révision",
  closureEvidence: "Preuve de clôture",
  optionCriteria: "Critères d’arbitrage",
  optionCode: "Code option",
  optionBenefits: "Bénéfices",
  optionRisks: "Risques",
  optionConditions: "Conditions",
  stateOrientation: "Orientation",
  valenceScore: "Valence humaine",
  humanValenceDelta: "Delta de valence humaine",
  stateDimension: "Dimension",
  stateIndicator: "Indicateur",
  type: "Type de relation",
  relationLabel: "Relation",
  relationStory: "Description",
  justification: "Justification du lien",
  relationQuality: "Qualité",
  relationFamily: "Famille",
  relationScope: "Portée",
  causalClaim: "Affirmation causale",
  canonicalPredicate: "Prédicat canonique",
  quantificationStatus: "Quantification",
  note: "Note"
};

function isContentValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function displayValue(value) {
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") return value.id || JSON.stringify(value);
  return String(value);
}

function readableLabel(key) {
  return fieldLabels[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());
}

function contentEntries(item, excludedFields) {
  return Object.entries(item)
    .filter(([key, value]) => !excludedFields.has(key) && isContentValue(value))
    .map(([key, value]) => [readableLabel(key), displayValue(value)]);
}

function markdownFields(item, excludedFields, omittedFields = new Set()) {
  return contentEntries(item, excludedFields)
    .filter(([label]) => !omittedFields.has(label))
    .map(([label, value]) => `- **${label} :** ${value}`)
    .join("\n");
}

export function serializeNodeContent(node) {
  if (!node) return "";
  const fields = markdownFields(node, visualNodeFields, new Set(["Nom"]));
  return [`# ${node.name || node.id || "Nœud"}`, fields].filter(Boolean).join("\n\n");
}

export function serializeClusterContent(cluster) {
  if (!cluster) return "";
  const nodes = cluster.nodes || [];
  const links = cluster.links || [];
  const names = new Map(nodes.map(node => [node.id, node.name || node.id]));
  const nodeSections = nodes.map(node => serializeNodeContent(node).replace(/^# /, "## "));
  const relationSections = links.map(link => {
    const sourceId = typeof link.source === "object" ? link.source.id : link.source;
    const targetId = typeof link.target === "object" ? link.target.id : link.target;
    const heading = `### ${names.get(sourceId) || sourceId} → ${names.get(targetId) || targetId}`;
    const fields = markdownFields(link, new Set([...visualLinkFields, "source", "target"]));
    return [heading, fields].filter(Boolean).join("\n\n");
  });

  return [
    `# Cluster (${nodes.length} nœuds, ${links.length} relations)`,
    "## Nœuds",
    nodeSections.join("\n\n---\n\n"),
    "## Relations",
    relationSections.length ? relationSections.join("\n\n") : "Aucune relation."
  ].join("\n\n");
}
