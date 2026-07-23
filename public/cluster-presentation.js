export const PRESENTATION_ALGORITHM_VERSION = "1.1.0";

export const RELATION_FAMILY_WEIGHTS = Object.freeze({
  enablement: 0.75,
  normative: 0.8,
  causal: 0.9,
  flow: 0.75,
  scenario: 0.7,
  design_reasoning: 0.85,
  validation: 0.8,
  communication: 0.5,
  evidence: 0.95,
  hierarchy: 0.95,
  contextual: 0.85,
  workflow: 0.9
});

const TYPE_TO_FAMILY = Object.freeze({
  UNLOCKS: "enablement",
  GROUNDS: "normative", SAFEGUARDS: "normative", IMPLEMENTS: "normative",
  LEADS_TO: "causal", CAUSES: "causal",
  CONVERGES_IN: "flow", FEEDS: "flow",
  MAKES_PLAUSIBLE: "scenario", SCENARIO_LEADS_TO: "scenario", PRESSURES: "scenario",
  MITIGATES: "scenario", AFFECTS_SCENARIO: "scenario",
  MOTIVATES: "design_reasoning", ASSUMES: "design_reasoning",
  BLOCKS: "design_reasoning", ADDRESSES: "design_reasoning",
  TESTS: "validation", USES_METHOD: "validation", MEASURES: "validation",
  COMMUNICATES: "communication",
  DERIVED_FROM: "evidence", SUPPORTS_ESTIMATE: "evidence", CONTRADICTS: "evidence",
  OBSERVES: "evidence", PRODUCES: "evidence", USES_DATASET: "evidence",
  PART_OF: "hierarchy", SUBCASE_OF: "hierarchy", APPLIES_IN: "contextual",
  OPTION_FOR: "design_reasoning", RECOMMENDS: "design_reasoning",
  PROMOTES_TO: "workflow", TARGETS: "workflow", DEPENDS_ON: "workflow", DOCUMENTS_PROGRESS: "workflow"
});

export const RELATION_VERBS = Object.freeze({
  UNLOCKS: "débloque",
  GROUNDS: "fonde", SAFEGUARDS: "protège", IMPLEMENTS: "met en œuvre",
  LEADS_TO: "conduit à", CAUSES: "cause",
  CONVERGES_IN: "converge vers", FEEDS: "alimente",
  MAKES_PLAUSIBLE: "rend plausible", SCENARIO_LEADS_TO: "mène, dans ce scénario, à",
  PRESSURES: "met sous pression", MITIGATES: "atténue", AFFECTS_SCENARIO: "influence le scénario de",
  MOTIVATES: "motive", ASSUMES: "suppose",
  BLOCKS: "bloque", ADDRESSES: "répond à",
  TESTS: "met à l’épreuve", USES_METHOD: "utilise la méthode", MEASURES: "mesure",
  COMMUNICATES: "met en récit",
  DERIVED_FROM: "provient de", SUPPORTS_ESTIMATE: "étaye l’estimation",
  CONTRADICTS: "contredit", OBSERVES: "observe", PRODUCES: "produit", USES_DATASET: "utilise le jeu de données",
  PART_OF: "fait partie de", SUBCASE_OF: "est un sous-cas de", APPLIES_IN: "s’applique dans",
  OPTION_FOR: "est une option pour", RECOMMENDS: "recommande",
  PROMOTES_TO: "fait progresser vers", TARGETS: "cible", DEPENDS_ON: "dépend de", DOCUMENTS_PROGRESS: "documente la progression de"
});

const ROLE_PHASE = Object.freeze({
  context: 0,
  vision: 1,
  problem: 2,
  target: 3,
  thesis: 4,
  foundation: 5,
  mechanism: 6,
  effect: 7,
  human: 8,
  governance: 9,
  validation: 10,
  bridge: 11,
  source: 12
});

const ROLE_LABELS = Object.freeze({
  context: "Contexte",
  vision: "Horizon",
  problem: "Tensions à résoudre",
  target: "Objectifs",
  thesis: "Thèse directrice",
  foundation: "Principes et fondations",
  mechanism: "Éléments et mécanismes",
  effect: "Effets et conséquences",
  human: "Interaction humaine",
  governance: "Gouvernance et garde-fous",
  validation: "Validation et roadmap",
  bridge: "Ponts vers d’autres domaines",
  source: "Provenance"
});

const ROLE_PRIORS = Object.freeze({
  protocol: 1,
  claim: 0.9,
  working_hypothesis: 0.9,
  system_state: 0.92,
  design_effect: 0.92,
  axiom: 0.86,
  horizon: 0.88,
  forecast_event: 0.72,
  open_question: 0.84,
  estimate: 0.86,
  observation: 0.78,
  experiment: 0.8,
  metric: 0.76,
  method: 0.76,
  context: 0.66,
  dataset: 0.64,
  source_document: 0.15,
  institution: 0.72,
  mechanism: 0.74,
  economic_mechanism: 0.74,
  unlock: 0.76,
  design_rationale: 0.72,
  decision: 0.86,
  decision_option: 0.78,
  idea: 0.68,
  task: 0.72,
  change: 0.7
});

function idOf(value) {
  return typeof value === "object" ? value?.id : value;
}

function canonicalType(link) {
  return link.canonicalPredicate || link.type;
}

function relationFamily(link) {
  return link.relationFamily || TYPE_TO_FAMILY[link.type] || TYPE_TO_FAMILY[canonicalType(link)] || "design_reasoning";
}

function relationWeight(link) {
  const declared = Number(link.traversalWeight);
  if (Number.isFinite(declared)) return Math.max(0, Math.min(1, declared));
  return RELATION_FAMILY_WEIGHTS[relationFamily(link)] ?? 0.5;
}

function isProvenance(link) {
  return link.type === "DERIVED_FROM" || link.relationScope === "provenance";
}

function normalizeMap(values) {
  const maximum = Math.max(0, ...values.values());
  return new Map([...values].map(([id, value]) => [id, maximum ? value / maximum : 0]));
}

function dominantCluster(nodes, focusNode) {
  if (focusNode?.clusterId) return focusNode.clusterId;
  const counts = new Map();
  nodes.forEach(node => {
    if (node.clusterId) counts.set(node.clusterId, (counts.get(node.clusterId) || 0) + 1);
  });
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))[0]?.[0] || "cluster";
}

function weightedDegrees(nodeIds, links) {
  const degree = new Map(nodeIds.map(id => [id, 0]));
  const incoming = new Map(nodeIds.map(id => [id, 0]));
  links.forEach(link => {
    const source = idOf(link.source);
    const target = idOf(link.target);
    const weight = relationWeight(link);
    degree.set(source, (degree.get(source) || 0) + weight);
    degree.set(target, (degree.get(target) || 0) + weight);
    incoming.set(target, (incoming.get(target) || 0) + weight);
  });
  return { degree: normalizeMap(degree), convergence: normalizeMap(incoming) };
}

function pageRank(nodeIds, links, iterations = 28, damping = 0.85) {
  const size = Math.max(1, nodeIds.length);
  const outgoing = new Map(nodeIds.map(id => [id, []]));
  links.forEach(link => outgoing.get(idOf(link.source))?.push(link));
  let rank = new Map(nodeIds.map(id => [id, 1 / size]));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Map(nodeIds.map(id => [id, (1 - damping) / size]));
    let dangling = 0;
    nodeIds.forEach(id => {
      const edges = outgoing.get(id);
      if (!edges.length) {
        dangling += rank.get(id);
        return;
      }
      const total = edges.reduce((sum, edge) => sum + relationWeight(edge), 0) || edges.length;
      edges.forEach(edge => {
        const target = idOf(edge.target);
        next.set(target, next.get(target) + damping * rank.get(id) * relationWeight(edge) / total);
      });
    });
    nodeIds.forEach(id => next.set(id, next.get(id) + damping * dangling / size));
    rank = next;
  }
  return normalizeMap(rank);
}

function betweenness(nodeIds, links) {
  const adjacency = new Map(nodeIds.map(id => [id, new Set()]));
  links.forEach(link => {
    const source = idOf(link.source);
    const target = idOf(link.target);
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  });
  const centrality = new Map(nodeIds.map(id => [id, 0]));
  nodeIds.forEach(start => {
    const stack = [];
    const predecessors = new Map(nodeIds.map(id => [id, []]));
    const paths = new Map(nodeIds.map(id => [id, 0]));
    const distance = new Map(nodeIds.map(id => [id, -1]));
    paths.set(start, 1);
    distance.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      stack.push(current);
      adjacency.get(current).forEach(next => {
        if (distance.get(next) < 0) {
          queue.push(next);
          distance.set(next, distance.get(current) + 1);
        }
        if (distance.get(next) === distance.get(current) + 1) {
          paths.set(next, paths.get(next) + paths.get(current));
          predecessors.get(next).push(current);
        }
      });
    }
    const dependency = new Map(nodeIds.map(id => [id, 0]));
    while (stack.length) {
      const current = stack.pop();
      predecessors.get(current).forEach(previous => {
        const share = paths.get(current) ? paths.get(previous) / paths.get(current) : 0;
        dependency.set(previous, dependency.get(previous) + share * (1 + dependency.get(current)));
      });
      if (current !== start) centrality.set(current, centrality.get(current) + dependency.get(current));
    }
  });
  return normalizeMap(new Map([...centrality].map(([id, value]) => [id, value / 2])));
}

function downstreamReach(nodeIds, links) {
  const adjacency = new Map(nodeIds.map(id => [id, []]));
  links.forEach(link => adjacency.get(idOf(link.source))?.push(idOf(link.target)));
  const reach = new Map();
  nodeIds.forEach(start => {
    const visited = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      adjacency.get(current).forEach(next => {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      });
    }
    reach.set(start, nodeIds.length > 1 ? (visited.size - 1) / (nodeIds.length - 1) : 0);
  });
  return reach;
}

function evidenceScore(node, incomingLinks) {
  let score = node.epistemicStatus === "observed" ? 0.85
    : node.epistemicStatus === "documented" ? 0.65
    : node.epistemicStatus === "refuted" || node.epistemicStatus === "superseded" ? 0.7 : 0.35;
  if (node.quantificationStatus && node.quantificationStatus !== "unquantified") score += 0.1;
  if (incomingLinks.some(link => ["SUPPORTS_ESTIMATE", "OBSERVES", "PRODUCES"].includes(canonicalType(link)))) score += 0.15;
  return Math.min(1, score);
}

function specificityScore(node) {
  const fields = [node.summary, node.stateIndicator, node.metricId, node.methodId, node.contextId, node.populationOrSystem];
  return fields.filter(Boolean).length / fields.length;
}

function cleanName(name = "") {
  return name.replace(/^[^·]{1,32}·\s*/, "").trim() || name;
}

function classifyRole(node, metrics, links, mainCluster) {
  if (node.nodeType === "source_document") return "source";
  if (node.clusterId && mainCluster && node.clusterId !== mainCluster) return "bridge";
  const name = node.name.toLocaleLowerCase("fr");
  const outgoing = links.filter(link => idOf(link.source) === node.id).map(canonicalType);
  const incoming = links.filter(link => idOf(link.target) === node.id).map(canonicalType);
  if (node.nodeType === "context") return "context";
  if (["target", "test_target"].includes(node.epistemicStatus) || /objectif|cible|résultat recherché/.test(name)) return "target";
  if (node.nodeType === "open_question" || node.epistemicStatus === "unresolved" || /risque|problème|tension|blocage/.test(name)) return "problem";
  if (node.nodeType === "horizon" || /^endgame|vision|horizon/.test(name)) return "vision";
  if (["design_effect", "forecast_event"].includes(node.nodeType)
    || (node.nodeType === "system_state" && incoming.some(type => ["CAUSES", "LEADS_TO", "SCENARIO_LEADS_TO", "PRODUCES"].includes(type)))) return "effect";
  if (node.nodeType === "system_state") return "target";
  if (/thèse|mission/.test(name) || (node.nodeType === "protocol" && metrics.convergence > 0.2)) return "thesis";
  if (/principe|primitive|contrat|noyau/.test(name) || ["claim", "metric", "method", "context", "estimate"].includes(node.nodeType)) return "foundation";
  if (outgoing.includes("TESTS") || node.nodeType === "experiment" || /pilote|roadmap|expérience/.test(name)) return "validation";
  if (["task", "change"].includes(node.nodeType)) return "validation";
  if (["decision", "decision_option"].includes(node.nodeType) || outgoing.includes("SAFEGUARDS") || /garde-fou|gouvernance|audit/.test(name)) return "governance";
  if (/interface|commentaire humain|flotte d'agents|participation/.test(name)) return "human";
  return "mechanism";
}

function stronglyConnectedComponents(nodeIds, links) {
  const adjacency = new Map(nodeIds.map(id => [id, []]));
  links.forEach(link => adjacency.get(idOf(link.source))?.push(idOf(link.target)));
  let index = 0;
  const indices = new Map();
  const low = new Map();
  const stack = [];
  const stacked = new Set();
  const components = [];
  function visit(id) {
    indices.set(id, index);
    low.set(id, index);
    index += 1;
    stack.push(id);
    stacked.add(id);
    adjacency.get(id).forEach(next => {
      if (!indices.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id), low.get(next)));
      } else if (stacked.has(next)) {
        low.set(id, Math.min(low.get(id), indices.get(next)));
      }
    });
    if (low.get(id) === indices.get(id)) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        stacked.delete(current);
        component.push(current);
      } while (current !== id);
      if (component.length > 1) components.push(component);
    }
  }
  nodeIds.forEach(id => { if (!indices.has(id)) visit(id); });
  return components;
}

function buildPatterns(nodes, semanticLinks, provenanceLinks, scoreById, roleById, mainCluster) {
  const patterns = [];
  const addPattern = (type, label, patternLinks, explicitNodeIds = []) => {
    const nodeIds = [...new Set([
      ...explicitNodeIds,
      ...patternLinks.flatMap(link => [idOf(link.source), idOf(link.target)])
    ])].filter(id => scoreById.has(id));
    if (!nodeIds.length) return;
    const averageNode = nodeIds.reduce((sum, id) => sum + scoreById.get(id), 0) / nodeIds.length;
    const averageEdge = patternLinks.length ? patternLinks.reduce((sum, link) => sum + relationWeight(link), 0) / patternLinks.length : 0.5;
    const coverage = nodeIds.length / Math.max(1, nodes.length);
    const roleCount = new Set(nodeIds.map(id => roleById.get(id))).size;
    const coherence = 1 / Math.max(1, roleCount);
    let importance = 0.45 * averageNode + 0.25 * averageEdge + 0.2 * coverage + 0.1 * coherence;
    if (type === "provenance") importance *= 0.35;
    patterns.push({
      id: `${type}-${patterns.length + 1}`,
      type,
      label,
      nodeIds,
      relationTypes: [...new Set(patternLinks.map(link => canonicalType(link)))],
      confidence: Number(Math.min(1, 0.55 + patternLinks.length * 0.08).toFixed(3)),
      importance: Number(importance.toFixed(3))
    });
  };

  const byTypes = types => semanticLinks.filter(link => types.includes(canonicalType(link)));
  addPattern("foundation", "Fondations et garde-fous", byTypes(["GROUNDS", "SAFEGUARDS"]));
  addPattern("implementation", "Convergence vers une proposition centrale", byTypes(["IMPLEMENTS", "CONVERGES_IN"]));
  addPattern("validation", "Mise à l’épreuve", byTypes(["TESTS", "PRODUCES", "OBSERVES", "SUPPORTS_ESTIMATE"]));
  addPattern("flow", "Boucle de signaux et de ressources", byTypes(["FEEDS"]));
  addPattern("tension", "Tensions, blocages et réponses", byTypes(["BLOCKS", "CONTRADICTS", "ADDRESSES"]));
  stronglyConnectedComponents(nodes.map(node => node.id), semanticLinks)
    .forEach(component => addPattern("feedback_loop", "Boucle de rétroaction structurelle", [], component));
  const bridgeIds = nodes.filter(node => node.clusterId && node.clusterId !== mainCluster).map(node => node.id);
  addPattern("bridge", "Ponts inter-clusters", [], bridgeIds);
  addPattern("provenance", "Provenance documentaire", provenanceLinks, nodes.filter(node => node.nodeType === "source_document").map(node => node.id));

  return patterns.sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id));
}

function precedenceOrder(nodes, semanticLinks, roleById, scoreById) {
  const ids = new Set(nodes.map(node => node.id));
  const incoming = new Map(nodes.map(node => [node.id, new Set()]));
  const outgoing = new Map(nodes.map(node => [node.id, new Set()]));
  const reverseForNarrative = new Set(["IMPLEMENTS", "SAFEGUARDS", "TESTS", "COMMUNICATES", "SUPPORTS_ESTIMATE", "OBSERVES", "USES_METHOD", "MEASURES", "PART_OF", "SUBCASE_OF", "APPLIES_IN"]);
  semanticLinks.forEach(link => {
    let before = idOf(link.source);
    let after = idOf(link.target);
    if (reverseForNarrative.has(canonicalType(link))) [before, after] = [after, before];
    if (!ids.has(before) || !ids.has(after) || before === after) return;
    outgoing.get(before).add(after);
    incoming.get(after).add(before);
  });
  const remaining = new Set(ids);
  const ordered = [];
  const compare = (a, b) => {
    const phase = ROLE_PHASE[roleById.get(a)] - ROLE_PHASE[roleById.get(b)];
    if (phase) return phase;
    const score = scoreById.get(b) - scoreById.get(a);
    if (score) return score;
    return a.localeCompare(b);
  };
  while (remaining.size) {
    let available = [...remaining].filter(id => [...incoming.get(id)].every(parent => !remaining.has(parent)));
    if (!available.length) available = [...remaining];
    available.sort(compare);
    const next = available[0];
    ordered.push(next);
    remaining.delete(next);
  }
  return ordered;
}

function describeNode(node) {
  const phrase = String(node.phrase || "").trim();
  const summary = String(node.summary || "").trim();
  if (!summary || phrase.includes(summary) || summary.includes(phrase)) return phrase || summary;
  return `${phrase}${/[.!?]$/.test(phrase) ? "" : "."} ${summary}`;
}

function presentationTitle(nodes, mainCluster) {
  const source = nodes.find(node => node.nodeType === "source_document" && node.clusterId === mainCluster)
    || nodes.find(node => node.nodeType === "source_document");
  if (source) return cleanName(source.name);
  return mainCluster.split("-").map(word => word.charAt(0).toLocaleUpperCase("fr") + word.slice(1)).join(" ");
}

function buildSections(nodes, orderedIds, roleById, scoreById) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const sections = [];
  Object.entries(ROLE_PHASE).sort((a, b) => a[1] - b[1]).forEach(([role]) => {
    const sectionNodes = orderedIds.filter(id => roleById.get(id) === role).map(id => byId.get(id));
    if (!sectionNodes.length) return;
    sections.push({
      id: role,
      heading: ROLE_LABELS[role],
      nodeIds: sectionNodes.map(node => node.id),
      importance: Number(Math.max(...sectionNodes.map(node => scoreById.get(node.id))).toFixed(3)),
      paragraphs: sectionNodes.map(describeNode).filter(Boolean),
      items: sectionNodes.map(node => ({
        nodeId: node.id,
        title: cleanName(node.name),
        body: describeNode(node),
        importance: Number(scoreById.get(node.id).toFixed(3))
      })).filter(item => item.body)
    });
  });
  return sections;
}

export function translateRelation(link, nodesById) {
  const sourceId = idOf(link.source);
  const targetId = idOf(link.target);
  const source = nodesById.get(sourceId);
  const target = nodesById.get(targetId);
  const type = canonicalType(link);
  const verb = RELATION_VERBS[type] || String(type || "relie à").toLocaleLowerCase("fr").replaceAll("_", " ");
  const sourceName = cleanName(source?.name || sourceId || "Source");
  const targetName = cleanName(target?.name || targetId || "Cible");
  return { sourceId, targetId, sourceName, targetName, type, verb, sentence: `${sourceName} ${verb} ${targetName}.` };
}

function buildRelationNarratives(nodes, links, scoreById, orderedIds) {
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const position = new Map(orderedIds.map((id, index) => [id, index]));
  const narratives = links.map((link, stableIndex) => {
    const translated = translateRelation(link, nodesById);
    const rawImportance = 0.55 * relationWeight(link)
      + 0.225 * (scoreById.get(translated.sourceId) || 0)
      + 0.225 * (scoreById.get(translated.targetId) || 0);
    return {
      ...translated,
      originalType: link.type,
      family: relationFamily(link),
      provenance: isProvenance(link),
      rawImportance,
      narrativePosition: Math.max(position.get(translated.sourceId) ?? Number.MAX_SAFE_INTEGER, position.get(translated.targetId) ?? Number.MAX_SAFE_INTEGER),
      stableIndex
    };
  });
  const maximum = Math.max(0, ...narratives.map(item => item.rawImportance)) || 1;
  return narratives.map(item => ({ ...item, importance: Number((item.rawImportance / maximum).toFixed(3)) }))
    .sort((a, b) => Number(a.provenance) - Number(b.provenance)
      || a.narrativePosition - b.narrativePosition
      || b.importance - a.importance
      || a.sourceId.localeCompare(b.sourceId)
      || a.targetId.localeCompare(b.targetId)
      || a.type.localeCompare(b.type)
      || a.stableIndex - b.stableIndex)
    .map(({ rawImportance, narrativePosition, stableIndex, ...item }) => item);
}

function attachRelationsToSections(sections, relationNarratives, orderedIds, roleById) {
  const position = new Map(orderedIds.map((id, index) => [id, index]));
  const byRole = new Map(sections.map(section => [section.id, { ...section, relations: [] }]));
  relationNarratives.forEach(relation => {
    const sourcePosition = position.get(relation.sourceId) ?? Number.MAX_SAFE_INTEGER;
    const targetPosition = position.get(relation.targetId) ?? Number.MAX_SAFE_INTEGER;
    const laterId = sourcePosition >= targetPosition ? relation.sourceId : relation.targetId;
    const fallbackRole = relation.provenance ? "source" : roleById.get(laterId);
    const section = byRole.get(fallbackRole) || byRole.get(roleById.get(relation.targetId)) || byRole.get(roleById.get(relation.sourceId));
    section?.relations.push(relation);
  });
  return sections.map(section => byRole.get(section.id));
}

function toMarkdown(plan) {
  const lines = [`# ${plan.title}`, "", plan.lede ? `_${plan.lede}_` : ""];
  if (plan.patterns.length) {
    lines.push("", "## Patterns émergents", "");
    plan.patterns.forEach(pattern => lines.push(`- **${pattern.label}** — *importance relative ${Math.round(pattern.importance * 100)} %*`));
  }
  plan.sections.forEach(section => {
    lines.push("", `## ${section.heading}`, "");
    section.items.forEach(item => lines.push(`- **${item.title}** — ${item.body}  `, `  *Importance éditoriale : ${Math.round(item.importance * 100)} %.*`));
    if (section.relations.length) {
      lines.push("", "### Enchaînements", "");
      section.relations.forEach(relation => lines.push(`- **${relation.sourceName}** *${relation.verb}* **${relation.targetName}**.  `, `  *Importance relative du lien : ${Math.round(relation.importance * 100)} %.*`));
    }
  });
  lines.push("", `— Généré depuis ${plan.meta.nodeCount} nœuds et ${plan.meta.semanticRelationCount} relations sémantiques (${plan.meta.provenanceRelationCount} liens de provenance séparés).`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function auditPresentationNomenclature(ontology) {
  const errors = [];
  const warnings = [];
  if (!/^1\.[4-7]\./.test(String(ontology?.schemaVersion || ""))) warnings.push(`Schéma testé sur 1.4.x à 1.7.x, reçu ${ontology?.schemaVersion || "inconnu"}.`);
  const declaredFamilies = new Set(ontology?.relationFamilies?.map(family => family.id) || []);
  declaredFamilies.forEach(family => {
    if (!(family in RELATION_FAMILY_WEIGHTS)) errors.push(`Famille sans poids narratif : ${family}`);
  });
  ontology?.relationTypes?.filter(relation => relation.status === "active").forEach(relation => {
    if (!declaredFamilies.has(relation.family)) errors.push(`Relation ${relation.id} liée à une famille inconnue : ${relation.family}`);
    if (!ontology.relationConstraints?.[relation.id]) errors.push(`Relation active sans contrat de types : ${relation.id}`);
  });
  return {
    ok: errors.length === 0,
    schemaVersion: ontology?.schemaVersion,
    nodeTypeCount: ontology?.nodeTypes?.length || 0,
    relationTypeCount: ontology?.relationTypes?.filter(relation => relation.status === "active").length || 0,
    relationFamilyCount: declaredFamilies.size,
    epistemicStatusCount: ontology?.epistemicStatuses?.length || 0,
    errors,
    warnings
  };
}

export function transformClusterToPresentation(cluster, options = {}) {
  const nodes = (cluster?.nodes || []).filter(node => node?.id);
  const nodeIds = new Set(nodes.map(node => node.id));
  const links = (cluster?.links || []).filter(link => nodeIds.has(idOf(link.source)) && nodeIds.has(idOf(link.target)));
  const provenanceLinks = links.filter(isProvenance);
  const semanticLinks = links.filter(link => !isProvenance(link));
  const ids = nodes.map(node => node.id);
  const mainCluster = dominantCluster(nodes, options.focusNode);
  const { degree, convergence } = weightedDegrees(ids, semanticLinks);
  const rank = pageRank(ids, semanticLinks);
  const between = betweenness(ids, semanticLinks);
  const reach = downstreamReach(ids, semanticLinks);
  const incoming = new Map(ids.map(id => [id, semanticLinks.filter(link => idOf(link.target) === id)]));
  const scoreById = new Map();
  const metricsById = new Map();

  nodes.forEach(node => {
    const centrality = 0.4 * (rank.get(node.id) || 0) + 0.35 * (between.get(node.id) || 0) + 0.25 * (degree.get(node.id) || 0);
    const rolePrior = ROLE_PRIORS[node.nodeType] ?? 0.6;
    const evidence = evidenceScore(node, incoming.get(node.id));
    const specificity = specificityScore(node);
    let score = 0.25 * centrality + 0.2 * (convergence.get(node.id) || 0) + 0.15 * (reach.get(node.id) || 0)
      + 0.25 * rolePrior + 0.1 * evidence + 0.05 * specificity;
    if (node.nodeType === "source_document") score *= 0.35;
    scoreById.set(node.id, score);
    metricsById.set(node.id, { centrality, convergence: convergence.get(node.id) || 0, reach: reach.get(node.id) || 0, rolePrior, evidence, specificity });
  });
  const maximumScore = Math.max(0, ...scoreById.values()) || 1;
  scoreById.forEach((score, id) => scoreById.set(id, score / maximumScore));

  const roleById = new Map(nodes.map(node => [node.id, classifyRole(node, {
    ...metricsById.get(node.id),
    convergence: convergence.get(node.id) || 0
  }, semanticLinks, mainCluster)]));
  const orderedIds = precedenceOrder(nodes, semanticLinks, roleById, scoreById);
  let sections = buildSections(nodes, orderedIds, roleById, scoreById);
  const relationNarratives = buildRelationNarratives(nodes, links, scoreById, orderedIds);
  sections = attachRelationsToSections(sections, relationNarratives, orderedIds, roleById);
  const patterns = buildPatterns(nodes, semanticLinks, provenanceLinks, scoreById, roleById, mainCluster);
  const rankedNodes = [...nodes].sort((a, b) => scoreById.get(b.id) - scoreById.get(a.id) || a.id.localeCompare(b.id)).map(node => ({
    id: node.id,
    name: node.name,
    role: roleById.get(node.id),
    importance: Number(scoreById.get(node.id).toFixed(3)),
    metrics: Object.fromEntries(Object.entries(metricsById.get(node.id)).map(([key, value]) => [key, Number(value.toFixed(3))]))
  }));
  const anchor = rankedNodes.find(item => !["source", "bridge"].includes(item.role));
  const anchorNode = nodes.find(node => node.id === anchor?.id) || nodes[0];
  const target = nodes.find(node => roleById.get(node.id) === "target");
  const ledeParts = [anchorNode?.phrase, target && target.id !== anchorNode?.id ? target.phrase : ""].filter(Boolean);
  const plan = {
    algorithmVersion: PRESENTATION_ALGORITHM_VERSION,
    title: presentationTitle(nodes, mainCluster),
    lede: ledeParts.join(" "),
    mainCluster,
    focusNodeId: options.focusNode?.id || null,
    patterns,
    rankedNodes,
    relationNarratives,
    orderedNodeIds: sections.flatMap(section => section.nodeIds),
    sections,
    meta: {
      nodeCount: nodes.length,
      relationCount: links.length,
      semanticRelationCount: semanticLinks.length,
      provenanceRelationCount: provenanceLinks.length,
      schemaVersion: nodes.find(node => node.schemaVersion)?.schemaVersion || "inconnu"
    }
  };
  plan.markdown = toMarkdown(plan);
  return plan;
}
