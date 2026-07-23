// La donnée fait autorité : aucun inventaire de districts ne vit dans l'UI.
// Ajouter un cluster au graphe suffit pour le faire apparaître dans le sélecteur.

function normalizedClusterId(node) {
  return typeof node?.clusterId === "string" ? node.clusterId : "";
}

export function clusterLabel(clusterId, nodes = []) {
  if (!clusterId) {
    const protocol = nodes.find((node) =>
      normalizedClusterId(node) === "" && (node.semanticType || node.nodeType) === "protocol" && node.name);
    return protocol?.name || "Vision globale de Mind Protocol";
  }

  const words = clusterId.split(/[-_]+/u).filter(Boolean);
  if (!words.length) return clusterId;
  const label = words.join(" ");
  return label.charAt(0).toLocaleUpperCase("fr") + label.slice(1);
}

export function clusterOptions(nodes = []) {
  const counts = new Map();
  for (const node of nodes) {
    const id = normalizedClusterId(node);
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  return [...counts]
    .map(([value, count]) => ({ value, count, label: clusterLabel(value, nodes) }))
    .sort((a, b) => {
      if (a.value === "") return -1;
      if (b.value === "") return 1;
      return a.label.localeCompare(b.label, "fr");
    });
}
