function idOf(value) {
  return typeof value === "object" ? value?.id : value;
}

function isProvenance(link) {
  return link.type === "DERIVED_FROM" || link.relationScope === "provenance";
}

function representativePrior(node) {
  const name = String(node.name || "").toLocaleLowerCase("fr");
  if (node.nodeType === "protocol") return 100;
  if (/^thèse|^doctrine|^mission/.test(name)) return 90;
  if (/^endgame|^vision/.test(name)) return 75;
  if (node.nodeType === "institution") return 60;
  if (node.nodeType === "axiom") return 55;
  if (node.nodeType === "working_hypothesis") return 50;
  if (node.nodeType === "source_document") return 5;
  return 30;
}

export function buildOverviewNodeIds(nodes, links, representatives, hierarchyChildren, maxNodes = 32) {
  const visible = new Set(representatives.values());
  hierarchyChildren.forEach((_children, parentId) => visible.add(parentId));
  const childIds = new Set([...hierarchyChildren.values()].flatMap(children => [...children]));
  const degree = new Map(nodes.map(node => [node.id, 0]));
  links.filter(link => !isProvenance(link)).forEach(link => {
    degree.set(idOf(link.source), (degree.get(idOf(link.source)) || 0) + 1);
    degree.set(idOf(link.target), (degree.get(idOf(link.target)) || 0) + 1);
  });
  const candidates = nodes.filter(node => !node.clusterId && node.nodeType !== "source_document" && !childIds.has(node.id)).sort((a, b) => {
    const scoreA = representativePrior(a) + (degree.get(a.id) || 0) * 4;
    const scoreB = representativePrior(b) + (degree.get(b.id) || 0) * 4;
    return scoreB - scoreA || a.id.localeCompare(b.id);
  });
  for (const node of candidates) {
    if (visible.size >= maxNodes) break;
    visible.add(node.id);
  }
  return visible;
}

export function neighborhoodNodeIds(nodes, links, focusNodeId, maxNodes = 42, maxDepth = 2) {
  const knownIds = new Set(nodes.map(node => node.id));
  const visible = new Set(knownIds.has(focusNodeId) ? [focusNodeId] : []);
  let frontier = new Set(visible);
  const semanticLinks = links.filter(link => !isProvenance(link));
  for (let depth = 0; depth < maxDepth && frontier.size && visible.size < maxNodes; depth += 1) {
    const candidates = new Map();
    semanticLinks.forEach(link => {
      const source = idOf(link.source);
      const target = idOf(link.target);
      const weight = Number.isFinite(Number(link.traversalWeight)) ? Number(link.traversalWeight) : 0.5;
      if (frontier.has(source) && !visible.has(target)) candidates.set(target, Math.max(candidates.get(target) || 0, weight));
      if (frontier.has(target) && !visible.has(source)) candidates.set(source, Math.max(candidates.get(source) || 0, weight * 0.9));
    });
    const next = [...candidates].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxNodes - visible.size).map(([id]) => id);
    next.forEach(id => visible.add(id));
    frontier = new Set(next);
  }
  return visible;
}

export function buildClusterRepresentatives(nodes, links) {
  const groups = new Map();
  nodes.forEach(node => {
    if (!node.clusterId) return;
    if (!groups.has(node.clusterId)) groups.set(node.clusterId, []);
    groups.get(node.clusterId).push(node);
  });
  const semanticDegree = new Map(nodes.map(node => [node.id, 0]));
  links.filter(link => !isProvenance(link)).forEach(link => {
    const source = idOf(link.source);
    const target = idOf(link.target);
    semanticDegree.set(source, (semanticDegree.get(source) || 0) + 1);
    semanticDegree.set(target, (semanticDegree.get(target) || 0) + 1);
  });
  const representatives = new Map();
  groups.forEach((members, clusterId) => {
    const memberIds = new Set(members.map(node => node.id));
    const representative = [...members].sort((a, b) => {
      const aInternalDegree = links.filter(link => !isProvenance(link) && memberIds.has(idOf(link.source)) && memberIds.has(idOf(link.target)) && [idOf(link.source), idOf(link.target)].includes(a.id)).length;
      const bInternalDegree = links.filter(link => !isProvenance(link) && memberIds.has(idOf(link.source)) && memberIds.has(idOf(link.target)) && [idOf(link.source), idOf(link.target)].includes(b.id)).length;
      const scoreDifference = representativePrior(b) + bInternalDegree * 2 - representativePrior(a) - aInternalDegree * 2;
      return scoreDifference || (semanticDegree.get(b.id) || 0) - (semanticDegree.get(a.id) || 0) || a.id.localeCompare(b.id);
    })[0];
    representatives.set(clusterId, representative.id);
  });
  return representatives;
}

export function buildHierarchyChildren(links) {
  const children = new Map();
  links.filter(link => ["PART_OF", "SUBCASE_OF"].includes(link.type)).forEach(link => {
    const parent = idOf(link.target);
    const child = idOf(link.source);
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent).add(child);
  });
  return children;
}

export function navigationNodeIds(nodes, links, options = {}) {
  const representatives = options.representatives || buildClusterRepresentatives(nodes, links);
  const hierarchyChildren = options.hierarchyChildren || buildHierarchyChildren(links);
  const expandedIds = options.expandedIds || new Set();
  let visible;
  if (options.scope === "cluster" && options.clusterId) {
    visible = new Set(nodes.filter(node => node.clusterId === options.clusterId).map(node => node.id));
  } else if (options.scope === "neighborhood" && options.focusNodeId) {
    visible = neighborhoodNodeIds(nodes, links, options.focusNodeId, options.maxNodes, options.maxDepth);
  } else {
    const representativeIds = new Set(representatives.values());
    visible = new Set(options.overviewIds || buildOverviewNodeIds(nodes, links, representatives, hierarchyChildren, options.maxNodes));
    hierarchyChildren.forEach((children, parentId) => {
      if (expandedIds.has(parentId)) {
        children.forEach(childId => visible.add(childId));
        return;
      }
      children.forEach(childId => {
        if (!representativeIds.has(childId)) visible.delete(childId);
      });
    });
  }
  return visible;
}

export function clusterSize(nodes, clusterId) {
  return nodes.filter(node => node.clusterId === clusterId).length;
}
