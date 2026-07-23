// Auto-description du moteur de questionnement local.
//
// Ces valeurs étaient auparavant des littéraux disséminés dans le fichier, et
// recopiés à la main dans DOCUMENTATION.md — où ils dérivaient sans que rien ne
// le signale. La règle est désormais : seul ce que le code exécute peut décrire
// le code. Chaque paramètre ci-dessous est lu par l'algorithme ET rendu par
// `npm run docs:parameters` ; il n'existe aucun second endroit où le recopier.
//
// `decisive` ne mesure pas l'importance ressentie mais une propriété testable :
// changer ce paramètre changerait-il une conclusion sur laquelle le projet agit
// (quels nœuds remontent, donc quelles lacunes sont traitées) ? Si oui, il doit
// porter un `decisionId` qui garde les options écartées — que le code, lui, ne
// conserve jamais. Voir `parameterContract` dans l'ontologie.
export const QUERY_TUNING = Object.freeze({
  module: "graph-query",
  label: "Moteur de questionnement local",
  purpose: "Extrait un cluster pertinent du corpus pour une question en langue naturelle. Il ne génère aucune réponse : il sélectionne et ordonne des nœuds existants.",
  parameters: Object.freeze({
    dimensions: { value: 512, unit: "dimensions", role: "Taille du vecteur de hachage projetant les termes TF-IDF.", decisive: false, decisionId: null },
    lexicalWeight: { value: 0.72, unit: "part", role: "Part de similarité lexicale dans le score sémantique.", decisive: true, decisionId: "decision-query-lexical-vector-blend" },
    vectorWeight: { value: 0.28, unit: "part", role: "Part de similarité vectorielle dans le score sémantique. Complément de lexicalWeight.", decisive: true, decisionId: "decision-query-lexical-vector-blend" },
    maxDepth: { value: 3, unit: "sauts", role: "Profondeur maximale de propagation depuis un ancrage.", decisive: true, decisionId: "decision-query-traversal-depth" },
    seedCount: { value: 5, unit: "nœuds", role: "Nombre d'ancrages initiaux retenus avant propagation.", decisive: true, decisionId: null },
    hopDecay: { value: 0.72, unit: "facteur", role: "Décroissance du score à chaque saut supplémentaire.", decisive: true, decisionId: null },
    inboundPenalty: { value: 0.82, unit: "facteur", role: "Pénalité appliquée à la traversée d'une arête dans le sens inverse.", decisive: true, decisionId: null },
    hierarchyBoostMax: { value: 0.18, unit: "part", role: "Bonus maximal accordé au poids d'une arête hiérarchique.", decisive: false, decisionId: null },
    defaultTraversalWeight: { value: 0.5, unit: "poids", role: "Poids structurel retenu quand une arête ne déclare aucun traversalWeight. Repli, mais il gouverne alors toute la propagation le long de cette arête.", decisive: true, decisionId: null },
    semanticScore: { value: 0.7, unit: "part", role: "Part du score sémantique dans le classement final.", decisive: true, decisionId: null },
    graphScore: { value: 0.3, unit: "part", role: "Part du score propagé dans le classement final. Complément de semanticScore.", decisive: true, decisionId: null },
    limit: { value: 12, unit: "nœuds", role: "Nombre de résultats classés retournés par défaut.", decisive: false, decisionId: null },
    semanticFloor: { value: 0.015, unit: "score", role: "Score sémantique minimal pour qu'un nœud soit candidat à l'ancrage.", decisive: false, decisionId: null },
    // Décisivité corrigée par la mesure : le jeu de référence montre que c'est ce
    // plancher, et non maxDepth, qui fixe la profondeur réellement atteinte. Mon
    // verdict initial (non décisif) était faux ; c'est le benchmark qui l'a dit.
    propagationFloor: { value: 0.02, unit: "score", role: "Score propagé minimal pour continuer à traverser une arête. Contrainte réellement liante de la traversée : c'est lui qui éteint la propagation avant maxDepth.", decisive: true, decisionId: null },
    rankFloor: { value: 0.018, unit: "score", role: "Score final minimal pour apparaître dans le résultat.", decisive: false, decisionId: null }
  }),
  limitation: "Moteur lexical : il reconnaît mal les synonymes absents du corpus. Le résultat est un cluster pertinent, jamais une réponse générée."
});

const P = Object.fromEntries(Object.entries(QUERY_TUNING.parameters).map(([key, spec]) => [key, spec.value]));

const STOP_WORDS = new Set([
  "a","ai","au","aux","avec","ce","ces","cette","dans","de","des","du","elle","en","est","et","eux","il","ils","je","la","le","les","leur","mais","me","meme","mes","ne","nos","notre","nous","on","ou","par","pas","pour","qu","que","qui","sa","se","ses","son","sur","ta","te","tes","tu","un","une","vos","votre","vous","y",
  "comment","combien","lequel","laquelle","lesquels","lesquelles","pourquoi","quel","quelle","quels","quelles",
  "the","a","an","and","are","as","at","be","by","for","from","how","in","is","it","of","on","or","that","this","to","was","what","when","where","which","who","why","with"
]);

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

function terms(value) {
  const words = normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
  const kept = words.filter(word => word.length > 1 && !STOP_WORDS.has(word));
  const output = [...kept.map(word => `w:${word}`)];
  for (let index = 0; index < kept.length - 1; index += 1) output.push(`b:${kept[index]}_${kept[index + 1]}`);
  for (const word of kept.filter(item => item.length >= 5)) {
    const wrapped = `^${word}$`;
    for (let index = 0; index <= wrapped.length - 3; index += 1) output.push(`c:${wrapped.slice(index, index + 3)}`);
  }
  return output;
}

function hashTerm(value, dimensions) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return { index: (hash >>> 1) % dimensions, sign: hash & 1 ? 1 : -1 };
}

function vectorize(text, idf, corpusSize, dimensions) {
  const counts = new Map();
  for (const term of terms(text)) counts.set(term, (counts.get(term) || 0) + 1);
  const vector = new Float32Array(dimensions);
  for (const [term, count] of counts) {
    const { index, sign } = hashTerm(term, dimensions);
    const weight = (1 + Math.log(count)) * (idf.get(term) || (Math.log(corpusSize + 1) + 1));
    vector[index] += sign * weight;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return vector;
}

function cosine(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return Math.max(0, score);
}

function lexicalCosine(leftTerms, rightTerms, idf, corpusSize) {
  const left = new Set(leftTerms.filter(term => term.startsWith("w:") || term.startsWith("b:")));
  const right = new Set(rightTerms.filter(term => term.startsWith("w:") || term.startsWith("b:")));
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const term of left) {
    const weight = idf.get(term) || (Math.log(corpusSize + 1) + 1);
    leftNorm += weight * weight;
    if (right.has(term)) dot += weight * weight;
  }
  for (const term of right) {
    const weight = idf.get(term) || 1;
    rightNorm += weight * weight;
  }
  return dot / (Math.sqrt(leftNorm * rightNorm) || 1);
}

function nodeText(node) {
  return [node.name, node.phrase, node.summary, node.nodeTypeLabel, node.ontologyFamily, node.family, node.region,
    node.hypothesisBasis, node.verificationNeeded, node.questionCategory, node.decisionNeeded,
    node.stateDimension, node.stateIndicator, node.forecastSignals, node.forecastAssumptions,
    node.forecastImpact, node.forecastResponse, node.epistemicLabel, node.epistemicStatus,
    node.contextId, node.context, node.definition, node.populationOrSystem, node.jurisdiction, node.metricId, node.methodId,
    node.quantificationStatus, ...(node.supportingNodes || [])].filter(Boolean).join(" ");
}

function idOf(value) { return typeof value === "object" ? value.id : value; }

export function buildGraphQueryEngine(rawNodes, rawLinks, options = {}) {
  const dimensions = options.dimensions || P.dimensions;
  const nodes = rawNodes;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const links = rawLinks.filter(link => nodeById.has(idOf(link.source)) && nodeById.has(idOf(link.target)));
  const documentFrequency = new Map();
  const documents = nodes.map(node => nodeText(node));
  const documentTerms = documents.map(document => terms(document));
  for (const document of documents) {
    for (const term of new Set(terms(document))) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
  const idf = new Map([...documentFrequency].map(([term, count]) => [term, Math.log((nodes.length + 1) / (count + 1)) + 1]));
  const vectors = new Map(nodes.map((node, index) => [node.id, vectorize(documents[index], idf, nodes.length, dimensions)]));
  const adjacency = new Map(nodes.map(node => [node.id, []]));
  for (const link of links) {
    const source = idOf(link.source);
    const target = idOf(link.target);
    const base = Number(link.traversalWeight ?? P.defaultTraversalWeight);
    const hierarchyBoost = 1 + Number(link.hierarchyWeight || 0) * P.hierarchyBoostMax;
    adjacency.get(source).push({ nodeId: target, link, weight: Math.min(1, base * hierarchyBoost), direction: "out" });
    adjacency.get(target).push({ nodeId: source, link, weight: Math.min(1, base * hierarchyBoost * P.inboundPenalty), direction: "in" });
  }

  return {
    metadata: { kind: "local-hybrid-idf-hash", dimensions, documents: nodes.length },
    query(question, queryOptions = {}) {
      // `tuning` surcharge les réglages exécutés le temps d'un appel. Réservé à la
      // mesure : un paramètre décisif qu'on ne peut pas faire varier ne peut pas
      // être comparé à une alternative, donc jamais justifié. Les réglages
      // appliqués à la construction de l'adjacence (inboundPenalty,
      // hierarchyBoostMax, defaultTraversalWeight) exigent de rebâtir le moteur.
      const t = { ...P, ...(queryOptions.tuning || {}) };
      const limit = queryOptions.limit || t.limit;
      const maxDepth = queryOptions.maxDepth ?? t.maxDepth;
      const seedCount = queryOptions.seedCount || t.seedCount;
      const queryVector = vectorize(question, idf, nodes.length, dimensions);
      const questionTerms = terms(question);
      const semantic = nodes.map((node, index) => ({
        id: node.id,
        score: lexicalCosine(questionTerms, documentTerms[index], idf, nodes.length) * t.lexicalWeight + cosine(queryVector, vectors.get(node.id)) * t.vectorWeight
      }))
        .filter(item => item.score > t.semanticFloor).sort((a, b) => b.score - a.score);
      const seeds = semantic.slice(0, seedCount);
      if (!seeds.length) return { question, nodes: [], links: [], results: [], metadata: this.metadata };

      const graphScores = new Map();
      const traces = new Map();
      const queue = seeds.map(seed => ({ id: seed.id, score: seed.score, depth: 0, trace: [seed.id] }));
      for (const seed of seeds) {
        graphScores.set(seed.id, seed.score);
        traces.set(seed.id, { depth: 0, ids: [seed.id] });
      }
      while (queue.length) {
        queue.sort((a, b) => b.score - a.score);
        const current = queue.shift();
        if (current.depth >= maxDepth) continue;
        for (const edge of adjacency.get(current.id) || []) {
          if (current.trace.includes(edge.nodeId)) continue;
          const propagated = current.score * edge.weight * t.hopDecay;
          if (propagated <= (graphScores.get(edge.nodeId) || 0) || propagated < t.propagationFloor) continue;
          const trace = [...current.trace, edge.nodeId];
          graphScores.set(edge.nodeId, propagated);
          traces.set(edge.nodeId, { depth: current.depth + 1, ids: trace });
          queue.push({ id: edge.nodeId, score: propagated, depth: current.depth + 1, trace });
        }
      }

      const semanticMap = new Map(semantic.map(item => [item.id, item.score]));
      const ranked = nodes.map(node => {
        const semanticScore = semanticMap.get(node.id) || 0;
        const graphScore = graphScores.get(node.id) || 0;
        return { node, semanticScore, graphScore, score: semanticScore * t.semanticScore + graphScore * t.graphScore, trace: traces.get(node.id) || { depth: 0, ids: [node.id] } };
      }).filter(item => item.score > t.rankFloor).sort((a, b) => b.score - a.score).slice(0, limit);

      const selectedIds = new Set(ranked.map(item => item.node.id));
      for (const item of ranked) for (const id of item.trace.ids) selectedIds.add(id);
      const clusterNodes = nodes.filter(node => selectedIds.has(node.id));
      const clusterLinks = links.filter(link => selectedIds.has(idOf(link.source)) && selectedIds.has(idOf(link.target)));
      return {
        question,
        nodes: clusterNodes,
        links: clusterLinks,
        results: ranked.map(item => ({
          nodeId: item.node.id, name: item.node.name, nodeTypeLabel: item.node.nodeTypeLabel || item.node.nodeType,
          score: item.score, semanticScore: item.semanticScore, graphScore: item.graphScore,
          depth: item.trace.depth, path: item.trace.ids.map(id => nodeById.get(id)?.name || id)
        })),
        metadata: this.metadata
      };
    }
  };
}
