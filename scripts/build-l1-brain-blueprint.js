import fs from "node:fs/promises";
import path from "node:path";
import { CORE_AFFECTS, emptyAffectVector } from "../src/l1-affective-runtime.js";

const args = new Map(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.split("=");
  return [key, value.join("=")];
}));

const sourcePath = args.get("--source");
const outputPath = args.get("--output") || "l1/data/l1-brain-blueprint-v0.1.graph.json";
const cortexSourcePath = args.get("--cortex-source") || "data/l1-design.json";
const affectSourcePath = args.get("--affect-source") || "l1/data/l1-affective-blueprint-v0.1.json";
const sensorySourcePath = args.get("--sensory-source") || "l1/data/l1-sensory-blueprint-v0.1.json";
const metacognitiveSourcePath = args.get("--metacognitive-source") || "l1/data/l1-metacognitive-blueprint-v0.1.json";
const humanSituationSourcePath = args.get("--human-situation-source") || "l1/data/l1-human-situation-blueprint-v0.1.json";
const citizenAIRolesSourcePath = args.get("--citizen-ai-roles-source") || "l1/data/l1-citizen-ai-roles-blueprint-v0.1.json";
const subentityAttributionSourcePath = args.get("--subentity-attribution-source") || "l1/data/l1-subentity-memory-attribution-blueprint-v0.1.json";
if (!sourcePath) throw new Error("Usage: node scripts/build-l1-brain-blueprint.js --source=<texte> [--output=<json>]");

const text = await fs.readFile(sourcePath, "utf8");
const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const allowedNodeTypes = ["Actor", "Moment", "Narrative", "Thing", "Space"];
const nodePattern = /^(\S+) — (Actor|Moment|Narrative|Thing|Space) \/ ([^—]+?) — ([^:]+): (.+)$/u;
const narrativePattern = /^(narrative-\S+) — (.+?) : (.+)$/u;
const edgePattern = /^(\S+) —([A-Z_]+)→ (\S+) · W=(-?\d+(?:\.\d+)?), P=(-?\d+(?:\.\d+)?), G=(-?\d+(?:\.\d+)?)(?:, S=(-?\d+(?:\.\d+)?))?$/u;
const clusterPattern = /^(\d{2}) · (.+)$/u;

const invariantStart = lines.indexOf("Invariants bloquants") + 1;
const questionStart = lines.indexOf("Questions explicitement laissées ouvertes");
const clustersStart = lines.indexOf("Clusters");
const invariants = lines.slice(invariantStart, questionStart).map(line => {
  const match = line.match(/^([^—]+) — (.+)$/u);
  if (!match) throw new Error(`Invariant illisible: ${line}`);
  return { id: match[1].trim(), statement: match[2].trim() };
});

const clusters = [];
const nodes = [];
const relations = [];
const nodeIds = new Set();
const relationKeys = new Set();
let currentCluster = null;
let section = null;

const addNode = node => {
  if (nodeIds.has(node.id)) return;
  nodeIds.add(node.id);
  nodes.push(node);
  if (currentCluster) currentCluster.nodeIds.push(node.id);
};

for (let index = clustersStart + 1; index < lines.length; index += 1) {
  const line = lines[index];
  if (line === "Relations inter-clusters principales") {
    currentCluster = null;
    section = "relations";
    continue;
  }
  if (line === "Validation automatique du livrable") break;
  if (line === "Justifications narratives") {
    section = "narratives";
    continue;
  }
  if (line === "Nodes fonctionnelles") {
    section = "nodes";
    continue;
  }
  if (line === "Relations internes principales") {
    section = "relations";
    continue;
  }

  const clusterMatch = line.match(clusterPattern);
  if (clusterMatch) {
    const nextLine = lines[index + 1];
    currentCluster = {
      id: `cluster-${clusterMatch[1]}`,
      order: Number(clusterMatch[1]),
      title: clusterMatch[2],
      objective: nextLine,
      nodeIds: [],
      relationIds: []
    };
    clusters.push(currentCluster);
    section = "objective";
    index += 1;
    continue;
  }

  if (section === "narratives") {
    const match = line.match(narrativePattern);
    if (!match) continue;
    const openQuestion = match[2].includes("— question ouverte");
    addNode({
      id: match[1],
      nodeType: "Narrative",
      semanticType: openQuestion ? "OpenQuestion" : "DesignJustification",
      facets: openQuestion ? ["blueprint", "justification", "open_question"] : ["blueprint", "justification"],
      name: match[2].replace(/ — question ouverte$/u, ""),
      description: match[3],
      epistemicStatus: openQuestion ? "unresolved" : "design_proposal",
      clusterId: currentCluster.id,
      citizen: false,
      injectsEnergy: false,
      initialEnergy: 0
    });
    continue;
  }

  if (section === "nodes") {
    const match = line.match(nodePattern);
    if (!match) continue;
    const [, id, nodeType, rawSemanticType, name, description] = match;
    const semanticType = rawSemanticType.trim();
    const citizen = nodeType === "Actor" && semanticType === "CitizenRole";
    const node = {
      id,
      nodeType,
      semanticType,
      facets: ["blueprint", currentCluster.id],
      name: name.trim(),
      description,
      epistemicStatus: "design_proposal",
      clusterId: currentCluster.id,
      citizen,
      injectsEnergy: citizen,
      initialEnergy: 0
    };
    if (semanticType === "GlobalWorkspace") {
      node.characterBudget = null;
      node.characterBudgetStatus = "configuration_required";
    }
    addNode(node);
    continue;
  }

  if (section === "relations") {
    const match = line.match(edgePattern);
    if (!match) continue;
    const [, source, type, target, rawW, rawP, rawG, rawS] = match;
    const key = `${source}|${type}|${target}|${rawW}|${rawP}|${rawG}|${rawS || ""}`;
    if (relationKeys.has(key)) throw new Error(`Relation dupliquée: ${key}`);
    relationKeys.add(key);
    const relation = {
      id: `edge-${String(relations.length + 1).padStart(4, "0")}`,
      source,
      target,
      type,
      physics: {
        W: Number(rawW),
        P: Number(rawP),
        G: Number(rawG),
        ...(rawS === undefined ? {} : { S: Number(rawS) })
      },
      justification: `Relation ${type} explicitement déclarée entre « ${source} » et « ${target} » dans le blueprint source.`,
      clusterId: currentCluster?.id || "inter-cluster"
    };
    relations.push(relation);
    if (currentCluster) currentCluster.relationIds.push(relation.id);
  }
}

const nodesById = new Map(nodes.map(node => [node.id, node]));
const missingEndpoints = relations.flatMap(relation => [relation.source, relation.target]).filter(id => !nodesById.has(id));
if (missingEndpoints.length) throw new Error(`Endpoints absents: ${[...new Set(missingEndpoints)].join(", ")}`);

const baseBodyCounts = { nodes: nodes.length, relations: relations.length, clusters: clusters.length };
const cortex = JSON.parse(await fs.readFile(cortexSourcePath, "utf8"));
const cortexCluster = clusters.find(cluster => cluster.id === "cluster-10");
if (!cortexCluster) throw new Error("Le cluster 10 des sous-entités est absent.");
const cortexTypeMap = {
  context: ["Space", "CortexExecutionSpace"],
  subentity_goal: ["Narrative", "SubentityGoal"],
  subentity_state_machine: ["Moment", "CortexState"],
  design_rationale: ["Narrative", "DesignJustification"],
  subentity_action: ["Thing", "CortexPrimitive"],
  decision: ["Moment", "Decision"],
  decision_option: ["Narrative", "DecisionOption"],
  mechanism: ["Narrative", "Mechanism"],
  method: ["Thing", "Method"]
};

for (const sourceNode of cortex.nodes) {
  const [nodeType, semanticType] = cortexTypeMap[sourceNode.semanticType] || [];
  if (!nodeType) throw new Error(`Type Cortex non projeté: ${sourceNode.semanticType}`);
  addNode({
    id: sourceNode.id,
    nodeType,
    semanticType,
    facets: ["blueprint", "cortex", sourceNode.semanticType],
    name: sourceNode.name,
    description: [sourceNode.phrase, sourceNode.summary].filter(Boolean).join(" "),
    epistemicStatus: sourceNode.epistemicStatus || "design_proposal",
    clusterId: cortexCluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0,
    sourceDesignId: sourceNode.id
  });
  if (!cortexCluster.nodeIds.includes(sourceNode.id)) cortexCluster.nodeIds.push(sourceNode.id);
}

// Corrections constitutionnelles explicites : une sous-entité est personnelle
// mais jamais citoyenne, et PULSE ne crée aucune énergie.
const subentityTemplate = nodes.find(node => node.id === "actor-subentities-subentity-template");
if (subentityTemplate) {
  subentityTemplate.description = "Actor interne personnel, citizen=false, portant mission, objectifs, peurs, stratégies, énergie citoyenne reçue, gates privilégiées et preuves-moments.";
}
const pulsePrimitive = nodes.find(node => node.id === "action-pulse");
if (pulsePrimitive) {
  pulsePrimitive.description = "Routage ciblé d'une quantité finie d'énergie citoyenne déjà disponible. PULSE transfère la volition sous conservation L4 et ne crée jamais une nouvelle pompe.";
}

const addDerivedRelation = ({ source, type, target, W = 0.85, P = 1, G = 1, S = 0.9, justification, condition, cluster = cortexCluster, provenance = "cortex_state_machine" }) => {
  if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error(`Relation Cortex orpheline: ${source} ${type} ${target}`);
  const key = `${source}|${type}|${target}|${W}|${P}|${G}|${S}`;
  if (relationKeys.has(key)) return;
  relationKeys.add(key);
  const relation = {
    id: `edge-${String(relations.length + 1).padStart(4, "0")}`,
    source,
    target,
    type,
    physics: { W, P, G, S },
    justification,
    clusterId: cluster.id,
    provenance
  };
  if (condition) relation.condition = condition;
  relations.push(relation);
  cluster.relationIds.push(relation.id);
};

for (const link of cortex.links) {
  addDerivedRelation({
    source: link.source,
    type: link.type,
    target: link.target,
    W: link.type === "PART_OF" ? 0.95 : 0.9,
    S: 0.95,
    justification: link.justification
  });
}

const actionRationales = [
  ["narrative-cortex-action-enfold", "Justification de ENFOLD", "ENFOLD matérialise la mémoire de travail en créant un regroupement temporaire de ressources utiles sans réécrire les axiomes lents.", "action-enfold"],
  ["narrative-cortex-action-release", "Justification de RELEASE", "RELEASE nettoie les liens de travail devenus inutiles et rend possibles le désengagement, la correction et l'oubli opérationnel.", "action-release"],
  ["narrative-cortex-action-gate-lock", "Justification de GATE_LOCK", "GATE_LOCK sépare l'attention volatile de la structure lente en modulant G sans altérer durablement W.", "action-gate-lock"],
  ["narrative-cortex-action-pulse", "Justification de PULSE", "PULSE représente un effort exécutif fini et ciblé sous la loi conservative de propagation L4 ; une sous-entité route cette énergie mais ne la crée pas.", "action-pulse"]
];
for (const [id, name, description, actionId] of actionRationales) {
  addNode({
    id,
    nodeType: "Narrative",
    semanticType: "DesignJustification",
    facets: ["blueprint", "cortex", "primitive_justification"],
    name,
    description,
    epistemicStatus: "design_proposal",
    clusterId: cortexCluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0
  });
  if (!cortexCluster.nodeIds.includes(id)) cortexCluster.nodeIds.push(id);
  addDerivedRelation({ source: id, type: "GROUNDS", target: "space-l1-design-cortex", W: 0.9, S: 0.95, justification: `${name} fonde le choix de la primitive dans la couche Cortex.` });
  addDerivedRelation({ source: id, type: "JUSTIFIES", target: actionId, W: 0.9, S: 0.95, justification: description });
  addDerivedRelation({ source: actionId, type: "IMPLEMENTS", target: id, W: 0.8, S: 0.9, justification: `${actionId} met en œuvre la justification portée par ${id}.` });
}

addDerivedRelation({ source: "space-l1-design-cortex", type: "PART_OF", target: "space-subentities", W: 0.95, S: 0.95, justification: "La machine Cortex décrit le cycle d'exécution des sous-entités et appartient donc au cluster des acteurs internes." });
addDerivedRelation({ source: "actor-subentities-subentity-template", type: "RUNS_IN", target: "space-l1-design-cortex", W: 0.9, S: 0.9, justification: "Une sous-entité exécute son cycle cognitif dans l'espace Cortex sans devenir une pompe énergétique souveraine." });
for (const goal of ["goal-realization", "goal-valence-boost", "goal-threat-avoidance", "goal-information-completeness"]) {
  addDerivedRelation({ source: goal, type: "PURSUED_BY", target: "actor-subentities-subentity-template", W: 0.8, S: 0.85, justification: "Cet objectif fait partie des pulsions disponibles pour une sous-entité runtime ; il n'est pas prérempli comme préférence personnelle." });
}

const transitions = [
  ["state-monitoring", "state-activation-evaluation", "stimulus local détecté"],
  ["state-activation-evaluation", "state-workspace-bidding", "utilité attendue du contrôle suffisante"],
  ["state-workspace-bidding", "state-targeting-planning", "enchère sélectionnée par le workspace"],
  ["state-targeting-planning", "state-execution", "cible et plan borné disponibles"],
  ["state-execution", "state-feedback-monitoring", "impulsion exécutée et retour observable"],
  ["state-feedback-monitoring", "state-execution", "erreur corrigeable et budget restant"],
  ["state-feedback-monitoring", "state-closure-consolidation", "succès observé"],
  ["state-feedback-monitoring", "state-frustration-pivot", "échec persistant ou budget épuisé"],
  ["state-closure-consolidation", "state-monitoring", "consolidation terminée et gates relâchées"],
  ["state-frustration-pivot", "state-monitoring", "stratégie libérée et blocage historisé"]
];
for (const [source, target, condition] of transitions) {
  addDerivedRelation({ source, type: "TRANSITIONS_TO", target, W: 0.85, S: 0.9, condition, justification: `Transition Cortex autorisée lorsque la condition « ${condition} » est satisfaite.` });
}

for (const [state, action] of [
  ["state-targeting-planning", "action-gate-lock"],
  ["state-execution", "action-enfold"],
  ["state-execution", "action-pulse"],
  ["state-feedback-monitoring", "action-pulse"],
  ["state-feedback-monitoring", "action-release"],
  ["state-closure-consolidation", "action-release"],
  ["state-frustration-pivot", "action-release"]
]) {
  addDerivedRelation({ source: state, type: "USES", target: action, W: 0.85, S: 0.9, justification: `${state} emploie ${action} pour produire son effet topologique sans injecter d'énergie nouvelle.` });
}

const lifecycleThings = [
  ["thing-subentities-similarity-reconciler", "Reconciliateur de sous-entites", "Compare signatures, buts, strategies, preferences et croyances. Il fusionne volontiers les croyances basses redondantes ou dominees en certitude, mais protege les identites hautes stables sauf quasi-duplication."],
  ["thing-subentities-soft-capacity-regulator", "Regulateur de capacite souple", "Transforme la proximite d'un attracteur d'environ dix sous-entites hautes en cout progressif de promotion. Il n'impose aucun maximum et laisse survivre une nouvelle partie fortement distincte et etayee."],
  ["thing-subentities-narrative-materializer", "Materialiseur narratif de sous-entite", "Quand une candidate acquiert poids, recurrence, stabilite et certitude, produit un nom, une personnalite observee et des preferences toutes reliees aux Moments qui les etayent."],
  ["thing-subentities-moment-controller-writer", "Scripteur du controleur actif", "Lors de la creation d'un Moment autobiographique, ecrit immediatement la sous-entite qui controlait le workspace, sa confiance et les alternatives encore plausibles."]
];
for (const [id, name, description] of lifecycleThings) {
  addNode({ id, nodeType: "Thing", semanticType: "SubentityLifecycleMechanism", facets: ["blueprint", "subentity_lifecycle"], name, description, epistemicStatus: "design_proposal", clusterId: cortexCluster.id, citizen: false, injectsEnergy: false, initialEnergy: 0 });
  if (!cortexCluster.nodeIds.includes(id)) cortexCluster.nodeIds.push(id);
  addDerivedRelation({ source: id, type: "PART_OF", target: "space-subentities", W: 0.95, S: 0.95, justification: `${name} appartient au cycle de vie des sous-entites.`, provenance: "subentity_lifecycle" });
}

const lifecycleRationales = [
  ["narrative-subentities-low-level-reconcile-high-level-protect", "Reconciliation asymetrique des niveaux", "Les croyances basses sont des hypotheses revisables : similarite ou contradiction dominee par une certitude nettement superieure justifient leur fusion tout en conservant la dissidence et ses preuves. Une sous-entite haute stable represente une strategie identitaire recurrente : la contradiction seule ne suffit donc jamais a la supprimer.", "thing-subentities-similarity-reconciler"],
  ["narrative-subentities-soft-equilibrium-not-cap", "Equilibre souple, jamais plafond", "Autour d'une dizaine de sous-entites hautes, la pression de capacite augmente continument le niveau de preuve requis et rapproche seulement les quasi-doublons. Aucun test de type maximum atteint ne bloque une partie distincte : dix est un attracteur ergonomique, pas une verite biologique ni une limite dure.", "thing-subentities-soft-capacity-regulator"],
  ["narrative-subentities-narrative-from-evidence", "Narratif gagne par les traces", "Nom, personnalite et preferences ne sont materialises qu'apres accumulation de poids, recurrence, stabilite et certitude. Chaque phrase reste qualifiee comme inference et cite les Moments sources afin d'eviter de fabriquer une personne a partir d'un pic affectif.", "thing-subentities-narrative-materializer"],
  ["narrative-memory-controller-captured-at-creation", "Controleur capture a la creation", "Le controleur actif appartient au contexte vecu du souvenir. L'enregistrer a la creation du Moment, avec confiance et alternatives, evite qu'une reconstruction ulterieure attribue retrospectivement l'experience a la mauvaise sous-entite.", "thing-subentities-moment-controller-writer"]
];
for (const [id, name, description, thingId] of lifecycleRationales) {
  addNode({ id, nodeType: "Narrative", semanticType: "DesignJustification", facets: ["blueprint", "subentity_lifecycle", "justification"], name, description, epistemicStatus: "design_proposal", clusterId: cortexCluster.id, citizen: false, injectsEnergy: false, initialEnergy: 0 });
  if (!cortexCluster.nodeIds.includes(id)) cortexCluster.nodeIds.push(id);
  addDerivedRelation({ source: id, type: "GROUNDS", target: "space-subentities", W: 0.9, S: 0.95, justification: description, provenance: "subentity_lifecycle" });
  addDerivedRelation({ source: id, type: "JUSTIFIES", target: thingId, W: 0.9, S: 0.95, justification: description, provenance: "subentity_lifecycle" });
  addDerivedRelation({ source: thingId, type: "IMPLEMENTS", target: id, W: 0.85, S: 0.9, justification: `${name} est implemente par ${thingId}.`, provenance: "subentity_lifecycle" });
}
addDerivedRelation({ source: "thing-subentities-subentity-detector", type: "FEEDS", target: "thing-subentities-similarity-reconciler", justification: "Les candidates detectees sont reconciliees avant promotion.", provenance: "subentity_lifecycle" });
addDerivedRelation({ source: "thing-subentities-soft-capacity-regulator", type: "MODULATES", target: "thing-subentities-narrative-materializer", justification: "La pression souple augmente progressivement le cout de materialisation d'une nouvelle identite haute.", provenance: "subentity_lifecycle" });
addDerivedRelation({ source: "thing-subentities-narrative-materializer", type: "MATERIALIZES", target: "actor-subentities-subentity-template", justification: "Le materialiseur instancie une sous-entite haute et ses narratifs a partir des preuves recurrentes.", provenance: "subentity_lifecycle" });
addDerivedRelation({ source: "thing-subentities-workspace-controller-attribution", type: "FEEDS", target: "thing-subentities-moment-controller-writer", justification: "L'attribution courante doit etre capturee avant la consolidation du Moment.", provenance: "subentity_lifecycle" });
addDerivedRelation({ source: "thing-subentities-moment-controller-writer", type: "ANNOTATES", target: "moment-memory-autobiographical", justification: "Ecrit CONTROLLED_WORKSPACE_DURING, confiance et alternatives au moment de la creation.", provenance: "subentity_lifecycle" });
addDerivedRelation({ source: "thing-subentities-moment-controller-writer", type: "COOPERATES_WITH", target: "thing-memory-controller-linker", justification: "Le scripteur runtime realise le contrat du linker memoire deja present dans le blueprint.", provenance: "subentity_lifecycle" });

const afterCortexCounts = { nodes: nodes.length, relations: relations.length, clusters: clusters.length };
const affect = JSON.parse(await fs.readFile(affectSourcePath, "utf8"));
const affectClusters = new Map();
for (const definition of affect.clusters) {
  const order = definition.sourceOrdinal - 1;
  const cluster = {
    id: `cluster-${String(order).padStart(2, "0")}`,
    order,
    sourceOrdinal: definition.sourceOrdinal,
    title: definition.title,
    objective: definition.objective,
    nodeIds: [],
    relationIds: []
  };
  if (clusters.some(existing => existing.id === cluster.id)) throw new Error(`Cluster affectif dupliqué: ${cluster.id}`);
  clusters.push(cluster);
  affectClusters.set(definition.sourceOrdinal, cluster);
  addNode({
    id: definition.spaceId,
    nodeType: "Space",
    semanticType: "BlueprintCluster",
    facets: ["blueprint", "affective_system"],
    name: `${String(order).padStart(2, "0")} · ${definition.title}`,
    description: definition.objective,
    epistemicStatus: "design_proposal",
    clusterId: cluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0
  });
  cluster.nodeIds.push(definition.spaceId);
  cluster.spaceId = definition.spaceId;
}

for (const narrative of affect.narratives) {
  const cluster = affectClusters.get(narrative.clusterOrdinal);
  if (!cluster) throw new Error(`Cluster affectif absent pour ${narrative.id}`);
  addNode({
    id: narrative.id,
    nodeType: "Narrative",
    semanticType: "DesignRationale",
    facets: ["blueprint", "affective_system", "justification"],
    name: narrative.name,
    description: narrative.statement,
    epistemicStatus: "design_proposal",
    clusterId: cluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0
  });
  cluster.nodeIds.push(narrative.id);
  addDerivedRelation({ source: narrative.id, type: "GROUNDS", target: cluster.spaceId, W: 0.9, S: 0.95, justification: narrative.statement, cluster, provenance: "affective_blueprint" });
}

for (const definition of affect.nodes) {
  const cluster = affectClusters.get(definition.clusterOrdinal);
  if (!cluster) throw new Error(`Cluster affectif absent pour ${definition.id}`);
  addNode({
    ...definition,
    facets: ["blueprint", "affective_system", ...definition.facets],
    epistemicStatus: "design_proposal",
    clusterId: cluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0,
    justifiedBy: undefined,
    clusterOrdinal: undefined
  });
  cluster.nodeIds.push(definition.id);
  addDerivedRelation({ source: definition.id, type: "PART_OF", target: cluster.spaceId, W: 0.95, S: 0.95, justification: `${definition.name} appartient au cluster affectif « ${cluster.title} ».`, cluster, provenance: "affective_blueprint" });
  for (const rationaleId of definition.justifiedBy) {
    addDerivedRelation({ source: rationaleId, type: "JUSTIFIES", target: definition.id, W: 0.9, S: 0.95, justification: `${nodes.find(node => node.id === rationaleId)?.description || rationaleId} Cette raison justifie directement ${definition.name}.`, cluster, provenance: "affective_blueprint" });
    if (definition.nodeType === "Thing") {
      addDerivedRelation({ source: definition.id, type: "IMPLEMENTS", target: rationaleId, W: 0.8, S: 0.9, justification: `${definition.name} met en œuvre la règle portée par ${rationaleId}.`, cluster, provenance: "affective_blueprint" });
    }
  }
}

for (const [definitions, clusterOrdinal, schemaId, runtimeId, entityKind, experienced] of [
  [affect.needsSystem.humanNeeds, 32, "thing-human-need-dimension-schema", "thing-human-need-state-estimator", "human_need", true],
  [affect.needsSystem.aiOperationalRequirements, 33, "thing-ai-operational-requirement-schema", "thing-ai-operational-requirement-monitor", "ai_operational_requirement", false]
]) {
  const cluster = affectClusters.get(clusterOrdinal);
  if (!cluster) throw new Error(`Cluster de besoins absent: ${clusterOrdinal}`);
  for (const definition of definitions) {
    addNode({
      ...definition,
      nodeType: "Thing",
      semanticType: entityKind === "human_need" ? "HumanNeedDimension" : "AIOperationalRequirement",
      facets: ["blueprint", "needs_system", entityKind, experienced ? "ExperiencedByHuman" : "NonPhenomenal"],
      epistemicStatus: affect.needsSystem.epistemicStatus,
      clusterId: cluster.id,
      entityKind,
      experienced,
      basisVersion: affect.needsSystem.basisVersion,
      citizen: false,
      injectsEnergy: false,
      initialEnergy: 0
    });
    cluster.nodeIds.push(definition.id);
    addDerivedRelation({
      source: definition.id,
      type: "INSTANCE_OF",
      target: schemaId,
      W: 0.95,
      S: 0.95,
      justification: `${definition.name} est une dimension de la base ${affect.needsSystem.basisVersion} et conserve sa description ainsi que ses effets comportementaux explicites.`,
      cluster,
      provenance: "needs_blueprint"
    });
    addDerivedRelation({
      source: definition.id,
      type: "CONFIGURES",
      target: runtimeId,
      W: 0.85,
      S: 0.9,
      justification: `${definition.name} configure le calcul de déficit qui peut produire les effets comportementaux déclarés, sans exécuter directement une action.`,
      cluster,
      provenance: "needs_blueprint"
    });
  }
}

for (const link of affect.links) {
  const sourceNode = nodes.find(node => node.id === link.source);
  const targetNode = nodes.find(node => node.id === link.target);
  if (!sourceNode || !targetNode) throw new Error(`Lien affectif orphelin: ${link.source} ${link.type} ${link.target}`);
  const sourceCluster = clusters.find(cluster => cluster.id === sourceNode.clusterId);
  addDerivedRelation({ source: link.source, type: link.type, target: link.target, W: 0.85, S: 0.9, justification: link.justification, cluster: sourceCluster || affectClusters.values().next().value, provenance: "affective_blueprint" });
}

const afterAffectCounts = { nodes: nodes.length, relations: relations.length, clusters: clusters.length };
const sensory = JSON.parse(await fs.readFile(sensorySourcePath, "utf8"));
for (const narrative of sensory.narratives) {
  const cluster = clusters.find(candidate => candidate.id === narrative.clusterId);
  if (!cluster) throw new Error(`Cluster sensoriel absent pour ${narrative.id}: ${narrative.clusterId}`);
  addNode({
    id: narrative.id,
    nodeType: "Narrative",
    semanticType: "DesignRationale",
    facets: ["blueprint", "sensory_system", "justification"],
    name: narrative.name,
    description: narrative.statement,
    epistemicStatus: "design_proposal",
    clusterId: cluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0
  });
  cluster.nodeIds.push(narrative.id);
  const clusterSpace = cluster.nodeIds.map(id => nodes.find(node => node.id === id)).find(node => node?.semanticType === "BlueprintCluster");
  if (!clusterSpace) throw new Error(`Space principal absent pour ${cluster.id}`);
  addDerivedRelation({ source: narrative.id, type: "GROUNDS", target: clusterSpace.id, W: 0.9, S: 0.95, justification: narrative.statement, cluster, provenance: "sensory_blueprint" });
}

for (const definition of sensory.nodes) {
  const cluster = clusters.find(candidate => candidate.id === definition.clusterId);
  if (!cluster) throw new Error(`Cluster sensoriel absent pour ${definition.id}: ${definition.clusterId}`);
  addNode({
    id: definition.id,
    nodeType: definition.nodeType,
    semanticType: definition.semanticType,
    facets: ["blueprint", "sensory_system", ...definition.facets],
    name: definition.name,
    description: definition.description,
    epistemicStatus: "design_proposal",
    clusterId: cluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0
  });
  cluster.nodeIds.push(definition.id);
  const clusterSpace = cluster.nodeIds.map(id => nodes.find(node => node.id === id)).find(node => node?.semanticType === "BlueprintCluster");
  addDerivedRelation({ source: definition.id, type: "PART_OF", target: clusterSpace.id, W: 0.95, S: 0.95, justification: `${definition.name} appartient au cluster « ${cluster.title} ».`, cluster, provenance: "sensory_blueprint" });
  for (const rationaleId of definition.justifiedBy) {
    addDerivedRelation({ source: rationaleId, type: "JUSTIFIES", target: definition.id, W: 0.9, S: 0.95, justification: `${nodes.find(node => node.id === rationaleId)?.description || rationaleId} Cette raison justifie directement ${definition.name}.`, cluster, provenance: "sensory_blueprint" });
    if (definition.nodeType === "Thing") addDerivedRelation({ source: definition.id, type: "IMPLEMENTS", target: rationaleId, W: 0.8, S: 0.9, justification: `${definition.name} met en œuvre ${rationaleId}.`, cluster, provenance: "sensory_blueprint" });
  }
}

for (const link of sensory.links) {
  const sourceNode = nodes.find(node => node.id === link.source);
  const targetNode = nodes.find(node => node.id === link.target);
  if (!sourceNode || !targetNode) throw new Error(`Lien sensoriel orphelin: ${link.source} ${link.type} ${link.target}`);
  const cluster = clusters.find(candidate => candidate.id === sourceNode.clusterId);
  addDerivedRelation({ source: link.source, type: link.type, target: link.target, W: 0.85, S: 0.9, justification: link.justification, cluster, provenance: "sensory_blueprint" });
}

const afterSensoryCounts = { nodes: nodes.length, relations: relations.length, clusters: clusters.length };
const metacognitive = JSON.parse(await fs.readFile(metacognitiveSourcePath, "utf8"));
for (const narrative of metacognitive.narratives) {
  const cluster = clusters.find(candidate => candidate.id === narrative.clusterId);
  if (!cluster) throw new Error(`Cluster métacognitif absent pour ${narrative.id}: ${narrative.clusterId}`);
  addNode({
    id: narrative.id,
    nodeType: "Narrative",
    semanticType: "DesignRationale",
    facets: ["blueprint", "metacognitive_system", "justification"],
    name: narrative.name,
    description: narrative.statement,
    epistemicStatus: "design_proposal",
    clusterId: cluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0
  });
  cluster.nodeIds.push(narrative.id);
  const clusterSpace = cluster.nodeIds.map(id => nodes.find(node => node.id === id)).find(node => node?.semanticType === "BlueprintCluster");
  if (!clusterSpace) throw new Error(`Space principal absent pour ${cluster.id}`);
  addDerivedRelation({ source: narrative.id, type: "GROUNDS", target: clusterSpace.id, W: 0.9, S: 0.95, justification: narrative.statement, cluster, provenance: "metacognitive_blueprint" });
}

for (const definition of metacognitive.nodes) {
  const cluster = clusters.find(candidate => candidate.id === definition.clusterId);
  if (!cluster) throw new Error(`Cluster métacognitif absent pour ${definition.id}: ${definition.clusterId}`);
  addNode({
    id: definition.id,
    nodeType: definition.nodeType,
    semanticType: definition.semanticType,
    facets: ["blueprint", "metacognitive_system", ...definition.facets],
    name: definition.name,
    description: definition.description,
    epistemicStatus: "design_proposal",
    clusterId: cluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0
  });
  cluster.nodeIds.push(definition.id);
  const clusterSpace = cluster.nodeIds.map(id => nodes.find(node => node.id === id)).find(node => node?.semanticType === "BlueprintCluster");
  if (!clusterSpace) throw new Error(`Space principal absent pour ${cluster.id}`);
  addDerivedRelation({ source: definition.id, type: "PART_OF", target: clusterSpace.id, W: 0.95, S: 0.95, justification: `${definition.name} appartient au cluster « ${cluster.title} ».`, cluster, provenance: "metacognitive_blueprint" });
  for (const rationaleId of definition.justifiedBy) {
    addDerivedRelation({ source: rationaleId, type: "JUSTIFIES", target: definition.id, W: 0.9, S: 0.95, justification: `${nodes.find(node => node.id === rationaleId)?.description || rationaleId} Cette raison justifie directement ${definition.name}.`, cluster, provenance: "metacognitive_blueprint" });
    if (definition.nodeType === "Thing") addDerivedRelation({ source: definition.id, type: "IMPLEMENTS", target: rationaleId, W: 0.8, S: 0.9, justification: `${definition.name} met en œuvre ${rationaleId}.`, cluster, provenance: "metacognitive_blueprint" });
  }
}

for (const link of metacognitive.links) {
  const sourceNode = nodes.find(node => node.id === link.source);
  const targetNode = nodes.find(node => node.id === link.target);
  if (!sourceNode || !targetNode) throw new Error(`Lien métacognitif orphelin: ${link.source} ${link.type} ${link.target}`);
  const cluster = clusters.find(candidate => candidate.id === sourceNode.clusterId);
  addDerivedRelation({ source: link.source, type: link.type, target: link.target, W: 0.85, S: 0.9, justification: link.justification, cluster, provenance: "metacognitive_blueprint" });
}

const afterMetacognitiveCounts = { nodes: nodes.length, relations: relations.length, clusters: clusters.length };
const citizenAIRoles = JSON.parse(await fs.readFile(citizenAIRolesSourcePath, "utf8"));
const roleSystemCluster = {
  id: "citizen-ai-role-system",
  order: clusters.length + 1,
  title: "Citizen AI · système universel de rôles",
  objective: citizenAIRoles.scope,
  nodeIds: [],
  relationIds: []
};
clusters.push(roleSystemCluster);

const addRoleSystemNode = (definition, cluster = roleSystemCluster) => {
  addNode({
    ...definition,
    facets: ["blueprint", "citizen_ai_role_system", ...(definition.facets || [])],
    epistemicStatus: definition.epistemicStatus || "design_proposal",
    clusterId: cluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0
  });
  if (!cluster.nodeIds.includes(definition.id)) cluster.nodeIds.push(definition.id);
};

addRoleSystemNode({
  id: "space-citizen-ai-role-system",
  nodeType: "Space",
  semanticType: "BlueprintCluster",
  name: "Système universel des rôles Citizen AI",
  description: citizenAIRoles.doctrine
});
addRoleSystemNode({
  id: "narrative-citizen-ai-role-reflection-contract",
  nodeType: "Narrative",
  semanticType: "ReflectionContract",
  name: "Contrat de réflexion des rôles Citizen AI",
  description: citizenAIRoles.reflectionContract.purpose,
  sequence: citizenAIRoles.reflectionContract.sequence,
  invariants: citizenAIRoles.reflectionContract.invariants,
  questionStatus: citizenAIRoles.reflectionContract.questionStatus,
  strategyStatus: citizenAIRoles.reflectionContract.strategyStatus,
  ideaStatus: citizenAIRoles.reflectionContract.ideaStatus,
  personalPrefill: false
});
addDerivedRelation({
  source: "narrative-citizen-ai-role-reflection-contract",
  type: "GROUNDS",
  target: "space-citizen-ai-role-system",
  justification: "Le contrat rend explicite la boucle question, stratégie, idée, vérification et apprentissage partagée par tous les rôles.",
  cluster: roleSystemCluster,
  provenance: "citizen_ai_roles_blueprint"
});
addRoleSystemNode(citizenAIRoles.actorArchetype);
addRoleSystemNode({ ...citizenAIRoles.instanceTemplate, template: true });
addDerivedRelation({
  source: citizenAIRoles.instanceTemplate.id,
  type: "INSTANCE_OF",
  target: citizenAIRoles.actorArchetype.id,
  justification: "Chaque L1 matérialise un seul Citizen AI personnel depuis l'archétype partagé, sans créer une seconde pompe souveraine.",
  cluster: roleSystemCluster,
  provenance: "citizen_ai_roles_blueprint"
});

for (const rationale of citizenAIRoles.rationales) {
  addRoleSystemNode({
    id: rationale.id,
    nodeType: "Narrative",
    semanticType: "DesignRationale",
    name: rationale.name,
    description: rationale.statement
  });
  addDerivedRelation({ source: rationale.id, type: "GROUNDS", target: "space-citizen-ai-role-system", justification: rationale.statement, cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
}

for (const [category, semanticType, statements] of [
  ["constitutional-belief", "ConstitutionalBelief", citizenAIRoles.constitutionalBeliefs],
  ["epistemic-prior", "EpistemicPrior", citizenAIRoles.epistemicPriors],
  ["operational-assumption", "OperationalAssumption", citizenAIRoles.operationalAssumptions]
]) {
  statements.forEach((statement, index) => {
    const id = `narrative-citizen-ai-${category}-${index + 1}`;
    addRoleSystemNode({ id, nodeType: "Narrative", semanticType, name: `${semanticType} · ${index + 1}`, description: statement, facets: [category] });
    addDerivedRelation({ source: id, type: "CONSTRAINS", target: citizenAIRoles.actorArchetype.id, justification: statement, cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
  });
}

for (const definition of citizenAIRoles.runtimeThings) {
  addRoleSystemNode({ ...definition, nodeType: "Thing", facets: ["BlueprintManaged", "RoleRuntime"] });
  addDerivedRelation({ source: definition.id, type: "PART_OF", target: "space-citizen-ai-role-system", justification: `${definition.name} appartient au runtime partagé des rôles.`, cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
}
for (const definition of citizenAIRoles.momentTemplates) {
  const activationRecordProperties = {
    leadRole: null,
    supportingRoles: [],
    inhibitedRoles: [],
    activationReason: null,
    citizenRequest: null,
    workspaceContext: null,
    knownAffectiveState: null,
    knownMetabolicState: null,
    permissions: [],
    actionsTaken: [],
    outcome: null,
    citizenCorrection: null
  };
  const properties = ["RoleActivationEvent", "CitizenAIRoleStateSnapshot"].includes(definition.semanticType) ? {
    ...activationRecordProperties,
    activationRecordFields: citizenAIRoles.activationRecordContract.fields,
    activationReasons: [],
    applicableLimits: [],
    delegatedActions: [],
    personalPrefill: false
  } : {};
  addRoleSystemNode({ ...definition, ...properties, nodeType: "Moment", description: `Template auditable : ${definition.name}. Aucun état personnel n'est prérempli.` });
  addDerivedRelation({ source: definition.id, type: "CONTROLLED_BY", target: citizenAIRoles.instanceTemplate.id, justification: "Une activation de rôle appartient au Citizen AI personnel unique qui l'a produite.", cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
}
for (const domain of citizenAIRoles.domains) {
  addRoleSystemNode({ ...domain, nodeType: "Space", semanticType: "InterventionDomain", facets: ["Universal", "RoleDomain"] });
  addDerivedRelation({ source: domain.id, type: "PART_OF", target: "space-citizen-ai-role-system", justification: `${domain.name} est un domaine universel d'intervention, jamais un contenu personnel prérempli.`, cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
}

const roleNodeIds = new Map();
for (const [roleIndex, role] of citizenAIRoles.roles.entries()) {
  const cluster = {
    id: `citizen-ai-role-${role.id}`,
    order: roleSystemCluster.order + roleIndex + 1,
    title: `Citizen AI · ${role.name}`,
    objective: role.mission,
    nodeIds: [],
    relationIds: []
  };
  clusters.push(cluster);
  const clusterSpaceId = `space-citizen-ai-role-${role.id}`;
  const roleId = `narrative-citizen-ai-role-${role.id}`;
  const rationaleId = `narrative-citizen-ai-role-${role.id}-rationale`;
  const behaviorId = `narrative-citizen-ai-role-${role.id}-policies`;
  const scriptId = `thing-citizen-ai-role-${role.id}-script`;
  const auditId = `thing-citizen-ai-role-${role.id}-audit`;
  const questionRationaleId = `narrative-citizen-ai-role-${role.id}-questions-rationale`;
  roleNodeIds.set(role.id, roleId);

  addRoleSystemNode({ id: clusterSpaceId, nodeType: "Space", semanticType: "CitizenAIRoleCluster", name: cluster.title, description: role.mission }, cluster);
  addRoleSystemNode({ id: roleId, nodeType: "Narrative", semanticType: "CitizenAIRole", name: role.name, description: role.mission, facets: ["Universal", "Enactable", "Normative"] }, cluster);
  addRoleSystemNode({ id: rationaleId, nodeType: "Narrative", semanticType: "DesignRationale", name: `Justification · ${role.name}`, description: role.rationale, facets: ["justification"] }, cluster);
  addRoleSystemNode({ id: behaviorId, nodeType: "Narrative", semanticType: "BehavioralPolicy", name: `Politiques · ${role.name}`, description: role.behaviors.join(" "), policies: role.behaviors }, cluster);
  addRoleSystemNode({ id: scriptId, nodeType: "Thing", semanticType: "Script", name: `Script de rôle · ${role.name}`, description: `Orchestre les capacités admises pour enact ${role.name} sous contrôle du routeur, des permissions et des limites.` }, cluster);
  addRoleSystemNode({ id: auditId, nodeType: "Thing", semanticType: "RoleAudit", name: `Audit · ${role.name}`, description: `Vérifie mission, attracteurs, risques, questions d'orientation, stratégies, idées, limites, permissions, handoff et résultat du rôle ${role.name}.` }, cluster);
  addRoleSystemNode({
    id: questionRationaleId,
    nodeType: "Narrative",
    semanticType: "DesignRationale",
    name: `Justification des questions · ${role.name}`,
    description: role.reflection.questionJustification,
    facets: ["justification", "role_reflection"]
  }, cluster);

  addDerivedRelation({ source: rationaleId, type: "JUSTIFIES", target: roleId, justification: role.rationale, cluster, provenance: "citizen_ai_roles_blueprint" });
  addDerivedRelation({ source: citizenAIRoles.actorArchetype.id, type: "CAN_ENACT", target: roleId, justification: `Le même Actor Citizen AI peut enact ${role.name} sans se fragmenter en agent souverain.`, cluster, provenance: "citizen_ai_roles_blueprint" });
  addDerivedRelation({ source: roleId, type: "FOLLOWS", target: behaviorId, justification: `Le rôle ${role.name} suit ses politiques comportementales explicites.`, cluster, provenance: "citizen_ai_roles_blueprint" });
  addDerivedRelation({ source: roleId, type: "IMPLEMENTED_BY", target: scriptId, justification: `Le script réalise le rôle sans constituer une autorisation autonome.`, cluster, provenance: "citizen_ai_roles_blueprint" });
  addDerivedRelation({ source: roleId, type: "OPERATES_IN", target: role.domain, justification: `${role.name} intervient dans le domaine ${role.domain}.`, cluster, provenance: "citizen_ai_roles_blueprint" });
  addDerivedRelation({ source: roleId, type: "AUDITED_BY", target: auditId, justification: `Toute activation de ${role.name} produit une trace vérifiable.`, cluster, provenance: "citizen_ai_roles_blueprint" });
  addDerivedRelation({ source: roleId, type: "PART_OF", target: clusterSpaceId, justification: `${role.name} est le centre de son cluster canonique.`, cluster, provenance: "citizen_ai_roles_blueprint" });
  addDerivedRelation({ source: auditId, type: "USES_METHOD", target: "narrative-citizen-ai-role-reflection-contract", justification: `L'audit de ${role.name} applique la boucle de réflexion universelle sans préremplir les réponses.`, cluster, provenance: "citizen_ai_roles_blueprint" });

  role.desires.forEach((statement, index) => {
    const id = `narrative-citizen-ai-role-${role.id}-desire-${index + 1}`;
    addRoleSystemNode({ id, nodeType: "Narrative", semanticType: "OperationalDesire", name: `Désir fonctionnel · ${role.name} · ${index + 1}`, description: statement, facets: ["BehavioralAttractor"] }, cluster);
    addDerivedRelation({ source: roleId, type: "SEEKS", target: id, justification: statement, cluster, provenance: "citizen_ai_roles_blueprint" });
  });
  role.fears.forEach((statement, index) => {
    const id = `narrative-citizen-ai-role-${role.id}-fear-${index + 1}`;
    addRoleSystemNode({ id, nodeType: "Narrative", semanticType: "OperationalFear", name: `Peur fonctionnelle · ${role.name} · ${index + 1}`, description: statement, facets: ["RiskAvoidance", "BehavioralAttractor"] }, cluster);
    addDerivedRelation({ source: roleId, type: "AVOIDS", target: id, justification: statement, cluster, provenance: "citizen_ai_roles_blueprint" });
  });
  role.limits.forEach((statement, index) => {
    const id = `narrative-citizen-ai-role-${role.id}-limit-${index + 1}`;
    addRoleSystemNode({ id, nodeType: "Narrative", semanticType: "ConstitutionalLimit", name: `Limite · ${role.name} · ${index + 1}`, description: statement }, cluster);
    addDerivedRelation({ source: roleId, type: "YIELDS_TO", target: id, justification: statement, cluster, provenance: "citizen_ai_roles_blueprint" });
  });
  role.capabilities.forEach(capability => {
    const capabilitySlug = capability.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    const id = `thing-citizen-ai-role-${role.id}-capability-${capabilitySlug}`;
    addRoleSystemNode({ id, nodeType: "Thing", semanticType: "Capability", name: capability, description: `Capacité requise par le rôle ${role.name}. Sa disponibilité et ses permissions doivent être prouvées au runtime.` }, cluster);
    addDerivedRelation({ source: roleId, type: "REQUIRES", target: id, justification: `${role.name} requiert ${capability}.`, cluster, provenance: "citizen_ai_roles_blueprint" });
    addDerivedRelation({ source: scriptId, type: "USES", target: id, justification: `Le script de ${role.name} utilise ${capability} sous permission.`, cluster, provenance: "citizen_ai_roles_blueprint" });
  });

  const questionIds = role.reflection.questions.map((prompt, index) => {
    const id = `narrative-citizen-ai-role-${role.id}-question-${index + 1}`;
    addRoleSystemNode({
      id,
      nodeType: "Narrative",
      semanticType: "RoleOrientationQuestion",
      name: `Question d'orientation · ${role.name} · ${index + 1}`,
      description: prompt,
      prompt,
      questionIndex: index + 1,
      status: citizenAIRoles.reflectionContract.questionStatus,
      answerPrefilled: false,
      facets: ["question", "role_reflection"]
    }, cluster);
    addDerivedRelation({ source: questionRationaleId, type: "JUSTIFIES", target: id, justification: role.reflection.questionJustification, cluster, provenance: "citizen_ai_roles_blueprint" });
    addDerivedRelation({ source: id, type: "TESTS", target: roleId, justification: `Cette question vérifie si ${role.name} comprend suffisamment le contexte, les limites et les inconnues avant d'intervenir.`, cluster, provenance: "citizen_ai_roles_blueprint" });
    return id;
  });

  const strategyIds = role.reflection.strategies.map((strategy, index) => {
    const id = `narrative-citizen-ai-role-${role.id}-strategy-${index + 1}`;
    const strategyRationaleId = `${id}-rationale`;
    addRoleSystemNode({
      id,
      nodeType: "Narrative",
      semanticType: "RoleStrategy",
      name: `Stratégie · ${role.name} · ${index + 1}`,
      description: strategy.statement,
      status: citizenAIRoles.reflectionContract.strategyStatus,
      requiresMandateForAction: true,
      facets: ["strategy", "role_reflection"]
    }, cluster);
    addRoleSystemNode({
      id: strategyRationaleId,
      nodeType: "Narrative",
      semanticType: "DesignRationale",
      name: `Justification de stratégie · ${role.name} · ${index + 1}`,
      description: strategy.justification,
      facets: ["justification", "role_reflection"]
    }, cluster);
    addDerivedRelation({ source: strategyRationaleId, type: "JUSTIFIES", target: id, justification: strategy.justification, cluster, provenance: "citizen_ai_roles_blueprint" });
    addDerivedRelation({ source: roleId, type: "FOLLOWS", target: id, justification: `${role.name} peut suivre cette stratégie lorsque les questions qu'elle traite sont pertinentes.`, cluster, provenance: "citizen_ai_roles_blueprint" });
    for (const questionIndex of strategy.addresses) {
      const questionId = questionIds[questionIndex - 1];
      if (!questionId) throw new Error(`Unknown question ${questionIndex} for role ${role.id} strategy ${index + 1}`);
      addDerivedRelation({ source: id, type: "ADDRESSES", target: questionId, justification: strategy.justification, cluster, provenance: "citizen_ai_roles_blueprint" });
    }
    return id;
  });

  role.reflection.ideas.forEach((idea, index) => {
    const id = `narrative-citizen-ai-role-${role.id}-idea-${index + 1}`;
    const ideaRationaleId = `${id}-rationale`;
    addRoleSystemNode({
      id,
      nodeType: "Narrative",
      semanticType: "InterventionIdea",
      name: `Idée d'intervention · ${role.name} · ${index + 1}`,
      description: idea.statement,
      status: citizenAIRoles.reflectionContract.ideaStatus,
      executable: false,
      requiresMandateForAction: true,
      facets: ["idea", "role_reflection", "proposal_only"]
    }, cluster);
    addRoleSystemNode({
      id: ideaRationaleId,
      nodeType: "Narrative",
      semanticType: "DesignRationale",
      name: `Justification d'idée · ${role.name} · ${index + 1}`,
      description: idea.justification,
      facets: ["justification", "role_reflection"]
    }, cluster);
    addDerivedRelation({ source: ideaRationaleId, type: "JUSTIFIES", target: id, justification: idea.justification, cluster, provenance: "citizen_ai_roles_blueprint" });
    addDerivedRelation({ source: roleId, type: "RECOMMENDS", target: id, justification: `Cette idée reste une proposition conditionnelle de ${role.name} et ne déclenche aucune action automatique.`, cluster, provenance: "citizen_ai_roles_blueprint" });
    for (const strategyIndex of idea.supports) {
      const strategyId = strategyIds[strategyIndex - 1];
      if (!strategyId) throw new Error(`Unknown strategy ${strategyIndex} for role ${role.id} idea ${index + 1}`);
      addDerivedRelation({ source: id, type: "OPTION_FOR", target: strategyId, justification: idea.justification, cluster, provenance: "citizen_ai_roles_blueprint" });
    }
  });
}

for (const conflict of citizenAIRoles.conflicts) {
  addDerivedRelation({
    source: roleNodeIds.get(conflict.source),
    type: "CAN_CONFLICT_WITH",
    target: roleNodeIds.get(conflict.target),
    justification: conflict.resolution,
    condition: conflict.resolution,
    cluster: clusters.find(candidate => candidate.id === `citizen-ai-role-${conflict.source}`),
    provenance: "citizen_ai_roles_blueprint"
  });
}

for (const roleId of roleNodeIds.values()) {
  addDerivedRelation({ source: "moment-citizen-ai-role-activation-event", type: "ENACTS", target: roleId, justification: "Le Moment enregistre quel rôle a réellement été activé.", cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
}
addDerivedRelation({ source: "thing-citizen-ai-role-activation-scorer", type: "FEEDS", target: "thing-citizen-ai-role-router", justification: "Les scores contextuels alimentent le choix explicable des rôles.", cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
addDerivedRelation({ source: "thing-citizen-ai-role-conflict-resolver", type: "CONSTRAINS", target: "thing-citizen-ai-role-router", justification: "Les conflits sont résolus avant publication du snapshot de rôles.", cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
addDerivedRelation({ source: "thing-citizen-ai-delegation-verifier", type: "GATES", target: roleNodeIds.get("executor"), justification: "L'exécuteur ne s'active que sous mandat vérifié.", cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
addDerivedRelation({ source: "thing-citizen-ai-consent-checker", type: "GATES", target: roleNodeIds.get("connector"), justification: "La mise en lien ne transmet rien sans consentement.", cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
addDerivedRelation({ source: roleNodeIds.get("sovereignty-guardian"), type: "CONSTRAINS", target: "thing-citizen-ai-role-router", justification: "Le gardien constitutionnel reste observateur transversal et peut inhiber une activation incompatible avec les droits.", cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
addDerivedRelation({ source: "thing-citizen-ai-role-router", type: "PRODUCES", target: "moment-citizen-ai-role-state-snapshot", justification: "Chaque arbitrage produit un snapshot corrigible avec rôle principal, soutiens, inhibitions, raisons et limites.", cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
addDerivedRelation({ source: "thing-citizen-ai-role-handoff-protocol", type: "PRODUCES", target: "moment-citizen-ai-role-handoff-event", justification: "Tout changement de rôle principal devient un événement auditable.", cluster: roleSystemCluster, provenance: "citizen_ai_roles_blueprint" });
addDerivedRelation({ source: "thing-ai-operational-requirement-monitor", type: "FEEDS", target: "thing-citizen-ai-role-activation-scorer", justification: "Les déficits opérationnels modifient le choix de rôle : clarification, recherche, vérification, repli, arrêt sûr ou évaluation, sans être interprétés comme des émotions.", cluster: roleSystemCluster, provenance: "needs_blueprint" });
addDerivedRelation({ source: "thing-ai-operational-requirement-schema", type: "CONSTRAINS", target: "actor-blueprint-citizen-ai", justification: "Le Citizen AI est décrit par des exigences fonctionnelles observables et non par des besoins biologiques ou phénoménaux.", cluster: roleSystemCluster, provenance: "needs_blueprint" });

const afterCitizenAIRoleCounts = { nodes: nodes.length, relations: relations.length, clusters: clusters.length };
const humanSituation = JSON.parse(await fs.readFile(humanSituationSourcePath, "utf8"));
const humanSituationCluster = {
  id: humanSituation.cluster.id,
  order: humanSituation.cluster.order,
  title: humanSituation.cluster.title,
  objective: humanSituation.cluster.objective,
  nodeIds: [],
  relationIds: []
};
if (clusters.some(existing => existing.id === humanSituationCluster.id || existing.order === humanSituationCluster.order)) {
  throw new Error(`Cluster de situation humaine dupliqué: ${humanSituationCluster.id}`);
}
clusters.push(humanSituationCluster);

const addHumanSituationNode = definition => {
  addNode({
    ...definition,
    facets: ["blueprint", "human_situation_system", ...(definition.facets || [])],
    epistemicStatus: definition.epistemicStatus || "design_proposal",
    clusterId: humanSituationCluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0,
    justifiedBy: undefined
  });
  if (!humanSituationCluster.nodeIds.includes(definition.id)) humanSituationCluster.nodeIds.push(definition.id);
};

for (const narrative of humanSituation.narratives) {
  addHumanSituationNode({
    id: narrative.id,
    nodeType: "Narrative",
    semanticType: narrative.semanticType,
    name: narrative.name,
    description: narrative.statement,
    facets: ["justification"]
  });
  addDerivedRelation({
    source: narrative.id,
    type: "GROUNDS",
    target: humanSituation.cluster.spaceId,
    justification: narrative.statement,
    cluster: humanSituationCluster,
    provenance: "human_situation_blueprint"
  });
}

for (const definition of humanSituation.nodes) {
  addHumanSituationNode(definition);
  if (definition.id !== humanSituation.cluster.spaceId) {
    addDerivedRelation({
      source: definition.id,
      type: "PART_OF",
      target: humanSituation.cluster.spaceId,
      justification: `${definition.name} appartient au modèle de situation humaine et partagée.`,
      cluster: humanSituationCluster,
      provenance: "human_situation_blueprint"
    });
  }
  for (const rationaleId of definition.justifiedBy || []) {
    addDerivedRelation({
      source: rationaleId,
      type: "JUSTIFIES",
      target: definition.id,
      justification: `${nodes.find(node => node.id === rationaleId)?.description || rationaleId} Cette raison justifie directement ${definition.name}.`,
      cluster: humanSituationCluster,
      provenance: "human_situation_blueprint"
    });
    if (definition.nodeType === "Thing") {
      addDerivedRelation({
        source: definition.id,
        type: "IMPLEMENTS",
        target: rationaleId,
        justification: `${definition.name} met en œuvre la règle portée par ${rationaleId}.`,
        cluster: humanSituationCluster,
        provenance: "human_situation_blueprint"
      });
    }
  }
}

for (const link of humanSituation.links) {
  if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
    throw new Error(`Lien de situation humaine orphelin: ${link.source} ${link.type} ${link.target}`);
  }
  addDerivedRelation({
    source: link.source,
    type: link.type,
    target: link.target,
    justification: link.justification,
    cluster: humanSituationCluster,
    provenance: "human_situation_blueprint"
  });
}
const afterHumanSituationCounts = { nodes: nodes.length, relations: relations.length, clusters: clusters.length };

const subentityAttribution = JSON.parse(await fs.readFile(subentityAttributionSourcePath, "utf8"));
const attributionCluster = cortexCluster;
const attributionSpaceId = "space-subentity-memory-attribution";
const attributionNodeIds = [];
const addAttributionNode = definition => {
  addNode({
    ...definition,
    facets: ["blueprint", "subentity_memory_attribution", ...(definition.facets || [])],
    epistemicStatus: definition.epistemicStatus || "design_proposal",
    clusterId: attributionCluster.id,
    citizen: false,
    injectsEnergy: false,
    initialEnergy: 0
  });
  if (!attributionCluster.nodeIds.includes(definition.id)) attributionCluster.nodeIds.push(definition.id);
  attributionNodeIds.push(definition.id);
};
const parsePair = entry => {
  const [key, ...description] = String(entry).split("|");
  return { key, description: description.join("|") };
};

addAttributionNode({
  id: attributionSpaceId,
  nodeType: "Space",
  semanticType: "BlueprintSubcluster",
  name: "Attribution mémorielle des sous-entités",
  description: subentityAttribution.doctrine
});

const attributionCollections = [
  ["principles", "narrative-attribution-principle", "Narrative", "DesignPrinciple", "Principe"],
  ["justifications", "narrative-attribution-justification", "Narrative", "DesignJustification", "Justification"],
  ["risks", "narrative-attribution-risk", "Narrative", "Risk", "Risque"],
  ["scenarios", "moment-attribution-scenario", "Moment", "ValidationScenario", "Scénario"],
  ["relationDefinitions", "thing-attribution-relation", "Thing", "AttributionRelationContract", "Relation"],
  ["modes", "narrative-attribution-mode", "Narrative", "AttributionMode", "Mode"],
  ["contractFields", "thing-attribution-field", "Thing", "AttributionContractField", "Champ"],
  ["guardrails", "narrative-attribution-guardrail", "Narrative", "ConstitutionalGuardrail", "Garde-fou"],
  ["momentTemplates", "moment-attribution-template", "Moment", "RuntimeMomentTemplate", "Moment template"],
  ["decisions", "moment-attribution-decision", "Moment", "Decision", "Décision"]
];
const attributionIds = {};
for (const [collection, prefix, nodeType, semanticType, label] of attributionCollections) {
  attributionIds[collection] = subentityAttribution[collection].map((entry, index) => {
    const pair = parsePair(entry);
    const id = `${prefix}-${index + 1}`;
    addAttributionNode({
      id,
      nodeType,
      semanticType,
      name: `${label} · ${pair.key || index + 1}`,
      description: pair.description || pair.key
    });
    return id;
  });
}

attributionIds.mechanisms = subentityAttribution.mechanisms.map(entry => {
  const pair = parsePair(entry);
  const id = `thing-attribution-${pair.key}`;
  addAttributionNode({
    id,
    nodeType: "Thing",
    semanticType: "MemoryAttributionMechanism",
    name: pair.key,
    description: pair.description
  });
  return id;
});

for (const id of attributionNodeIds.filter(id => id !== attributionSpaceId)) {
  addDerivedRelation({
    source: id,
    type: "PART_OF",
    target: attributionSpaceId,
    justification: `${id} appartient au contrat d'attribution mémorielle des sous-entités.`,
    cluster: attributionCluster,
    provenance: "subentity_memory_attribution"
  });
}
attributionIds.justifications.forEach((id, index) => addDerivedRelation({
  source: id,
  type: "JUSTIFIES",
  target: attributionIds.principles[index],
  justification: subentityAttribution.justifications[index],
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
}));
attributionIds.principles.forEach((id, index) => addDerivedRelation({
  source: id,
  type: "CONSTRAINS",
  target: attributionIds.mechanisms[index % attributionIds.mechanisms.length],
  justification: subentityAttribution.principles[index],
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
}));
attributionIds.risks.forEach((id, index) => addDerivedRelation({
  source: id,
  type: "MITIGATED_BY",
  target: attributionIds.mechanisms[(index + 3) % attributionIds.mechanisms.length],
  justification: `Le mécanisme ciblé réduit le risque « ${subentityAttribution.risks[index]} ».`,
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
}));
attributionIds.scenarios.forEach((id, index) => addDerivedRelation({
  source: id,
  type: "VALIDATES",
  target: attributionIds.mechanisms[index % attributionIds.mechanisms.length],
  justification: subentityAttribution.scenarios[index],
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
}));
for (const id of attributionIds.relationDefinitions) addDerivedRelation({
  source: id,
  type: "CONFIGURES",
  target: "thing-attribution-attribution-engine",
  justification: "Le contrat de relation configure l'écriture de l'attribution.",
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
});
for (const id of attributionIds.modes) addDerivedRelation({
  source: id,
  type: "CONFIGURES",
  target: "thing-attribution-attribution-engine",
  justification: "Le mode choisi qualifie explicitement la provenance temporelle et l'incertitude.",
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
});
for (const id of attributionIds.contractFields) addDerivedRelation({
  source: id,
  type: "CONFIGURES",
  target: "thing-attribution-attribution-contract",
  justification: "Ce champ appartient au contrat de données versionné.",
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
});
for (let index = 0; index < attributionIds.mechanisms.length - 1; index += 1) addDerivedRelation({
  source: attributionIds.mechanisms[index],
  type: "FEEDS",
  target: attributionIds.mechanisms[index + 1],
  justification: "Le pipeline conserve l'ordre causal entre sélection, snapshot, attribution, correction, audit et projection.",
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
});
attributionIds.guardrails.forEach((id, index) => addDerivedRelation({
  source: id,
  type: "CONSTRAINS",
  target: index % 2 ? "thing-attribution-workspace-selector" : "thing-attribution-attribution-engine",
  justification: subentityAttribution.guardrails[index],
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
}));
attributionIds.momentTemplates.forEach((id, index) => addDerivedRelation({
  source: id,
  type: "PRODUCED_BY",
  target: attributionIds.mechanisms[(index + 1) % attributionIds.mechanisms.length],
  justification: "Le Moment runtime est produit par un mécanisme explicite et auditable.",
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
}));
attributionIds.decisions.forEach((id, index) => addDerivedRelation({
  source: id,
  type: "DECIDES",
  target: attributionIds.mechanisms[index],
  justification: subentityAttribution.decisions[index],
  cluster: attributionCluster,
  provenance: "subentity_memory_attribution"
}));
for (const entry of subentityAttribution.crossLinks) {
  const [source, type, target] = entry.split("|");
  addDerivedRelation({
    source,
    type,
    target,
    justification: `Le contrat d'attribution relie ${source} à ${target} sans créer d'énergie ni transférer la propriété du Moment.`,
    cluster: attributionCluster,
    provenance: "subentity_memory_attribution"
  });
}
const afterSubentityAttributionCounts = { nodes: nodes.length, relations: relations.length, clusters: clusters.length };

// Chaque lien porte le même contrat affectif extensible. Les valeurs initiales
// sont des priors de blueprint faibles, jamais un profil psychologique personnel.
// Le contexte runtime décide si une polarité négative devient surprise,
// frustration, peur ou colère.
for (const relation of relations) {
  const vector = emptyAffectVector();
  if ((relation.physics?.P ?? 1) < 0) vector.surprise = 0.15;
  if (relation.type === "BLOCKS") {
    vector.surprise = 0.2;
    vector.frustration = 0.35;
    vector.fearOfError = 0.15;
  }
  if (relation.type === "MOTIVATES") vector.desire = 0.2;
  relation.affectVector = vector;
  relation.affectProfile = {
    origin: "blueprint_prior",
    observationCount: 0,
    learned: false,
    personal: false
  };
}

clusters.sort((left, right) => left.order - right.order);
const declaredCounts = { nodes: 212, relations: 764, clusters: 23 };
const actualCounts = { nodes: nodes.length, relations: relations.length, clusters: clusters.length };
const graph = {
  schemaVersion: "0.1.0",
  graphId: "l1-brain-blueprint-v0.1",
  name: "L1 Brain Blueprint — graphe complet v0.1",
  language: "fr",
  status: "design_blueprint",
  l4PhysicsVersion: "1.9.1",
  purpose: "Blueprint machine-readable du cerveau L1 : constitution, perception, routage énergétique, cognition, mémoire, action, apprentissage, souveraineté et validation.",
  allowedNodeTypes,
  physics: {
    fluxFormula: "I = E × W × P × G",
    conservation: "strict",
    energyTimescale: "fast",
    weightTimescale: "slow",
    nonlinearActivationThreshold: null
  },
  declaredCounts,
  baseBodyCounts,
  cortexAugmentationCounts: {
    nodes: afterCortexCounts.nodes - baseBodyCounts.nodes,
    relations: afterCortexCounts.relations - baseBodyCounts.relations
  },
  affectiveAugmentationCounts: {
    nodes: afterAffectCounts.nodes - afterCortexCounts.nodes,
    relations: afterAffectCounts.relations - afterCortexCounts.relations,
    clusters: afterAffectCounts.clusters - afterCortexCounts.clusters
  },
  sensoryAugmentationCounts: {
    nodes: afterSensoryCounts.nodes - afterAffectCounts.nodes,
    relations: afterSensoryCounts.relations - afterAffectCounts.relations,
    clusters: afterSensoryCounts.clusters - afterAffectCounts.clusters
  },
  metacognitiveAugmentationCounts: {
    nodes: afterMetacognitiveCounts.nodes - afterSensoryCounts.nodes,
    relations: afterMetacognitiveCounts.relations - afterSensoryCounts.relations,
    clusters: afterMetacognitiveCounts.clusters - afterSensoryCounts.clusters
  },
  citizenAIRoleAugmentationCounts: {
    nodes: afterCitizenAIRoleCounts.nodes - afterMetacognitiveCounts.nodes,
    relations: afterCitizenAIRoleCounts.relations - afterMetacognitiveCounts.relations,
    clusters: afterCitizenAIRoleCounts.clusters - afterMetacognitiveCounts.clusters
  },
  humanSituationAugmentationCounts: {
    nodes: afterHumanSituationCounts.nodes - afterCitizenAIRoleCounts.nodes,
    relations: afterHumanSituationCounts.relations - afterCitizenAIRoleCounts.relations,
    clusters: afterHumanSituationCounts.clusters - afterCitizenAIRoleCounts.clusters
  },
  subentityMemoryAttributionAugmentationCounts: {
    nodes: afterSubentityAttributionCounts.nodes - afterHumanSituationCounts.nodes,
    relations: afterSubentityAttributionCounts.relations - afterHumanSituationCounts.relations,
    clusters: afterSubentityAttributionCounts.clusters - afterHumanSituationCounts.clusters
  },
  actualCounts,
  sourceAudit: {
    sources: [path.resolve(sourcePath), path.resolve(cortexSourcePath), path.resolve(affectSourcePath), path.resolve(sensorySourcePath), path.resolve(metacognitiveSourcePath), path.resolve(humanSituationSourcePath), path.resolve(citizenAIRolesSourcePath), path.resolve(subentityAttributionSourcePath)],
    extraction: "Le corps structuré du blueprint est autoritaire pour ses 23 clusters. La machine Cortex est projetée depuis l1-design.json. L'extension affective ajoute dix clusters. Le pont sensoriel et l'extension métacognitive complètent les clusters existants. Le modèle de situation humaine ajoute le cluster 33, trois frames séparées et leur projection bornée vers le workspace. Le système Citizen AI ajoute un Actor archétype, un template d'instance non souverain, un runtime partagé et quinze clusters de rôles fonctionnels explicites. Le package d'attribution mémorielle ajoute 99 nodes et 206 relations au cluster des sous-entités.",
    discrepancies: [
      `Le résumé du blueprint annonce ${declaredCounts.nodes} nœuds, tandis que son corps contient ${baseBodyCounts.nodes} IDs uniques avant intégration Cortex.`,
      `Le résumé du blueprint annonce ${declaredCounts.relations} relations, tandis que son corps contient ${baseBodyCounts.relations} relations explicites avant intégration Cortex.`
    ]
  },
  invariants,
  affectiveSystem: {
    doctrine: affect.doctrine,
    formulas: affect.formulas,
    stateHierarchy: affect.stateHierarchy,
    tick: affect.tick,
    personalPrefill: false,
    linkAffect: {
      dimensions: CORE_AFFECTS,
      range: [0, 1],
      sparseExtensionAllowed: true,
      rule: "La polarité contribue au signal mais ne choisit jamais seule l'émotion ; contradiction, blocage, menace, frontière, contrôle et répétition restent explicites.",
      learningRule: "Un profil de lien personnel ne change qu'après répétitions suffisantes sous un learningRate explicite."
    },
    homeostasis: {
      fundamentalGoal: true,
      selection: "Une émotion ne domine que si elle franchit un seuil configuré et dépasse la suivante d'une marge configurée.",
      output: "Le contrôleur propose un comportement qui réduit l'erreur affective ; il n'exécute jamais directement une action."
    }
  },
  needsSystem: {
    basisVersion: affect.needsSystem.basisVersion,
    distinction: affect.needsSystem.distinction,
    epistemicStatus: affect.needsSystem.epistemicStatus,
    vectorContract: affect.needsSystem.vectorContract,
    formulas: affect.needsSystem.formulas,
    human: {
      entityKind: "human_need",
      experienced: true,
      dimensions: affect.needsSystem.humanNeeds
    },
    ai: {
      entityKind: "ai_operational_requirement",
      experienced: false,
      dimensions: affect.needsSystem.aiOperationalRequirements
    }
  },
  sensorySystem: {
    scope: sensory.scope,
    configContract: sensory.configContract,
    selectionRule: "relation incidente au citoyen ET (weight >= minWeight OU âge <= recentWindowMs)",
    encodingRule: "une relation sélectionnée produit une ligne canonique et un embedding caché par hash",
    routingRule: "chaque ligne répartit une part égale du budget entre les top-k nœuds L1 au-dessus de minSimilarity",
    attentionRule: "la demande externe (intensité + nouveauté habituable) concourt avec la demande interne et l'orientation de l'entité diffusée dans le Global Workspace ; le résultat borné fixe le budget sensoriel du tick",
    fixedSensoryRatio: false,
    attentionBoundsStatus: "configurable_engineering_guards",
    energyAttribution: "citizen",
    crossGraphEdgesCreated: false
  },
  metacognitiveSystem: {
    scope: metacognitive.scope,
    formulas: metacognitive.formulas,
    modes: metacognitive.modes,
    forbiddenModes: metacognitive.forbiddenModes,
    safetyInvariants: metacognitive.safetyInvariants,
    biologicalParallels: metacognitive.biologicalParallels,
    beliefUtilitySeparation: true,
    stateAwarenessIsEstimate: true,
    autonomousIrreversibleActionAllowed: false
  },
  citizenAIRoleSystem: {
    scope: citizenAIRoles.scope,
    doctrine: citizenAIRoles.doctrine,
    epistemicStatus: citizenAIRoles.epistemicStatus,
    purpose: citizenAIRoles.purpose,
    reflectionContract: citizenAIRoles.reflectionContract,
    actorArchetypeId: citizenAIRoles.actorArchetype.id,
    instanceTemplateId: citizenAIRoles.instanceTemplate.id,
    roleIds: [...roleNodeIds.values()],
    selectionPolicy: citizenAIRoles.selectionPolicy,
    activationRecordContract: citizenAIRoles.activationRecordContract,
    routingContract: citizenAIRoles.routingContract,
    consciousnessClaim: false,
    personalBeliefsPrefilled: false,
    roleActorsCreated: false
  },
  subentityMemoryAttributionSystem: {
    scope: subentityAttribution.scope,
    doctrine: subentityAttribution.doctrine,
    principles: subentityAttribution.principles,
    risks: subentityAttribution.risks,
    scenarios: subentityAttribution.scenarios,
    relationTypes: subentityAttribution.relationDefinitions.map(entry => entry.split("|")[0]),
    modes: subentityAttribution.modes.map(entry => entry.split("|")[0]),
    contractFields: subentityAttribution.contractFields.map(entry => entry.split("|")[0]),
    memoryOwner: "citizen_ai_unique",
    relationDirection: "Moment_to_Subentity",
    unknownIsValid: true,
    selfConfirmationAllowed: false,
    correctionStrategy: "append_only_supersession"
  },
  openQuestionIds: nodes.filter(node => node.semanticType === "OpenQuestion").map(node => node.id),
  clusters,
  nodes,
  relations
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
console.log(`L1 Brain Blueprint écrit: ${actualCounts.nodes} nœuds, ${actualCounts.relations} relations, ${actualCounts.clusters} clusters.`);
