import { createHash } from "node:crypto";
import { AFFECT_SEARCH_PROFILES, CORTEX_SEARCH_PROFILES } from "./intent-embedding-profile.js";

const idOf = endpoint => typeof endpoint === "object" ? endpoint?.id : endpoint;
const kindOf = node => String(node?.semanticType || node?.nodeType || "").toLowerCase();
const labelOf = node => node?.name || node?.phrase || node?.id;
const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

export const DEFAULT_CLUSTER_QUESTION_POLICY = Object.freeze({
  maxQuestions: 6,
  totalEnergyBudget: 1,
  minimumPriority: 0.08,
  maxAttemptsPerGap: 3,
  cooldownVersions: 2,
  innerFocusQuestionMultiplier: 1.5,
  outerFocusQuestionMultiplier: 0.5,
  factors: Object.freeze({ gap: 0.5, clusterEnergy: 0.2, cortex: 0.2, affect: 0.1 }),
  gapWeights: Object.freeze({
    objective_without_measure: 1,
    unresolved_question: 0.95,
    blocked_target: 0.9,
    claim_without_evidence: 0.75,
    executable_without_test: 0.7,
    objective_without_origin: 0.65
  })
});

const GAP_DEFINITIONS = Object.freeze({
  objective_without_measure: {
    dimensions: ["goal", "evidence"],
    predicates: ["MEASURED_BY", "MEASURES"],
    expectedNodeType: "thing",
    expectedSemanticTypes: ["metric"],
    allowedRelations: ["MEASURED_BY", "MEASURES"],
    creationPolicy: "link_existing_first_then_create_metric_if_absent",
    evidenceRequirement: "Définir une unité, une méthode de calcul et une condition observable de progrès.",
    question: node => `Quel indicateur mesurable permet de savoir si « ${labelOf(node)} » progresse réellement ?`
  },
  objective_without_origin: {
    dimensions: ["goal", "structure"],
    predicates: ["MOTIVATES", "DERIVED_FROM", "AUTHORED_BY"],
    expectedNodeType: "moment",
    expectedSemanticTypes: ["observation", "decision", "change"],
    allowedRelations: ["MOTIVATES", "DERIVED_FROM", "AUTHORED_BY"],
    creationPolicy: "link_existing_first_then_create_only_if_recalled_or_observed",
    evidenceRequirement: "Citer un Moment existant ou une expérience effectivement rappelée ; ne pas fabriquer de souvenir.",
    question: node => `Quel Moment, constat ou choix explique pourquoi « ${labelOf(node)} » est devenu un objectif ?`
  },
  unresolved_question: {
    dimensions: ["frontier", "evidence"],
    predicates: ["ADDRESSES", "OBSERVES", "DERIVED_FROM"],
    expectedNodeType: "narrative",
    expectedSemanticTypes: ["decision", "working_hypothesis", "idea"],
    allowedRelations: ["ADDRESSES"],
    creationPolicy: "link_existing_first_then_create_answer_with_explicit_uncertainty",
    evidenceRequirement: "Séparer réponse, hypothèse et inconnue résiduelle, avec les nœuds qui les soutiennent.",
    question: node => `Quelle réponse vérifiable traite maintenant la question « ${labelOf(node)} » ?`
  },
  blocked_target: {
    dimensions: ["risk", "frontier", "goal"],
    predicates: ["BLOCKS", "UNLOCKS", "IMPLEMENTS", "OPTION_FOR"],
    expectedNodeType: "thing",
    expectedSemanticTypes: ["unlock", "method", "mechanism"],
    allowedRelations: ["UNLOCKS", "IMPLEMENTS"],
    creationPolicy: "prefer_existing_capability_then_create_testable_missing_capability",
    evidenceRequirement: "Nommer le blocage observé, le changement attendu et un test qui peut invalider la capacité proposée.",
    question: (node, blocker) => `Quelle capacité ou voie non essayée peut lever le blocage de « ${labelOf(node)} »${blocker ? ` causé par « ${labelOf(blocker)} »` : ""} ?`
  },
  claim_without_evidence: {
    dimensions: ["evidence", "risk"],
    predicates: ["SUPPORTS_ESTIMATE", "OBSERVES", "TESTS", "DERIVED_FROM"],
    expectedNodeType: "moment",
    expectedSemanticTypes: ["observation", "experiment"],
    allowedRelations: ["OBSERVES", "TESTS", "CONTRADICTS"],
    creationPolicy: "link_existing_evidence_or_create_observation_only_from_trace",
    evidenceRequirement: "Fournir une trace, une observation ou un test ; conserver la contradiction si elle existe.",
    question: node => `Quel Moment, test ou fait soutient — ou contredit — « ${labelOf(node)} » ?`
  },
  executable_without_test: {
    dimensions: ["active", "evidence"],
    predicates: ["TESTS", "PRODUCES", "USES_METHOD"],
    expectedNodeType: "moment",
    expectedSemanticTypes: ["experiment"],
    allowedRelations: ["USES_METHOD", "PRODUCES"],
    creationPolicy: "create_experiment_only_with_executable_verification_command",
    evidenceRequirement: "La proposition doit inclure une commande exécutable et le résultat attendu avant toute observation de succès.",
    question: node => `Quel test exécutable démontre que « ${labelOf(node)} » fonctionne et détecte sa régression ?`
  }
});

function relationIndex(links) {
  const outgoing = new Map();
  const incoming = new Map();
  for (const link of links) {
    const source = idOf(link.source);
    const target = idOf(link.target);
    if (!outgoing.has(source)) outgoing.set(source, []);
    if (!incoming.has(target)) incoming.set(target, []);
    outgoing.get(source).push({ ...link, source, target });
    incoming.get(target).push({ ...link, source, target });
  }
  return { outgoing, incoming };
}

const hasRelation = (relations, types) => relations.some(link => types.includes(String(link.type).toUpperCase()));
const isGoal = node => /goal|objective|task/.test(kindOf(node))
  || (kindOf(node) === "system_state" && node.stateOrientation === "desirable");
const isQuestion = node => /question/.test(kindOf(node));
const isClaim = node => /hypothesis|decision|evaluation|preference|claim/.test(kindOf(node));
const isExecutable = node => /method|mechanism|tool|runtime/.test(kindOf(node))
  && (node.codePath || node.command || /runtime|runner|script/i.test(`${node.name || ""} ${node.summary || ""}`));

function detectGaps(nodes, links, selectedClusterIds) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const { outgoing, incoming } = relationIndex(links);
  const selected = selectedClusterIds?.length ? new Set(selectedClusterIds) : null;
  const gaps = [];
  const add = (gapType, node, extra = {}) => gaps.push({ gapType, node, ...extra });
  for (const node of nodes) {
    if (selected && !selected.has(node.clusterId || "(hors cluster)")) continue;
    const out = outgoing.get(node.id) || [];
    const inc = incoming.get(node.id) || [];
    if (isGoal(node)) {
      if (!hasRelation(out, ["MEASURED_BY"]) && !hasRelation(inc, ["MEASURES"])) add("objective_without_measure", node);
      if (!hasRelation([...out, ...inc], ["MOTIVATES", "DERIVED_FROM", "AUTHORED_BY"])) add("objective_without_origin", node);
    }
    if (isQuestion(node) && !hasRelation(inc, ["ADDRESSES"])) add("unresolved_question", node);
    if (isClaim(node) && !hasRelation([...out, ...inc], ["SUPPORTS", "OBSERVES", "TESTS", "DERIVED_FROM"])) add("claim_without_evidence", node);
    if (isExecutable(node) && !hasRelation(inc, ["TESTS", "USES_METHOD"])) add("executable_without_test", node);
    for (const blocked of inc.filter(link => String(link.type).toUpperCase() === "BLOCKS")) {
      if (!hasRelation(inc, ["UNLOCKS"])) add("blocked_target", node, { blocker: byId.get(blocked.source) });
    }
  }
  return gaps;
}

function normalizedFactors(policy) {
  const factors = { ...DEFAULT_CLUSTER_QUESTION_POLICY.factors, ...(policy.factors || {}) };
  const total = Object.values(factors).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) || 1;
  return Object.fromEntries(Object.entries(factors).map(([key, value]) => [key, Math.max(0, Number(value) || 0) / total]));
}

function clusterEnergyShares(nodes, energyByCluster) {
  const clusters = [...new Set(nodes.map(node => node.clusterId || "(hors cluster)"))];
  const clean = Object.fromEntries(clusters.map(cluster => [cluster, Math.max(0, Number(energyByCluster?.[cluster]) || 0)]));
  const total = Object.values(clean).reduce((sum, value) => sum + value, 0);
  if (total) return Object.fromEntries(Object.entries(clean).map(([key, value]) => [key, value / total]));
  const uniform = clusters.length ? 1 / clusters.length : 0;
  return Object.fromEntries(clusters.map(cluster => [cluster, uniform]));
}

function compatibility(definition, cortex, affectVector) {
  const overlap = definition.predicates.filter(predicate => cortex.predicates.includes(predicate)).length;
  const cortexScore = definition.predicates.length ? overlap / definition.predicates.length : 0;
  let affectScore = 0;
  let affectMass = 0;
  const activeAffects = [];
  for (const [affect, affectDefinition] of Object.entries(AFFECT_SEARCH_PROFILES)) {
    const intensity = clamp01(affectVector?.[affect]);
    if (!intensity) continue;
    activeAffects.push({ affect, intensity, searchText: affectDefinition.searchText });
    const boost = definition.dimensions.reduce((sum, dimension) => sum + (affectDefinition.componentBoosts[dimension] || 0), 0);
    affectScore += intensity * Math.min(1, boost);
    affectMass += intensity;
  }
  return { cortexScore, affectScore: affectMass ? affectScore / affectMass : 0, activeAffects };
}

function stableQuestionId(gapType, gapKey, cortexState) {
  const suffix = createHash("sha256").update([gapKey, cortexState].join("|")).digest("hex").slice(0, 12);
  return `question-${gapType}-${suffix}`;
}

function stableGapKey(gap, links) {
  const anchors = [gap.node.id, gap.blocker?.id].filter(Boolean).sort();
  const anchorSet = new Set(anchors);
  const structuralContext = links
    .map(link => ({ source: idOf(link.source), target: idOf(link.target), type: String(link.type).toUpperCase() }))
    .filter(link => anchorSet.has(link.source) || anchorSet.has(link.target))
    .map(link => `${link.source}|${link.type}|${link.target}`)
    .sort();
  const suffix = createHash("sha256")
    .update(JSON.stringify([gap.gapType, anchors, structuralContext]))
    .digest("hex")
    .slice(0, 16);
  return `gap-${gap.gapType}-${suffix}`;
}

export function compileClusterQuestions({
  nodes = [],
  links = [],
  selectedClusterIds = [],
  cortexState = "state-monitoring",
  affectVector = {},
  energyByCluster = {},
  policy = DEFAULT_CLUSTER_QUESTION_POLICY
} = {}) {
  const cortex = CORTEX_SEARCH_PROFILES[cortexState];
  if (!cortex) throw new Error(`Unknown Cortex state: ${cortexState}`);
  const resolvedPolicy = {
    ...DEFAULT_CLUSTER_QUESTION_POLICY,
    ...policy,
    gapWeights: { ...DEFAULT_CLUSTER_QUESTION_POLICY.gapWeights, ...(policy.gapWeights || {}) }
  };
  const factors = normalizedFactors(resolvedPolicy);
  const energyShares = clusterEnergyShares(nodes, energyByCluster);
  const candidates = detectGaps(nodes, links, selectedClusterIds).map(gap => {
    const definition = GAP_DEFINITIONS[gap.gapType];
    const compatibilityScores = compatibility(definition, cortex, affectVector);
    const clusterId = gap.node.clusterId || "(hors cluster)";
    const gapScore = clamp01(resolvedPolicy.gapWeights[gap.gapType]);
    const gapKey = stableGapKey(gap, links);
    const priority = factors.gap * gapScore
      + factors.clusterEnergy * clamp01(energyShares[clusterId])
      + factors.cortex * compatibilityScores.cortexScore
      + factors.affect * compatibilityScores.affectScore;
    return {
      id: stableQuestionId(gap.gapType, gapKey, cortexState),
      gapKey,
      text: definition.question(gap.node, gap.blocker),
      reason: `Le motif ${gap.gapType} est ouvert dans le cluster ${clusterId}; l'état ${cortexState} demande « ${cortex.question} »`,
      gapType: gap.gapType,
      sourceClusterId: clusterId,
      sourceNodeIds: [gap.node.id, gap.blocker?.id].filter(Boolean),
      cortexState,
      affectContext: compatibilityScores.activeAffects,
      expectedNodeType: definition.expectedNodeType,
      expectedSemanticTypes: definition.expectedSemanticTypes,
      allowedRelations: definition.allowedRelations,
      creationPolicy: definition.creationPolicy,
      evidenceRequirement: definition.evidenceRequirement,
      priority: Number(priority.toFixed(6)),
      priorityContributions: {
        gap: Number((factors.gap * gapScore).toFixed(6)),
        clusterEnergy: Number((factors.clusterEnergy * clamp01(energyShares[clusterId])).toFixed(6)),
        cortex: Number((factors.cortex * compatibilityScores.cortexScore).toFixed(6)),
        affect: Number((factors.affect * compatibilityScores.affectScore).toFixed(6))
      }
    };
  }).filter(question => question.priority >= resolvedPolicy.minimumPriority)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, resolvedPolicy.maxQuestions);

  const priorityTotal = candidates.reduce((sum, question) => sum + question.priority, 0);
  const budget = Math.max(0, Number(resolvedPolicy.totalEnergyBudget) || 0);
  let allocated = 0;
  return candidates.map((question, index) => {
    const rawEnergyBudget = index === candidates.length - 1
      ? budget - allocated
      : budget * question.priority / (priorityTotal || 1);
    const energyBudget = Number(Math.max(0, rawEnergyBudget).toFixed(9));
    allocated += energyBudget;
    return { ...question, energyBudget };
  });
}

export { GAP_DEFINITIONS as CLUSTER_GAP_DEFINITIONS };
