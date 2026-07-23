function section(title, value) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "";
  const content = Array.isArray(value) ? value.map(item => `- ${item}`).join("\n") : String(value);
  return `### ${title}\n${content}\n`;
}

function numberedSection(title, values) {
  if (!values?.length) return "";
  return `### ${title}\n${values.map((value, index) => `${index + 1}. ${value}`).join("\n")}\n`;
}

export function serializeRecommendations(recommendations, metadata = {}) {
  const header = [
    "# Recommandations de l’analyse du graphe Mind Protocol",
    "",
    "Merci d’adresser ces recommandations par ordre de priorité. Pour chacune : vérifier le diagnostic dans le graphe, proposer ou appliquer la correction, puis indiquer les critères de clôture satisfaits.",
    "",
    `- Recommandations : ${recommendations.length}`,
    metadata.methodVersion ? `- Méthode : ${metadata.methodVersion}` : null,
    metadata.nodeCount != null ? `- Instantané : ${metadata.nodeCount} nœuds · ${metadata.linkCount} relations` : null,
    ""
  ].filter(value => value != null).join("\n");

  const body = recommendations.map((item, index) => {
    const identity = [
      `- Rang : ${index + 1}`,
      `- Priorité : ${item.priority}`,
      `- Sévérité : ${item.severity}`,
      `- Catégorie : ${item.categoryLabel || item.category}`,
      item.nodeId ? `- Nœud principal : ${item.nodeId}` : null,
      item.clusters?.length ? `- Clusters : ${item.clusters.join(", ")}` : null,
      item.documents?.length ? `- Documents : ${item.documents.join(", ")}` : null,
      item.relatedEdgeCount != null ? `- Relations concernées : ${item.relatedEdgeCount}` : null
    ].filter(Boolean).join("\n");
    const metrics = item.metrics?.map(metric => `${metric.label} : ${metric.value}`) || [];

    return [
      `## ${index + 1}. ${item.title}`,
      identity,
      "",
      section("Problème", item.problem),
      section("Signaux de priorité", item.prioritySignals),
      section("Constat algorithmique", item.summary),
      section("Diagnostic", item.diagnosis),
      section("Métriques", metrics),
      section("Pourquoi agir", item.why),
      section("Risque si rien ne change", item.risk),
      section("Contexte observé", item.context),
      section("Causes possibles à vérifier", item.probableCauses),
      numberedSection("Plan d’action proposé", item.steps),
      section("Modification proposée du graphe", item.graphPatch ? `\`${item.graphPatch}\`` : ""),
      section("Critères de clôture", item.closureCriteria),
      section("Questions de revue", item.reviewQuestions)
    ].filter(Boolean).join("\n").trim();
  }).join("\n\n---\n\n");

  return `${header}${body}\n`;
}
