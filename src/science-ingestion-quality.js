import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const clamp = value => Math.max(0, Math.min(1, value));
const round = value => Math.round(value * 10000) / 10000;
const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase("fr");

const readJson = async (projectDir, relativePath) => JSON.parse(await fs.readFile(path.resolve(projectDir, relativePath), "utf8"));

function pagesFromLocator(locator, pageCount) {
  const text = String(locator || "");
  const pages = new Set();
  for (const match of text.matchAll(/pages?\s+(\d+)(?:\s*[-–]\s*(\d+))?/gi)) {
    const start = Number(match[1]);
    const end = Number(match[2] || start);
    for (let page = start; page <= end && page <= pageCount; page += 1) if (page > 0) pages.add(page);
  }
  return pages;
}

function graphConnectivity(nodes, links) {
  const adjacency = new Map(nodes.map(node => [node.id, new Set()]));
  const degree = new Map(nodes.map(node => [node.id, 0]));
  for (const link of links) {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
    degree.set(link.source, (degree.get(link.source) || 0) + 1);
    degree.set(link.target, (degree.get(link.target) || 0) + 1);
  }
  const seen = new Set();
  const components = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    let size = 0;
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      size += 1;
      for (const neighbor of adjacency.get(id) || []) if (!seen.has(neighbor)) stack.push(neighbor);
    }
    components.push(size);
  }
  return {
    componentCount: components.length,
    largestComponentNodes: Math.max(0, ...components),
    orphanNodeIds: nodes.filter(node => (degree.get(node.id) || 0) === 0).map(node => node.id)
  };
}

export async function evaluateIngestionQuality(candidate, projectDir) {
  const contract = await readJson(projectDir, candidate.ingestion.qualityContract);
  const sourceMetrics = await readJson(projectDir, candidate.ingestion.sourceMetrics);
  const reviews = await Promise.all((candidate.ingestion.reviews || []).map(review => readJson(projectDir, review)));
  const nodes = candidate.nodes || [];
  const links = candidate.links || [];
  const nodeType = new Map(nodes.map(node => [node.id, node.nodeType]));
  const representationText = nodes.flatMap(node => contract.textualCoverage.fields.map(field => String(node[field] || ""))).join("");
  const representationTextCharacters = representationText.length;
  const representationRatio = representationTextCharacters / sourceMetrics.extractedCharacterCount;
  const textualScore = clamp(representationRatio / contract.textualCoverage.targetRepresentationRatio);

  const localizedPages = new Set();
  for (const node of nodes) for (const page of pagesFromLocator(node.sourceLocator, sourceMetrics.pageCount)) localizedPages.add(page);
  const localizedSourceCharacters = [...localizedPages].reduce((total, page) => total + (sourceMetrics.pageCharacterCounts[page - 1] || 0), 0);

  const normalizedRepresentation = normalize(representationText);
  const concepts = sourceMetrics.expectedConcepts.map(concept => ({
    id: concept.id,
    present: concept.variants.some(variant => normalizedRepresentation.includes(normalize(variant))),
    matchedVariant: concept.variants.find(variant => normalizedRepresentation.includes(normalize(variant))) || null
  }));
  const matchedConcepts = concepts.filter(concept => concept.present).length;
  const conceptScore = concepts.length ? matchedConcepts / concepts.length : 0;

  const presentTypes = new Set(nodes.map(node => node.nodeType));
  const requiredTypes = contract.structuralCoverage.requiredTypes.map(type => ({ type, present: presentTypes.has(type) }));
  const chain = contract.structuralCoverage.requiredChain.map(step => ({
    ...step,
    present: links.some(link => link.type === step.relation && nodeType.get(link.source) === step.sourceType && nodeType.get(link.target) === step.targetType)
  }));
  const relationTypes = new Set(links.map(link => link.type));
  const typeCoverage = requiredTypes.filter(item => item.present).length / requiredTypes.length;
  const chainCoverage = chain.filter(item => item.present).length / chain.length;
  const relationDiversity = clamp(relationTypes.size / contract.structuralCoverage.minimumDistinctRelationTypes);
  const structuralScore = (typeCoverage + chainCoverage + relationDiversity) / 3;

  const connectivity = graphConnectivity(nodes, links);
  const largestComponentRatio = nodes.length ? connectivity.largestComponentNodes / nodes.length : 0;
  const nonOrphanRatio = nodes.length ? (nodes.length - connectivity.orphanNodeIds.length) / nodes.length : 0;
  const relationsPerNode = nodes.length ? links.length / nodes.length : 0;
  const densityScore = clamp(relationsPerNode / contract.structuralCoverage.targetRelationsPerNode);
  const typedLinkRatio = links.length ? links.filter(link => link.type && nodeType.has(link.source) && nodeType.has(link.target)).length / links.length : 0;
  const connectivityScore = (largestComponentRatio + nonOrphanRatio + densityScore + typedLinkRatio) / 4;

  const sourcePath = path.resolve(projectDir, candidate.source.sourcePath);
  const actualSourceHash = createHash("sha256").update(await fs.readFile(sourcePath)).digest("hex");
  const sourceHashMatches = actualSourceHash.toLowerCase() === String(candidate.source.sourceHash).toLowerCase();
  const evidence = nodes.filter(node => node.nodeType === "evidence");
  const claims = nodes.filter(node => node.nodeType === "claim");
  const evidenceWithLocatorRatio = evidence.length ? evidence.filter(node => node.sourceLocator).length / evidence.length : 0;
  const evidenceLocatedRatio = evidence.length ? evidence.filter(node => links.some(link => link.source === node.id && link.type === "LOCATED_IN" && nodeType.get(link.target) === "source_document")).length / evidence.length : 0;
  const claimsJustifiedRatio = claims.length ? claims.filter(node => links.some(link => link.source === node.id && link.type === "JUSTIFIED_BY" && nodeType.get(link.target) === "evidence")).length / claims.length : 0;
  const provenanceScore = ([sourceHashMatches ? 1 : 0, evidenceWithLocatorRatio, evidenceLocatedRatio, claimsJustifiedRatio].reduce((a, b) => a + b, 0)) / 4;

  const reviewDetails = reviews.map(review => {
    const reviewed = new Set(review.dimensionsReviewed || []);
    const dimensionCoverage = contract.agentReview.requiredDimensions.filter(dimension => reviewed.has(dimension)).length / contract.agentReview.requiredDimensions.length;
    const independence = review.independent ? "independent" : "non_independent";
    return {
      id: review.id,
      reviewer: review.reviewer,
      independent: review.independent,
      verdict: review.verdict,
      dimensionCoverage: round(dimensionCoverage),
      score: round(dimensionCoverage * contract.agentReview.independenceFactors[independence] * (contract.agentReview.verdictFactors[review.verdict] ?? 0))
    };
  });
  const agentReviewScore = Math.max(0, ...reviewDetails.map(review => review.score));

  const scores = {
    textualCoverage: round(textualScore),
    conceptCoverage: round(conceptScore),
    structuralCoverage: round(structuralScore),
    typedConnectivity: round(connectivityScore),
    provenanceCoverage: round(provenanceScore),
    agentReview: round(agentReviewScore)
  };
  const overall = round(Object.entries(contract.weights).reduce((total, [dimension, weight]) => total + scores[dimension] * weight, 0));
  const failedFloors = Object.entries(contract.readiness.dimensionFloors)
    .filter(([dimension, floor]) => scores[dimension] < floor)
    .map(([dimension, floor]) => ({ dimension, score: scores[dimension], floor }));
  const ready = overall >= contract.readiness.minimumOverall && failedFloors.length === 0;

  return {
    contractId: contract.id,
    status: ready ? "ready" : "partial",
    ready,
    overallReadinessScore: overall,
    minimumOverall: contract.readiness.minimumOverall,
    weights: contract.weights,
    scores,
    failedFloors,
    raw: {
      sourceTextCharacters: sourceMetrics.extractedCharacterCount,
      sourceWords: sourceMetrics.extractedWordCount,
      representationTextCharacters,
      representationRatio: round(representationRatio),
      minimumRepresentationRatio: contract.textualCoverage.minimumRepresentationRatio,
      targetRepresentationRatio: contract.textualCoverage.targetRepresentationRatio,
      localizedPages: [...localizedPages].sort((a, b) => a - b),
      localizedSourceCharacters,
      localizedSourceCharacterRatio: round(localizedSourceCharacters / sourceMetrics.extractedCharacterCount),
      conceptsExpected: concepts.length,
      conceptsMatched: matchedConcepts,
      concepts,
      requiredTypes,
      requiredChain: chain,
      distinctNodeTypes: presentTypes.size,
      distinctRelationTypes: relationTypes.size,
      nodeCount: nodes.length,
      relationCount: links.length,
      relationsPerNode: round(relationsPerNode),
      ...connectivity,
      sourceHashMatches,
      evidenceWithLocatorRatio: round(evidenceWithLocatorRatio),
      evidenceLocatedRatio: round(evidenceLocatedRatio),
      claimsJustifiedRatio: round(claimsJustifiedRatio),
      reviews: reviewDetails
    },
    interpretation: "Ce score mesure la readiness de l'ingestion. Il ne mesure ni la validité de l'étude, ni la certitude d'un claim, ni un seuil d'action."
  };
}
