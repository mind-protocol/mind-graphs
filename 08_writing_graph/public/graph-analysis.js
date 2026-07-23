import { semanticTypeOf } from "./node-semantics.js";

const CAUSAL_TYPES = new Set(["CAUSES", "LEADS_TO", "SCENARIO_LEADS_TO", "PRESSURES", "MITIGATES", "AFFECTS_SCENARIO"]);
const DOWNSTREAM_TYPES = new Set([
  ...CAUSAL_TYPES, "FEEDS", "UNLOCKS", "IMPLEMENTS",
  "CONVERGES_IN", "TESTS", "MAKES_PLAUSIBLE"
]);
const SOLUTION_TYPES = new Set(["unlock", "mechanism", "institution", "economic_mechanism", "design_effect"]);
// Contrat causal (graph-ontology.json → causalContract) : un mécanisme non-orphelin est
// causalement complet lorsqu'il affirme au moins un CAUSES/LEADS_TO vers un état ou une métrique.
const CANONICAL_CAUSE_SOURCES = new Set(["mechanism", "economic_mechanism"]);
const CANONICAL_CAUSE_PREDICATES = new Set(["CAUSES", "LEADS_TO"]);
const CANONICAL_CAUSE_TARGETS = new Set(["system_state", "metric"]);
// Contrat d'observabilité (graph-ontology.json → observabilityContract) : la chaîne d'ancrage
// mechanism —CAUSES→ system_state —MEASURED_BY→ metric donne au CAUSES l'unité dans laquelle
// écrire son effectSizePct. Sans observable dans le périmètre, le contrat causal est insatisfiable.
const OBSERVABLE_TYPES = new Set(["system_state", "metric"]);
const MEASUREMENT_PREDICATE = "MEASURED_BY";
const LINK_QUANTIFICATION_FIELDS = ["effectSizePct", "confidenceScore", "evidenceBasis"];
// Un LEADS_TO entre capacités ou horizons décrit une condition de possibilité, pas un effet
// mesurable : il gonfle la famille causale sans jamais pouvoir être chiffré.
const ENABLEMENT_SHAPED_TYPES = new Set(["unlock", "horizon"]);
const UNCLUSTERED = "(hors cluster)";
const clusterOf = node => node?.clusterId || UNCLUSTERED;
const STOP_WORDS = new Set(["a", "au", "aux", "avec", "ce", "ces", "dans", "de", "des", "du", "et", "en", "est", "la", "le", "les", "par", "pour", "que", "qui", "sur", "un", "une"]);

function idOf(value) {
  return typeof value === "object" ? value.id : value;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalize(value, max) {
  return max > 0 ? clamp(value / max * 100) : 0;
}

function severity(priority) {
  if (priority >= 85) return "critique";
  if (priority >= 70) return "haute";
  if (priority >= 50) return "moyenne";
  return "basse";
}

function tokens(value) {
  return new Set(String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/)
    .filter(token => token.length > 2 && !STOP_WORDS.has(token)));
}

function jaccard(a, b) {
  const intersection = [...a].filter(value => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function impactWeight(node) {
  if (!node) return 0;
  const semanticType = semanticTypeOf(node);
  if (node.id === "innovation-mind-protocol") return 8;
  if (semanticType === "system_state") return node.stateOrientation === "undesirable" ? 7 : 6;
  if (["design_effect", "horizon"].includes(semanticType)) return 5;
  if (["economic_mechanism", "institution", "forecast_event"].includes(semanticType)) return 4;
  if (["mechanism", "unlock", "working_hypothesis"].includes(semanticType)) return 3;
  return 1;
}

function buildIndex(nodes, links) {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const outgoing = new Map(nodes.map(node => [node.id, []]));
  const incoming = new Map(nodes.map(node => [node.id, []]));
  links.forEach((link, index) => {
    const normalized = { ...link, _index: index, sourceId: idOf(link.source), targetId: idOf(link.target) };
    outgoing.get(normalized.sourceId)?.push(normalized);
    incoming.get(normalized.targetId)?.push(normalized);
  });
  const degrees = new Map(nodes.map(node => [node.id, (outgoing.get(node.id)?.length || 0) + (incoming.get(node.id)?.length || 0)]));
  return { nodeById, outgoing, incoming, degrees };
}

function reachableFrom(startIds, index, maxDepth = 4) {
  const visited = new Map();
  const queue = startIds.map(id => ({ id, depth: 0, path: [id] }));
  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) continue;
    for (const link of index.outgoing.get(current.id) || []) {
      if (!DOWNSTREAM_TYPES.has(link.type)) continue;
      const nextDepth = current.depth + 1;
      if (visited.has(link.targetId) && visited.get(link.targetId).depth <= nextDepth) continue;
      const result = { depth: nextDepth, path: [...current.path, link.targetId], via: link.type };
      visited.set(link.targetId, result);
      queue.push({ id: link.targetId, depth: nextDepth, path: result.path });
    }
  }
  return visited;
}

function finding(base) {
  const priority = Math.round(clamp(base.priority));
  return { ...base, priority, severity: severity(priority) };
}

function questionFindings(nodes, index) {
  const records = nodes.filter(node => semanticTypeOf(node) === "open_question").map(node => {
    const blocking = (index.outgoing.get(node.id) || []).filter(link => link.type === "BLOCKS");
    const targets = blocking.map(link => link.targetId);
    const reachable = reachableFrom(targets, index, 4);
    targets.forEach(id => { if (!reachable.has(id)) reachable.set(id, { depth: 0, path: [node.id, id], via: "BLOCKS" }); });
    const important = [...reachable.keys()].map(id => index.nodeById.get(id)).filter(Boolean);
    const weightedImpact = important.reduce((sum, item) => sum + impactWeight(item), 0);
    const riskStates = important.filter(item => semanticTypeOf(item) === "system_state" && item.stateOrientation === "undesirable");
    const resolutions = (index.incoming.get(node.id) || []).filter(link => link.type === "ADDRESSES");
    return { node, blocking, targets, reachable, important, weightedImpact, riskStates, resolutions };
  });
  const maxImpact = Math.max(1, ...records.map(record => record.weightedImpact));
  const maxDegree = Math.max(1, ...records.map(record => index.degrees.get(record.node.id) || 0));
  const maxRisk = Math.max(1, ...records.map(record => record.riskStates.length));
  return records.filter(record => !record.resolutions.length).map(record => {
    const impact = normalize(record.weightedImpact, maxImpact);
    const centrality = normalize(index.degrees.get(record.node.id) || 0, maxDegree);
    const risk = normalize(record.riskStates.length, maxRisk);
    const unresolved = 100;
    const priority = impact * .5 + centrality * .15 + risk * .25 + unresolved * .10;
    const downstreamNames = record.important
      .sort((a, b) => impactWeight(b) - impactWeight(a))
      .slice(0, 6).map(node => node.name);
    return finding({
      id: `question:${record.node.id}`,
      category: "unanswered_question",
      categoryLabel: "Question non résolue",
      priority,
      title: record.node.name,
      summary: `Bloque ${record.targets.length} élément(s) direct(s) et atteint ${record.important.length} élément(s) en aval sur quatre niveaux.`,
      diagnosis: "Aucune solution n’est reliée par ADDRESSES : la question reste structurellement ouverte.",
      metrics: [
        { label: "Impact aval pondéré", value: record.weightedImpact.toFixed(1) },
        { label: "Risques atteints", value: String(record.riskStates.length) },
        { label: "Réponses explicites", value: String(record.resolutions.length) }
      ],
      path: downstreamNames,
      action: record.node.decisionNeeded || "Spécifier une décision, une preuve ou une expérience, puis la relier avec ADDRESSES.",
      nodeId: record.node.id,
      relatedNodeIds: [...record.reachable.keys()]
    });
  });
}

function solutionFindings(nodes, index) {
  const candidates = nodes.filter(node => SOLUTION_TYPES.has(semanticTypeOf(node))).map(node => {
    const incoming = index.incoming.get(node.id) || [];
    const outgoing = index.outgoing.get(node.id) || [];
    const tests = incoming.filter(link => link.type === "TESTS");
    const quantifiedEvidence = incoming.filter(link => link.type === "SUPPORTS_ESTIMATE");
    const designRationale = incoming.filter(link => ["MOTIVATES", "GROUNDS"].includes(link.type));
    const provenance = outgoing.filter(link => link.type === "DERIVED_FROM");
    const evidence = [...quantifiedEvidence, ...designRationale, ...provenance];
    const implementation = [...incoming, ...outgoing].filter(link => ["IMPLEMENTS", "ADDRESSES"].includes(link.type));
    const questions = incoming.filter(link => link.type === "BLOCKS");
    const causalInputs = incoming.filter(link => CAUSAL_TYPES.has(link.type));
    const reachable = reachableFrom([node.id], index, 4);
    const weightedImpact = [...reachable.keys()].reduce((sum, id) => sum + impactWeight(index.nodeById.get(id)), 0);
    const requiresImplementation = semanticTypeOf(node) !== "design_effect";
    const missing = [
      tests.length ? null : "test",
      evidence.length ? null : "justification",
      requiresImplementation && !implementation.length ? "implémentation" : null,
      semanticTypeOf(node) === "design_effect" && !causalInputs.length ? "cause spécifiée" : null
    ].filter(Boolean);
    const gap = (tests.length ? 0 : 30) + (evidence.length ? 0 : 35)
      + (requiresImplementation && !implementation.length ? 20 : 0)
      + (semanticTypeOf(node) === "design_effect" && !causalInputs.length ? 20 : 0)
      + Math.min(15, questions.length * 5);
    return { node, tests, evidence, implementation, questions, reachable, weightedImpact, missing, gap };
  }).filter(record => record.missing.length || record.questions.length);
  const maxImpact = Math.max(1, ...candidates.map(record => record.weightedImpact));
  const maxQuestions = Math.max(1, ...candidates.map(record => record.questions.length));
  return candidates.map(record => {
    const priority = normalize(record.weightedImpact, maxImpact) * .55
      + clamp(record.gap) * .35
      + normalize(record.questions.length, maxQuestions) * .10;
    return finding({
      id: `solution:${record.node.id}`,
      category: "underspecified_solution",
      categoryLabel: "Solution sous-spécifiée",
      priority,
      title: record.node.name,
      summary: `Éléments manquants : ${record.missing.join(", ") || "aucun"}.`,
      diagnosis: `${record.questions.length} question(s) ouverte(s), ${record.tests.length} test(s), ${record.evidence.length} justification(s) et ${record.implementation.length} lien(s) d’implémentation.`,
      metrics: [
        { label: "Lacunes", value: String(record.missing.length) },
        { label: "Questions entrantes", value: String(record.questions.length) },
        { label: "Impact aval pondéré", value: record.weightedImpact.toFixed(1) }
      ],
      path: [...record.reachable.keys()].map(id => index.nodeById.get(id)?.name).filter(Boolean).slice(0, 6),
      action: record.missing.length
        ? `Ajouter ${record.missing.join(" + ")}, avec conditions d’échec et nœuds justificatifs.`
        : "Traiter les questions bloquantes entrantes et consigner pour chacune une réponse ou une condition de maintien ouverte.",
      nodeId: record.node.id,
      relatedNodeIds: [...record.reachable.keys()]
    });
  });
}

function fragileClaimFindings(links, index) {
  return links.filter(link => link.causalClaim === true || CAUSAL_TYPES.has(link.type)).map((link, position) => {
    const sourceId = idOf(link.source);
    const targetId = idOf(link.target);
    const source = index.nodeById.get(sourceId);
    const target = index.nodeById.get(targetId);
    const support = (index.incoming.get(targetId) || []).filter(item => item.type === "SUPPORTS_ESTIMATE");
    const plannedTests = (index.incoming.get(targetId) || []).filter(item => item.type === "TESTS");
    const declaredSupportingNodes = Array.isArray(link.supportingNodes) ? link.supportingNodes.filter(Boolean) : [];
    const hasSupport = support.length > 0 || declaredSupportingNodes.length > 0;
    const hasContext = Boolean(link.contextId || link.populationOrSystem || link.validFrom || link.validTo || link.causalCondition);
    const unquantified = !link.quantificationStatus || link.quantificationStatus === "unquantified";
    const targetImpact = impactWeight(target);
    const alias = link.canonicalPredicate && link.canonicalPredicate !== link.type;
    const priority = 30 + targetImpact * 5 + (unquantified ? 20 : 0) + (!hasSupport ? 15 : 0) + (!hasContext ? 10 : 0) + (alias ? 5 : 0) - (plannedTests.length ? 8 : 0);
    const missing = [unquantified ? "quantification" : null, !hasSupport ? "preuve attribuée" : null, !hasContext ? "contexte" : null].filter(Boolean);
    return { fragile: missing.length > 0, result: finding({
      id: `claim:${sourceId}:${targetId}:${link.type}:${position}`,
      category: "fragile_claim",
      categoryLabel: "Affirmation causale fragile",
      priority,
      title: `${source?.name || sourceId} → ${target?.name || targetId}`,
      summary: `${link.relationLabel || link.type}. ${unquantified ? "Aucune quantification contextualisée." : `Statut : ${link.quantificationStatus}.`}`,
      diagnosis: missing.length
        ? `Éléments manquants : ${missing.join(", ")}.${plannedTests.length ? ` ${plannedTests.length} protocole(s) sont planifiés mais non exécutés.` : ""}`
        : "Causalité contextualisée, qualifiée et reliée à ses supports.",
      metrics: [
        { label: "Prédicat", value: link.canonicalPredicate || link.type },
        { label: "Quantification", value: link.quantificationStatus || "unquantified" },
        { label: "Justifications", value: String(support.length + declaredSupportingNodes.length) },
        { label: "Contexte", value: hasContext ? "déclaré" : "absent" },
        { label: "Protocoles planifiés", value: String(plannedTests.length) }
      ],
      path: [source?.name, target?.name].filter(Boolean),
      action: plannedTests.length
        ? "Exécuter le protocole ; publier baseline, données, incertitude et résultat négatif éventuel avant SUPPORTS_ESTIMATE."
        : "Nommer la métrique, la baseline, l’horizon et la méthode ; relier ensuite les preuves avec SUPPORTS_ESTIMATE.",
      nodeId: targetId,
      relatedNodeIds: [sourceId, targetId]
    }) };
  }).filter(record => record.fragile).map(record => record.result);
}

function contradictionFindings(nodes, links, index) {
  const explicit = links.filter(link => link.type === "CONTRADICTS").map((link, position) => {
    const sourceId = idOf(link.source);
    const targetId = idOf(link.target);
    return finding({
      id: `contradiction:explicit:${position}`,
      category: "contradiction",
      categoryLabel: "Contradiction explicite",
      priority: 90,
      title: `${index.nodeById.get(sourceId)?.name || sourceId} ↔ ${index.nodeById.get(targetId)?.name || targetId}`,
      summary: "Une incompatibilité explicite est encodée dans le graphe.",
      diagnosis: link.relationStory || "Le contexte de contradiction doit être vérifié.",
      metrics: [{ label: "Type", value: "CONTRADICTS" }],
      path: [index.nodeById.get(sourceId)?.name, index.nodeById.get(targetId)?.name].filter(Boolean),
      action: "Préciser le contexte, l’horizon et les conditions dans lesquels les deux affirmations sont incompatibles.",
      nodeId: sourceId,
      relatedNodeIds: [sourceId, targetId]
    });
  });
  const desirable = nodes.filter(node => semanticTypeOf(node) === "system_state" && node.stateOrientation === "desirable");
  const undesirable = nodes.filter(node => semanticTypeOf(node) === "system_state" && node.stateOrientation === "undesirable");
  const tensions = [];
  for (const positive of desirable) {
    for (const negative of undesirable) {
      const similarity = jaccard(tokens(positive.stateDimension), tokens(negative.stateDimension));
      const positiveSources = new Set((index.incoming.get(positive.id) || []).map(link => link.sourceId));
      const sharedSources = (index.incoming.get(negative.id) || []).map(link => link.sourceId).filter(id => positiveSources.has(id));
      if (similarity < .2 || !sharedSources.length) continue;
      const priority = 55 + similarity * 20 + Math.min(20, sharedSources.length * 8);
      tensions.push(finding({
        id: `contradiction:tension:${positive.id}:${negative.id}`,
        category: "contradiction",
        categoryLabel: "Tension à vérifier",
        priority,
        title: `${positive.name} / ${negative.name}`,
        summary: "Ces états opposés partagent une dimension ou des causes amont ; ce n’est pas encore une contradiction démontrée.",
        diagnosis: `${sharedSources.length} source(s) amont commune(s), similarité de dimension ${Math.round(similarity * 100)} %.`,
        metrics: [
          { label: "Sources communes", value: String(sharedSources.length) },
          { label: "Proximité de dimension", value: `${Math.round(similarity * 100)} %` }
        ],
        path: sharedSources.map(id => index.nodeById.get(id)?.name).filter(Boolean),
        action: "Définir les conditions exclusives ou compatibles, puis ajouter CONTRADICTS seulement si l’incompatibilité est réelle.",
        nodeId: positive.id,
        relatedNodeIds: [positive.id, negative.id, ...sharedSources]
      }));
    }
  }
  if (!explicit.length) {
    tensions.push(finding({
      id: "contradiction:none-explicit",
      category: "contradiction",
      categoryLabel: "Lacune de contradiction",
      priority: 68,
      title: "Aucune contradiction explicite n’est encore encodée",
      summary: "Le graphe contient des risques et états opposés, mais aucun lien CONTRADICTS confirmé.",
      diagnosis: "L’algorithme peut proposer des tensions ; une revue humaine doit décider lesquelles sont de vraies incompatibilités.",
      metrics: [{ label: "CONTRADICTS", value: "0" }, { label: "Tensions proposées", value: String(tensions.length) }],
      path: [],
      action: "Revoir les tensions proposées et encoder seulement les contradictions contextualisées.",
      nodeId: null,
      relatedNodeIds: []
    }));
  }
  return [...explicit, ...tensions];
}

function consolidationFindings(nodes, links, index) {
  const aliasGroups = new Map();
  links.forEach(link => {
    const canonical = link.canonicalPredicate;
    if (!canonical || canonical === link.type) return;
    if (!aliasGroups.has(canonical)) aliasGroups.set(canonical, new Map());
    const types = aliasGroups.get(canonical);
    types.set(link.type, (types.get(link.type) || 0) + 1);
  });
  const findings = [...aliasGroups.entries()].map(([canonical, types]) => {
    const count = [...types.values()].reduce((sum, value) => sum + value, 0);
    return finding({
      id: `consolidation:relation:${canonical}`,
      category: "consolidation",
      categoryLabel: "Consolidation de prédicats",
      priority: 50 + Math.min(35, count),
      title: `Consolider vers ${canonical}`,
      summary: `${count} relation(s) utilisent encore ${[...types.keys()].join(", ")}.`,
      diagnosis: "La migration est utile pour les traversées, mais exige une revue sémantique avant réécriture.",
      metrics: [...types.entries()].map(([label, value]) => ({ label, value: String(value) })),
      path: [],
      action: `Revoir les nuances, puis migrer les alias compatibles vers ${canonical}.`,
      nodeId: null,
      relatedNodeIds: []
    });
  });
  const duplicateCandidates = [];
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      const a = nodes[first];
      const b = nodes[second];
      if (semanticTypeOf(a) !== semanticTypeOf(b)) continue;
      const nameSimilarity = jaccard(tokens(a.name), tokens(b.name));
      if (nameSimilarity < .82) continue;
      const neighborsA = new Set([...(index.outgoing.get(a.id) || []), ...(index.incoming.get(a.id) || [])].flatMap(link => [link.sourceId, link.targetId]).filter(id => id !== a.id));
      const neighborsB = new Set([...(index.outgoing.get(b.id) || []), ...(index.incoming.get(b.id) || [])].flatMap(link => [link.sourceId, link.targetId]).filter(id => id !== b.id));
      const neighborSimilarity = jaccard(neighborsA, neighborsB);
      if (neighborSimilarity < .2) continue;
      duplicateCandidates.push(finding({
        id: `consolidation:node:${a.id}:${b.id}`,
        category: "consolidation",
        categoryLabel: "Doublon potentiel",
        priority: 40 + nameSimilarity * 25 + neighborSimilarity * 20,
        title: `${a.name} / ${b.name}`,
        summary: "Noms et voisinages proches ; aucune fusion automatique ne sera effectuée.",
        diagnosis: `Similarité du nom ${Math.round(nameSimilarity * 100)} %, voisinage ${Math.round(neighborSimilarity * 100)} %.`,
        metrics: [
          { label: "Nom", value: `${Math.round(nameSimilarity * 100)} %` },
          { label: "Voisinage", value: `${Math.round(neighborSimilarity * 100)} %` }
        ],
        path: [],
        action: "Comparer les définitions et conserver, relier ou fusionner après revue humaine.",
        nodeId: a.id,
        relatedNodeIds: [a.id, b.id]
      }));
    }
  }
  return [...findings, ...duplicateCandidates];
}

function betweennessCentrality(nodes, index) {
  const scores = new Map(nodes.map(node => [node.id, 0]));
  for (const source of nodes) {
    const stack = [];
    const predecessors = new Map(nodes.map(node => [node.id, []]));
    const paths = new Map(nodes.map(node => [node.id, 0]));
    const distance = new Map(nodes.map(node => [node.id, -1]));
    paths.set(source.id, 1);
    distance.set(source.id, 0);
    const queue = [source.id];
    while (queue.length) {
      const current = queue.shift();
      stack.push(current);
      for (const link of index.outgoing.get(current) || []) {
        if (!DOWNSTREAM_TYPES.has(link.type) && !["GROUNDS", "SAFEGUARDS", "MOTIVATES", "ASSUMES", "BLOCKS"].includes(link.type)) continue;
        const target = link.targetId;
        if (distance.get(target) < 0) {
          distance.set(target, distance.get(current) + 1);
          queue.push(target);
        }
        if (distance.get(target) === distance.get(current) + 1) {
          paths.set(target, paths.get(target) + paths.get(current));
          predecessors.get(target).push(current);
        }
      }
    }
    const dependency = new Map(nodes.map(node => [node.id, 0]));
    while (stack.length) {
      const target = stack.pop();
      for (const predecessor of predecessors.get(target)) {
        const targetPaths = paths.get(target) || 1;
        dependency.set(predecessor, dependency.get(predecessor) + paths.get(predecessor) / targetPaths * (1 + dependency.get(target)));
      }
      if (target !== source.id) scores.set(target, scores.get(target) + dependency.get(target));
    }
  }
  return scores;
}

function structuralBottleneckFindings(nodes, index) {
  const centrality = betweennessCentrality(nodes, index);
  const candidates = nodes.map(node => {
    const score = centrality.get(node.id) || 0;
    const downstream = reachableFrom([node.id], index, 4);
    const incoming = (index.incoming.get(node.id) || []).filter(link => DOWNSTREAM_TYPES.has(link.type) || ["GROUNDS", "MOTIVATES", "ASSUMES", "BLOCKS"].includes(link.type));
    const outgoing = (index.outgoing.get(node.id) || []).filter(link => DOWNSTREAM_TYPES.has(link.type));
    return { node, score, downstream, incoming, outgoing };
  }).filter(item => item.score > 0 && item.outgoing.length)
    .sort((a, b) => b.score - a.score).slice(0, 6);
  const maxCentrality = Math.max(1, ...candidates.map(item => item.score));
  const maxImpact = Math.max(1, ...candidates.map(item => [...item.downstream.keys()].reduce((sum, id) => sum + impactWeight(index.nodeById.get(id)), 0)));
  return candidates.map(item => {
    const weightedImpact = [...item.downstream.keys()].reduce((sum, id) => sum + impactWeight(index.nodeById.get(id)), 0);
    const fragility = item.incoming.length <= 1 ? 100 : item.incoming.length === 2 ? 60 : 25;
    const priority = normalize(item.score, maxCentrality) * .55 + normalize(weightedImpact, maxImpact) * .3 + fragility * .15;
    const upstream = item.incoming.map(link => index.nodeById.get(link.sourceId)).filter(Boolean).sort((a, b) => impactWeight(b) - impactWeight(a))[0];
    const downstream = [...item.downstream.entries()].sort((a, b) => impactWeight(index.nodeById.get(b[0])) - impactWeight(index.nodeById.get(a[0])))[0];
    const downstreamNode = downstream ? index.nodeById.get(downstream[0]) : null;
    return finding({
      id: `bottleneck:${item.node.id}`,
      category: "structural_bottleneck",
      categoryLabel: "Goulot structurel",
      priority,
      title: item.node.name,
      summary: `Ce nœud se trouve sur de nombreux chemins courts et atteint ${item.downstream.size} élément(s) en aval.`,
      diagnosis: `${item.incoming.length} dépendance(s) amont et ${item.outgoing.length} sortie(s) structurantes : une erreur ici se propage largement.`,
      metrics: [
        { label: "Centralité d’intermédiarité", value: item.score.toFixed(1) },
        { label: "Impact aval pondéré", value: weightedImpact.toFixed(1) },
        { label: "Dépendances amont", value: String(item.incoming.length) }
      ],
      path: [upstream?.name, item.node.name, downstreamNode?.name].filter(Boolean),
      action: "Tester ce nœud en priorité, documenter ses hypothèses et prévoir une voie alternative ou un mécanisme de repli.",
      nodeId: item.node.id,
      relatedNodeIds: [item.node.id, ...item.downstream.keys()]
    });
  });
}

function stronglyConnectedComponents(nodes, index) {
  let sequence = 0;
  const indices = new Map();
  const lowlinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  function visit(id) {
    indices.set(id, sequence);
    lowlinks.set(id, sequence);
    sequence += 1;
    stack.push(id);
    onStack.add(id);
    for (const link of index.outgoing.get(id) || []) {
      if (!DOWNSTREAM_TYPES.has(link.type) && !["GROUNDS", "SAFEGUARDS", "MOTIVATES", "ASSUMES"].includes(link.type)) continue;
      const target = link.targetId;
      if (!indices.has(target)) {
        visit(target);
        lowlinks.set(id, Math.min(lowlinks.get(id), lowlinks.get(target)));
      } else if (onStack.has(target)) {
        lowlinks.set(id, Math.min(lowlinks.get(id), indices.get(target)));
      }
    }
    if (lowlinks.get(id) !== indices.get(id)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== id);
    if (component.length > 1) components.push(component);
  }
  for (const node of nodes) if (!indices.has(node.id)) visit(node.id);
  return components;
}

function feedbackLoopFindings(nodes, index) {
  return stronglyConnectedComponents(nodes, index).map((component, position) => {
    const componentIds = new Set(component);
    const internalLinks = component.flatMap(id => (index.outgoing.get(id) || []).filter(link => componentIds.has(link.targetId)));
    const causalLinks = internalLinks.filter(link => CAUSAL_TYPES.has(link.type));
    const riskStates = component.map(id => index.nodeById.get(id)).filter(node => semanticTypeOf(node) === "system_state" && node.stateOrientation === "undesirable");
    const qualifiedLinks = causalLinks.filter(link =>
      link.forecastPolarity && link.forecastDelay && Number(link.forecastStrength) > 0
    );
    const qualificationCoverage = causalLinks.length ? qualifiedLinks.length / causalLinks.length : 0;
    const priority = 45 + Math.min(25, component.length * 4) + Math.min(20, causalLinks.length * 3)
      + Math.min(10, riskStates.length * 5) - Math.round(qualificationCoverage * 18);
    const orderedNames = component.map(id => index.nodeById.get(id)?.name).filter(Boolean);
    return finding({
      id: `feedback:${position}:${component.slice().sort().join(":")}`,
      category: "feedback_loop",
      categoryLabel: "Boucle de rétroaction",
      priority,
      title: orderedNames.slice(0, 3).join(" ↔ "),
      summary: `${component.length} nœuds et ${internalLinks.length} relations forment une boucle structurelle ; ${qualifiedLinks.length}/${causalLinks.length} causalités ont signe, délai et intensité ordinale.`,
      diagnosis: qualificationCoverage === 1
        ? "La boucle est qualifiée comme scénario ordinal, mais son gain réel et sa stabilité ne sont pas empiriquement estimés."
        : `${causalLinks.length - qualifiedLinks.length} causalité(s) doivent encore recevoir signe, délai et intensité.`,
      metrics: [
        { label: "Nœuds", value: String(component.length) },
        { label: "Relations internes", value: String(internalLinks.length) },
        { label: "Causalités", value: String(causalLinks.length) },
        { label: "Qualification", value: `${Math.round(qualificationCoverage * 100)} %` }
      ],
      path: [...orderedNames.slice(0, 6), orderedNames[0]].filter(Boolean),
      action: qualificationCoverage === 1
        ? "Tester les gains et délais sur données ou simulation calibrée ; identifier les coupe-circuits des branches divergentes."
        : "Qualifier le signe, le délai et l’intensité de chaque relation ; ajouter un mécanisme d’amortissement si la boucle peut diverger.",
      nodeId: component[0],
      relatedNodeIds: component
    });
  }).sort((a, b) => b.priority - a.priority).slice(0, 6);
}

function evidenceLeverageFindings(nodes, index) {
  const candidates = nodes.map(node => {
    const incoming = index.incoming.get(node.id) || [];
    const causalInputs = incoming.filter(link => link.causalClaim === true || CAUSAL_TYPES.has(link.type));
    const unsupported = causalInputs.filter(link => !incoming.some(item => item.type === "SUPPORTS_ESTIMATE"));
    const plannedTests = incoming.filter(link => link.type === "TESTS");
    const downstream = reachableFrom([node.id], index, 4);
    const weightedImpact = impactWeight(node) + [...downstream.keys()].reduce((sum, id) => sum + impactWeight(index.nodeById.get(id)), 0);
    return { node, causalInputs, unsupported, plannedTests, downstream, weightedImpact };
  }).filter(item => item.unsupported.length)
    .sort((a, b) => b.weightedImpact * b.unsupported.length - a.weightedImpact * a.unsupported.length).slice(0, 7);
  const maxLeverage = Math.max(1, ...candidates.map(item => item.weightedImpact * item.unsupported.length));
  return candidates.map(item => {
    const leverage = item.weightedImpact * item.unsupported.length;
    const sources = item.unsupported.map(link => index.nodeById.get(link.sourceId)?.name).filter(Boolean);
    const priority = 55 + normalize(leverage, maxLeverage) * .4 + Math.min(5, item.unsupported.length) - (item.plannedTests.length ? 12 : 0);
    return finding({
      id: `evidence-leverage:${item.node.id}`,
      category: "evidence_leverage",
      categoryLabel: "Preuve à fort levier",
      priority,
      title: `Prouver ou réfuter : ${item.node.name}`,
      summary: `Une même campagne de preuve pourrait éclairer ${item.unsupported.length} affirmation(s) causale(s) et ${item.downstream.size} élément(s) en aval.${item.plannedTests.length ? ` ${item.plannedTests.length} protocole(s) sont planifiés.` : ""}`,
      diagnosis: item.plannedTests.length
        ? "Un protocole existe, mais aucun résultat SUPPORTS_ESTIMATE n’est encore relié à la cible."
        : "Aucune relation SUPPORTS_ESTIMATE n’est encore reliée à cette cible causale.",
      metrics: [
        { label: "Affirmations concernées", value: String(item.unsupported.length) },
        { label: "Impact pondéré", value: item.weightedImpact.toFixed(1) },
        { label: "Score de levier", value: leverage.toFixed(1) },
        { label: "Protocoles planifiés", value: String(item.plannedTests.length) }
      ],
      path: [...sources.slice(0, 4), item.node.name],
      action: item.plannedTests.length
        ? "Exécuter le protocole préenregistré ; publier données, incertitudes et résultats négatifs avant toute relation SUPPORTS_ESTIMATE."
        : "Définir une métrique falsifiable, une baseline et un protocole commun couvrant ces affirmations ; relier ensuite les résultats avec SUPPORTS_ESTIMATE.",
      nodeId: item.node.id,
      relatedNodeIds: [item.node.id, ...item.unsupported.map(link => link.sourceId), ...item.downstream.keys()]
    });
  });
}

function hasCanonicalCause(node, index) {
  return (index.outgoing.get(node.id) || []).some(link =>
    CANONICAL_CAUSE_PREDICATES.has(link.type) &&
    CANONICAL_CAUSE_TARGETS.has(semanticTypeOf(index.nodeById.get(link.targetId))));
}

// Indicateur agrégé : part des mécanismes non-orphelins qui affirment au moins un effet causal
// canonique. Recensement complet (par cluster), sans quota ni refus — il rend le déficit mesurable.
function causalSaturation(nodes, index) {
  const mechanisms = nodes.filter(node =>
    CANONICAL_CAUSE_SOURCES.has(semanticTypeOf(node)) && (index.degrees.get(node.id) || 0) > 0);
  const clusters = new Map();
  let satisfied = 0;
  for (const node of mechanisms) {
    const ok = hasCanonicalCause(node, index);
    if (ok) satisfied += 1;
    const key = node.clusterId || "(hors cluster)";
    const bucket = clusters.get(key) || { cluster: key, mechanisms: 0, satisfied: 0 };
    bucket.mechanisms += 1;
    if (ok) bucket.satisfied += 1;
    clusters.set(key, bucket);
  }
  const ratioOf = (part, whole) => whole ? Math.round(part / whole * 100) / 100 : 0;
  const byCluster = [...clusters.values()]
    .map(bucket => ({ ...bucket, ratio: ratioOf(bucket.satisfied, bucket.mechanisms) }))
    .sort((a, b) => a.ratio - b.ratio || b.mechanisms - a.mechanisms);
  return {
    definition: "Part des mécanismes non-orphelins affirmant au moins un CAUSES/LEADS_TO vers un system_state ou une metric.",
    mechanisms: mechanisms.length,
    satisfied,
    ratio: ratioOf(satisfied, mechanisms.length),
    byCluster
  };
}

// Recensement par périmètre des observables disponibles. Un mécanisme ne peut affirmer un effet
// chiffré que si son cluster contient au moins un état ou une métrique à déplacer ; les clusters
// sans observable expliquent l'essentiel du déficit de saturation causale.
function observability(nodes, index) {
  const clusters = new Map();
  const bucketOf = key => {
    if (!clusters.has(key)) clusters.set(key, { cluster: key, mechanisms: 0, states: 0, metrics: 0, measuredStates: 0, anchoredMetrics: 0 });
    return clusters.get(key);
  };
  for (const node of nodes) {
    const bucket = bucketOf(clusterOf(node));
    if (CANONICAL_CAUSE_SOURCES.has(semanticTypeOf(node))) bucket.mechanisms += 1;
    if (semanticTypeOf(node) === "system_state") {
      bucket.states += 1;
      if (stateMetrics(node, index).length) bucket.measuredStates += 1;
    }
    if (semanticTypeOf(node) === "metric") {
      bucket.metrics += 1;
      if (metricStates(node, index).length) bucket.anchoredMetrics += 1;
    }
  }
  const states = nodes.filter(node => semanticTypeOf(node) === "system_state");
  const metrics = nodes.filter(node => semanticTypeOf(node) === "metric");
  const measuredStates = states.filter(node => stateMetrics(node, index).length).length;
  const anchoredMetrics = metrics.filter(node => metricStates(node, index).length).length;
  const ratioOf = (part, whole) => whole ? Math.round(part / whole * 100) / 100 : 0;
  return {
    definition: "Couverture de la chaîne d’ancrage : part des états reliés à une métrique par MEASURED_BY, et part des métriques rattachées à un état.",
    states: states.length,
    measuredStates,
    stateRatio: ratioOf(measuredStates, states.length),
    metrics: metrics.length,
    anchoredMetrics,
    metricRatio: ratioOf(anchoredMetrics, metrics.length),
    blindClusters: [...clusters.values()].filter(bucket => bucket.mechanisms > 0 && bucket.states + bucket.metrics === 0).map(bucket => bucket.cluster),
    byCluster: [...clusters.values()]
      .filter(bucket => bucket.mechanisms + bucket.states + bucket.metrics > 0)
      .map(bucket => ({ ...bucket, observables: bucket.states + bucket.metrics }))
      .sort((a, b) => (a.observables === 0 ? -1 : 0) - (b.observables === 0 ? -1 : 0) || b.mechanisms - a.mechanisms)
  };
}

function stateMetrics(node, index) {
  return (index.outgoing.get(node.id) || []).filter(link => link.type === MEASUREMENT_PREDICATE);
}

function metricStates(node, index) {
  return (index.incoming.get(node.id) || []).filter(link => link.type === MEASUREMENT_PREDICATE);
}

// Findings actionnables : les mécanismes sans effet causal canonique, triés par levier.
// Un mécanisme qui alimente (FEEDS) sans rien causer est le meilleur candidat "effet non-encodé" ;
// un mécanisme dont le périmètre n'a aucun observable est d'abord un problème d'observabilité.
function causalGapFindings(nodes, index, coverage) {
  const blind = new Set(coverage.blindClusters);
  const scored = nodes
    .filter(node => CANONICAL_CAUSE_SOURCES.has(semanticTypeOf(node))
      && (index.degrees.get(node.id) || 0) > 0
      && !hasCanonicalCause(node, index))
    .map(node => {
      const feeds = (index.outgoing.get(node.id) || []).filter(link => link.type === "FEEDS");
      const downstream = reachableFrom([node.id], index, 3);
      const weightedImpact = impactWeight(node)
        + [...downstream.keys()].reduce((sum, id) => sum + impactWeight(index.nodeById.get(id)), 0);
      return { node, feeds, downstream, weightedImpact, leverage: weightedImpact * (1 + feeds.length) };
    })
    .sort((a, b) => b.leverage - a.leverage);
  const maxLeverage = Math.max(1, ...scored.map(item => item.leverage));
  return scored.slice(0, 12).map(item => {
    const unobservable = blind.has(clusterOf(item.node));
    const likelyUnencoded = !unobservable && item.feeds.length > 0;
    const gapState = unobservable ? "effect_unobservable" : likelyUnencoded ? "effect_unencoded" : "effect_unknown";
    const priority = 40 + normalize(item.leverage, maxLeverage) * .35 + Math.min(6, item.feeds.length * 2);
    return finding({
      id: `causal-gap:${item.node.id}`,
      category: "causal_gap",
      categoryLabel: "Mécanisme sans effet causal",
      priority,
      title: `Effet causal manquant : ${item.node.name}`,
      summary: `Ce mécanisme n’affirme aucun CAUSES/LEADS_TO vers un état ou une métrique, alors qu’il touche ${item.downstream.size} élément(s) en aval${item.feeds.length ? ` et en alimente ${item.feeds.length} par FEEDS` : ""}.`,
      diagnosis: unobservable
        ? `effect_unobservable : le périmètre « ${clusterOf(item.node)} » ne contient aucun état ni métrique. Le contrat causal y est insatisfiable tant que l’observable n’existe pas.`
        : likelyUnencoded
          ? "effect_unencoded probable : le mécanisme alimente déjà des cibles ; l’effet existe sans doute mais n’est pas saisi comme arête causale chiffrée."
          : "effect_unknown probable : aucun flux sortant ne suggère d’effet ; l’effet reste à établir.",
      metrics: [
        { label: "Éléments en aval", value: String(item.downstream.size) },
        { label: "Flux FEEDS", value: String(item.feeds.length) },
        { label: "Impact pondéré", value: item.weightedImpact.toFixed(1) },
        { label: "Lacune", value: gapState }
      ],
      action: unobservable
        ? "Créer d’abord l’état observable du périmètre (désirable et son miroir indésirable), le relier à une métrique par MEASURED_BY, puis seulement viser le CAUSES."
        : likelyUnencoded
          ? "Ajouter un CAUSES vers le system_state ou la metric affectée, avec effectSizePct, confidenceScore et evidenceBasis ; marquer effect_unencoded."
          : "Trancher effect_unknown : ouvrir une question ou une expérience pour établir l’effet avant de le déclarer.",
      nodeId: item.node.id,
      relatedNodeIds: [item.node.id, ...item.feeds.map(link => link.targetId)],
      proposal: { kind: unobservable ? "create_observable" : "encode_effect", gapState, clusterId: clusterOf(item.node), targetNodeId: item.node.id }
    });
  });
}

// Périmètres aveugles : des mécanismes, aucun observable. C'est la cause racine du déficit causal,
// et le seul finding dont l'action précède logiquement toutes les autres.
function observabilityGapFindings(nodes, index, coverage) {
  const nodesByCluster = new Map();
  for (const node of nodes) {
    const key = clusterOf(node);
    if (!nodesByCluster.has(key)) nodesByCluster.set(key, []);
    nodesByCluster.get(key).push(node);
  }
  return coverage.byCluster.filter(bucket => bucket.observables === 0).map(bucket => {
    const members = nodesByCluster.get(bucket.cluster) || [];
    const mechanisms = members.filter(node => CANONICAL_CAUSE_SOURCES.has(semanticTypeOf(node)));
    const weight = mechanisms.reduce((sum, node) => sum + impactWeight(node), 0);
    return finding({
      id: `observability-gap:${bucket.cluster}`,
      category: "observability_gap",
      categoryLabel: "Périmètre sans observable",
      priority: 62 + Math.min(20, bucket.mechanisms * 1.5),
      title: `Aucun observable dans « ${bucket.cluster} »`,
      summary: `${bucket.mechanisms} mécanisme(s) y sont décrits, mais le périmètre ne contient ni system_state ni metric. Aucun d’eux ne peut affirmer un effet chiffré.`,
      diagnosis: "Le contrat causal exige une cible falsifiable. Tant que le périmètre n’expose pas d’état observable, la saturation causale y restera nulle par construction, quel que soit le soin apporté aux mécanismes.",
      metrics: [
        { label: "Mécanismes concernés", value: String(bucket.mechanisms) },
        { label: "États", value: "0" },
        { label: "Métriques", value: "0" },
        { label: "Impact pondéré", value: weight.toFixed(1) }
      ],
      action: "Créer au moins un état désirable et son miroir indésirable pour ce périmètre, chacun doté d’un stateIndicator, puis les relier à une métrique par MEASURED_BY.",
      nodeId: mechanisms[0]?.id,
      relatedNodeIds: mechanisms.slice(0, 8).map(node => node.id),
      proposal: { kind: "create_observable", clusterId: bucket.cluster, mechanismIds: mechanisms.map(node => node.id) }
    });
  });
}

// Un état dont l'indicateur reste du texte libre ne fournit aucune unité à un CAUSES entrant.
function unmeasuredStateFindings(nodes, index) {
  return nodes
    .filter(node => semanticTypeOf(node) === "system_state" && !stateMetrics(node, index).length)
    .map(node => {
      const incomingCauses = (index.incoming.get(node.id) || []).filter(link => CANONICAL_CAUSE_PREDICATES.has(link.type));
      const tests = (index.incoming.get(node.id) || []).filter(link => link.type === "TESTS");
      return { node, incomingCauses, tests };
    })
    .sort((a, b) => b.incomingCauses.length - a.incomingCauses.length || b.tests.length - a.tests.length)
    .map(item => finding({
      id: `unmeasured-state:${item.node.id}`,
      category: "unmeasured_state",
      categoryLabel: "État sans métrique",
      priority: 48 + item.incomingCauses.length * 6 + Math.min(8, item.tests.length * 2),
      title: `Indicateur non instrumenté : ${item.node.name}`,
      summary: item.node.stateIndicator
        ? `L’indicateur est décrit en texte libre (« ${item.node.stateIndicator} ») mais aucune metric n’est reliée par MEASURED_BY.`
        : "Cet état ne déclare ni indicateur textuel ni métrique reliée : rien ne permet d’observer son occurrence.",
      diagnosis: item.incomingCauses.length
        ? `${item.incomingCauses.length} affirmation(s) causale(s) visent cet état sans unité de mesure : leur effectSizePct serait ininterprétable.`
        : "Aucune causalité ne vise encore cet état ; l’instrumenter maintenant évite d’avoir à inventer une unité au moment du chiffrage.",
      metrics: [
        { label: "Causalités entrantes", value: String(item.incomingCauses.length) },
        { label: "Protocoles visant l’état", value: String(item.tests.length) },
        { label: "Indicateur textuel", value: item.node.stateIndicator ? "présent" : "absent" }
      ],
      action: "Créer ou réutiliser une metric portant l’unité et la méthode de calcul, puis la relier à l’état par MEASURED_BY. Conserver stateIndicator comme résumé humain.",
      nodeId: item.node.id,
      relatedNodeIds: [item.node.id, ...item.incomingCauses.map(link => link.sourceId)],
      proposal: { kind: "link_state_metric", clusterId: clusterOf(item.node), targetNodeId: item.node.id, indicator: item.node.stateIndicator || "" }
    }));
}

// Une métrique rattachée à aucun état mesure une expérience isolée : elle ne peut pas servir de
// cible causale, et l'effort de mesure déjà consenti reste invisible pour le raisonnement.
function orphanMetricFindings(nodes, index) {
  return nodes
    .filter(node => semanticTypeOf(node) === "metric" && !metricStates(node, index).length)
    .map(node => {
      const measuredBy = (index.incoming.get(node.id) || []).filter(link => link.type === "MEASURES");
      return { node, measuredBy };
    })
    .sort((a, b) => b.measuredBy.length - a.measuredBy.length || a.node.id.localeCompare(b.node.id, "fr"))
    .map(item => finding({
      id: `orphan-metric:${item.node.id}`,
      category: "orphan_metric",
      categoryLabel: "Métrique non rattachée",
      priority: 38 + Math.min(12, item.measuredBy.length * 6) + (item.measuredBy.length ? 0 : 4),
      title: `Métrique hors chaîne : ${item.node.name}`,
      summary: item.measuredBy.length
        ? `${item.measuredBy.length} protocole(s) produisent cette métrique, mais aucun état du graphe ne s’y adosse par MEASURED_BY.`
        : "Cette métrique n’est ni produite par un protocole ni rattachée à un état : elle est isolée du raisonnement.",
      diagnosis: "La mesure existe mais ne dit rien du modèle : aucun CAUSES ne peut l’atteindre, et aucun état ne s’améliore ou ne se dégrade quand elle bouge.",
      metrics: [
        { label: "Protocoles producteurs", value: String(item.measuredBy.length) },
        { label: "États adossés", value: "0" }
      ],
      action: "Relier la métrique à l’état qu’elle objective par MEASURED_BY, ou l’archiver si elle n’instrumente aucun état du modèle.",
      nodeId: item.node.id,
      relatedNodeIds: [item.node.id, ...item.measuredBy.map(link => link.sourceId)],
      proposal: { kind: "attach_metric", clusterId: clusterOf(item.node), targetNodeId: item.node.id }
    }));
}

// Le contrat linkQuantification ne rend rien obligatoire : il rend le silence visible.
function unquantifiedCausalFindings(links, index) {
  return links
    .filter(link => CANONICAL_CAUSE_PREDICATES.has(link.type))
    .map((link, position) => {
      const sourceId = idOf(link.source);
      const targetId = idOf(link.target);
      const missing = LINK_QUANTIFICATION_FIELDS.filter(field => link[field] === undefined || link[field] === "");
      return { link, position, sourceId, targetId, missing };
    })
    .filter(item => item.missing.length)
    .map(item => {
      const source = index.nodeById.get(item.sourceId);
      const target = index.nodeById.get(item.targetId);
      const measurable = semanticTypeOf(target) === "metric" || stateMetrics(target || {}, index).length > 0;
      return finding({
        id: `unquantified-causal:${item.sourceId}:${item.targetId}:${item.link.type}:${item.position}`,
        category: "unquantified_causal",
        categoryLabel: "Arête causale non chiffrée",
        priority: 44 + impactWeight(target) * 4 + (measurable ? 10 : 0),
        title: `Force non déclarée : ${source?.name || item.sourceId} → ${target?.name || item.targetId}`,
        summary: `L’arête ${item.link.type} ne porte pas ${item.missing.join(", ")}. Sa force est indiscernable d’une simple mention.`,
        diagnosis: measurable
          ? "La cible possède une unité de mesure : le chiffrage est possible dès maintenant, même grossier et avec une confiance basse."
          : "La cible n’a pas encore de métrique reliée : instrumenter l’état d’abord, sinon l’effectSizePct n’aurait pas d’unité.",
        metrics: [
          { label: "Prédicat", value: item.link.type },
          { label: "Champs manquants", value: item.missing.join(", ") },
          { label: "Cible mesurable", value: measurable ? "oui" : "non" }
        ],
        path: [source?.name, target?.name].filter(Boolean),
        action: measurable
          ? "Renseigner effectSizePct (même grossier), confidenceScore et evidenceBasis. Une assertion argumentée à confiance 0.2 vaut mieux qu’un silence."
          : "Relier d’abord la cible à une métrique par MEASURED_BY, puis chiffrer l’arête.",
        nodeId: item.targetId,
        relatedNodeIds: [item.sourceId, item.targetId],
        proposal: { kind: "quantify_causal_link", clusterId: clusterOf(target), sourceNodeId: item.sourceId, targetNodeId: item.targetId, predicate: item.link.type, missing: item.missing }
      });
    });
}

// Deux dérives typent en « causal » ce qui ne peut pas se chiffrer : viser un effet recherché
// (contrat : MOTIVATES) et enchaîner des capacités ou des horizons (contrat : UNLOCKS).
function mistypedCausalFindings(links, index) {
  return links
    .filter(link => CANONICAL_CAUSE_PREDICATES.has(link.type))
    .map((link, position) => {
      const sourceId = idOf(link.source);
      const targetId = idOf(link.target);
      const source = index.nodeById.get(sourceId);
      const target = index.nodeById.get(targetId);
      const intendedOutcome = semanticTypeOf(target) === "design_effect";
      const enablementShaped = ENABLEMENT_SHAPED_TYPES.has(semanticTypeOf(source)) && ENABLEMENT_SHAPED_TYPES.has(semanticTypeOf(target));
      return { link, position, sourceId, targetId, source, target, intendedOutcome, enablementShaped };
    })
    .filter(item => item.intendedOutcome || item.enablementShaped)
    .map(item => finding({
      id: `mistyped-causal:${item.sourceId}:${item.targetId}:${item.link.type}:${item.position}`,
      category: "mistyped_causal",
      categoryLabel: "Prédicat causal mal employé",
      priority: 52 + (item.intendedOutcome ? 6 : 0),
      title: `${item.link.type} inadapté : ${item.source?.name || item.sourceId} → ${item.target?.name || item.targetId}`,
      summary: item.intendedOutcome
        ? "La cible est un effet recherché (design_effect), pas un état observable. Le contrat causal réserve CAUSES aux cibles falsifiables."
        : "Source et cible sont des capacités ou des horizons : le lien décrit une condition de possibilité, pas un effet mesurable.",
      diagnosis: item.intendedOutcome
        ? "Confondre l’effet visé et l’effet affirmé rend le graphe incapable de distinguer une intention d’un résultat. Un design_effect se relie par MOTIVATES ; l’effet affirmé vise l’état correspondant."
        : "Ces arêtes gonflent la famille causale sans pouvoir être chiffrées : elles font baisser la qualité apparente du modèle causal sans rien affirmer de testable.",
      metrics: [
        { label: "Prédicat actuel", value: item.link.type },
        { label: "Type de cible", value: semanticTypeOf(item.target) || "inconnu" },
        { label: "Prédicat conforme", value: item.intendedOutcome ? "MOTIVATES" : "UNLOCKS" }
      ],
      path: [item.source?.name, item.target?.name].filter(Boolean),
      action: item.intendedOutcome
        ? "Retyper l’arête en MOTIVATES, puis créer le CAUSES chiffré vers le system_state que cet effet recherché vise réellement."
        : "Retyper l’arête en UNLOCKS : la condition de possibilité est déjà correctement décrite par la famille enablement.",
      nodeId: item.targetId,
      relatedNodeIds: [item.sourceId, item.targetId],
      proposal: { kind: "retype_link", clusterId: clusterOf(item.target), sourceNodeId: item.sourceId, targetNodeId: item.targetId, predicate: item.link.type, suggestedPredicate: item.intendedOutcome ? "MOTIVATES" : "UNLOCKS" }
    }));
}

export function analyzeGraph(nodes, links, options = {}) {
  const scopedNodes = nodes;
  const scopedLinks = links;
  const index = buildIndex(scopedNodes, scopedLinks);
  const coverage = observability(scopedNodes, index);
  const findings = [
    ...questionFindings(scopedNodes, index),
    ...solutionFindings(scopedNodes, index),
    ...fragileClaimFindings(scopedLinks, index),
    ...contradictionFindings(scopedNodes, scopedLinks, index),
    ...consolidationFindings(scopedNodes, scopedLinks, index),
    ...structuralBottleneckFindings(scopedNodes, index),
    ...feedbackLoopFindings(scopedNodes, index),
    ...evidenceLeverageFindings(scopedNodes, index),
    ...causalGapFindings(scopedNodes, index, coverage),
    ...observabilityGapFindings(scopedNodes, index, coverage),
    ...unmeasuredStateFindings(scopedNodes, index),
    ...orphanMetricFindings(scopedNodes, index),
    ...unquantifiedCausalFindings(scopedLinks, index),
    ...mistypedCausalFindings(scopedLinks, index)
  ].sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "fr"));
  const categoryCounts = findings.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
  return {
    methodVersion: "1.5.0",
    typeResolution: {
      semantic: "semanticType",
      physical: "nodeType",
      compatibilityFallback: "nodeType when semanticType is absent",
      semanticVocabulary: "open"
    },
    generatedAt: new Date().toISOString(),
    disclaimer: "Le score de priorité est un indice heuristique de tri (impact aval, centralité, risque et lacunes). Ce n’est ni une probabilité, ni une confiance scientifique, ni une taille d’effet.",
    graph: {
      nodes: scopedNodes.length,
      links: scopedLinks.length
    },
    causalSaturation: causalSaturation(scopedNodes, index),
    observability: coverage,
    categoryCounts,
    findings
  };
}
