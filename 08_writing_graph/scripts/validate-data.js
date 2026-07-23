import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  projectDir, loadManifest, activeGraphs, loadOntology, readDatasets, datasetNodes, datasetLinks
} from "../src/graph-manifest.js";
import { listCodeParameters } from "../src/code-parameters.js";
import { checkVerificationCommand } from "../src/verification-command.js";

const packageManifest = JSON.parse(await fs.readFile(path.resolve(projectDir, "package.json"), "utf8"));
const declaredScripts = Object.keys(packageManifest.scripts || {});

const manifest = await loadManifest();
const errors = [];
let totalNodes = 0;
let totalLinks = 0;

for (const graphConfig of activeGraphs(manifest)) {
  const counts = await validateGraph(graphConfig);
  totalNodes += counts.nodes;
  totalLinks += counts.links;
}

const inactive = manifest.graphs.filter(graph => graph.status !== "active");

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Valid Mind corpus: ${totalNodes} nodes, ${totalLinks} relations.`);
  for (const graph of inactive) console.log(`Declared but not active: ${graph.id} (${graph.falkorGraph}) — ${graph.frontier?.note || "no ontology yet"}`);
}

async function validateGraph(graphConfig) {
  const prefix = graphConfig.id === "design" ? "" : `${graphConfig.id}: `;
  const ontology = await loadOntology(graphConfig);
  if (graphConfig.ontologyMirror) {
    const mirror = JSON.parse(await fs.readFile(path.resolve(projectDir, graphConfig.ontologyMirror), "utf8"));
    if (JSON.stringify(mirror) !== JSON.stringify(ontology)) errors.push("public ontology fallback is out of sync with data/graph-ontology.json");
  }
  const datasets = await readDatasets(graphConfig);

  const nodeTypeIds = new Set(ontology.nodeTypes.map(type => type.id));
  const semanticTypeIds = new Set((ontology.semanticTypes || ontology.nodeTypes).map(type => type.id));
  const allTypeIds = new Set([...nodeTypeIds, ...semanticTypeIds]);
  const epistemicStatusIds = new Set(ontology.epistemicStatuses.map(status => status.id));
  const roleIds = new Set((ontology.roleAxis?.roles || ontology.nodeTypes || []).map(role => role.id));
  const familyIds = new Set(ontology.relationFamilies.map(family => family.id));
  const relationTypes = new Map(ontology.relationTypes.map(type => [type.id, type]));
  const activeRelations = new Set(ontology.relationTypes.filter(type => type.status === "active").map(type => type.id));

  if (!/^\d+\.\d+\.\d+$/.test(ontology.schemaVersion || "")) errors.push(`${prefix}ontology schemaVersion is invalid`);
  for (const type of (ontology.semanticTypes || ontology.nodeTypes)) {
    for (const field of ["id", "label", "family", "epistemicStatus", "description"]) if (!type[field]) errors.push(`node type ${type.id || "?"} misses ${field}`);
    if (!epistemicStatusIds.has(type.epistemicStatus)) errors.push(`node type ${type.id} has unknown epistemic status ${type.epistemicStatus}`);
  }
  for (const type of ontology.relationTypes) {
    if (!familyIds.has(type.family)) errors.push(`relation ${type.id} has unknown family ${type.family}`);
    if (!["active", "reserved"].includes(type.status)) errors.push(`relation ${type.id} has invalid status`);
  }
  for (const [family, weight] of Object.entries(ontology.traversal?.familyDefaults || {})) {
    if (!familyIds.has(family)) errors.push(`traversal default has unknown family ${family}`);
    if (typeof weight !== "number" || weight < 0 || weight > 1) errors.push(`traversal weight ${family} is outside [0,1]`);
  }

  for (const [child, parent] of Object.entries(ontology.nodeTypeHierarchy || {})) {
    if (!allTypeIds.has(child) || !allTypeIds.has(parent)) errors.push(`invalid node type hierarchy ${child} -> ${parent}`);
    const visited = new Set([child]);
    let current = parent;
    while (current) {
      if (visited.has(current)) { errors.push(`cyclic node type hierarchy at ${child}`); break; }
      visited.add(current);
      current = ontology.nodeTypeHierarchy[current];
    }
  }

  const typeGroups = new Map(Object.entries(ontology.typeGroups || {}).map(([name, types]) => [name, new Set(types)]));
  for (const [name, types] of typeGroups) for (const type of types) if (!allTypeIds.has(type)) errors.push(`type group ${name} has unknown type ${type}`);
  for (const relation of ontology.relationTypes.filter(type => type.status === "active")) {
    if (!ontology.relationConstraints?.[relation.id]) errors.push(`active relation ${relation.id} has no source/target constraint`);
  }

  function allowedEndpointTypes(constraint, side) {
    const allowed = new Set(constraint?.[`${side}Types`] || []);
    for (const group of constraint?.[`${side}Groups`] || []) {
      if (!typeGroups.has(group)) errors.push(`relation constraint references unknown group ${group}`);
      for (const type of typeGroups.get(group) || []) allowed.add(type);
    }
    return allowed;
  }

  const nodes = [];
  for (const entry of datasets) {
    const { filename, data, spec } = entry;
    if (JSON.stringify(data).includes('"tattoo"')) errors.push(`${filename} still contains tattoo data`);
    if (spec.requires === "github-provenance") {
      for (const field of ["repository", "repositoryUrl", "commit", "commitUrl", "observedAt"]) {
        if (!data.provenance?.[field]) errors.push(`${filename}: provenance misses ${field}`);
      }
      if (!/^[0-9a-f]{40}$/.test(data.provenance?.commit || "")) errors.push(`${filename}: provenance commit must be a full SHA`);
      for (const node of data.nodes || []) {
        if (!node.sourcePath) errors.push(`${filename}: node ${node.id || "?"} misses sourcePath`);
        if (!node.maturity) errors.push(`${filename}: node ${node.id || "?"} misses maturity`);
      }
    }
    for (const node of datasetNodes(entry)) nodes.push(node);
  }
  const ids = new Set();
  for (const node of nodes) {
    for (const field of ["id", "name", "phrase", "family", "summary", "nodeType"]) if (!node[field]) errors.push(`node ${node.id || "?"} misses ${field}`);
    if (ids.has(node.id)) errors.push(`duplicate node id ${node.id}`);
    if (!nodeTypeIds.has(node.nodeType)) errors.push(`node ${node.id} has unknown physical nodeType ${node.nodeType}`);
    if (node.semanticType && !semanticTypeIds.has(node.semanticType)) errors.push(`node ${node.id} has unknown semanticType ${node.semanticType}`);
    if (node.epistemicStatus && !epistemicStatusIds.has(node.epistemicStatus)) errors.push(`node ${node.id} has unknown epistemic status ${node.epistemicStatus}`);
    ids.add(node.id);
  }

  const links = [];
  for (const entry of datasets) {
    for (const link of datasetLinks(entry)) links.push({ ...link, filename: entry.filename });
  }
  for (const link of links) {
    if (!String(link.justification || "").trim()) errors.push(`${link.filename}: relation ${link.source} -[${link.type}]-> ${link.target} misses justification`);
    if (!ids.has(link.source)) errors.push(`${link.filename}: unknown source ${link.source}`);
    if (!ids.has(link.target)) errors.push(`${link.filename}: unknown target ${link.target}`);
    if (!activeRelations.has(link.type)) errors.push(`${link.filename}: inactive or unknown relation ${link.type}`);
    if (link.source === link.target) errors.push(`${link.filename}: self-link ${link.source}`);
    const constraint = ontology.relationConstraints?.[link.type];
    if (constraint && !constraint.allowAny) {
      const sourceNode = nodes.find(node => node.id === link.source);
      const targetNode = nodes.find(node => node.id === link.target);
      const sourceType = sourceNode?.semanticType || sourceNode?.nodeType;
      const targetType = targetNode?.semanticType || targetNode?.nodeType;
      const allowedSources = allowedEndpointTypes(constraint, "source");
      const allowedTargets = allowedEndpointTypes(constraint, "target");
      if (!allowedSources.has(sourceType)) errors.push(`${link.filename}: ${link.type} rejects source type ${sourceType}`);
      if (!allowedTargets.has(targetType)) errors.push(`${link.filename}: ${link.type} rejects target type ${targetType}`);
    }
    for (const field of ["traversalWeight", "hierarchyWeight"]) {
      if (link[field] !== undefined && (typeof link[field] !== "number" || link[field] < 0 || link[field] > 1)) errors.push(`${link.filename}: ${field} outside [0,1]`);
    }
    validateLinkQuantification(link);
  }

  // `linkQuantification` place la force d'une affirmation causale sur l'arête
  // elle-même. Le validateur mesure le format, jamais la présence : un CAUSES nu
  // reste légitime, il est simplement rendu comme un pont de corde et compté par
  // l'indicateur de saturation causale.
  function validateLinkQuantification(link) {
    const family = relationTypes.get(link.type)?.family;
    const scoped = new Set(ontology.linkQuantification?.appliesToFamilies || []);
    const bases = new Set(ontology.linkQuantification?.admittedRungs || []);
    const carried = ["effectSizePct", "confidenceScore", "evidenceBasis"].filter(field => link[field] !== undefined);
    if (!carried.length) return;
    if (!scoped.has(family)) {
      errors.push(`${link.filename}: ${link.type} carries ${carried.join(", ")} but its family ${family} is not quantifiable`);
      return;
    }
    if (link.effectSizePct !== undefined && (typeof link.effectSizePct !== "number" || !Number.isFinite(link.effectSizePct) || link.effectSizePct < -100)) {
      errors.push(`${link.filename}: relation ${link.source} -[${link.type}]-> ${link.target} has invalid effectSizePct`);
    }
    if (link.confidenceScore !== undefined && (typeof link.confidenceScore !== "number" || link.confidenceScore < 0 || link.confidenceScore > 1)) {
      errors.push(`${link.filename}: relation ${link.source} -[${link.type}]-> ${link.target} has confidenceScore outside [0,1]`);
    }
    if (link.evidenceBasis !== undefined && !bases.has(link.evidenceBasis)) {
      errors.push(`${link.filename}: relation ${link.source} -[${link.type}]-> ${link.target} has unknown evidenceBasis ${link.evidenceBasis}`);
    }
    if (link.evidenceBasis !== undefined && link.effectSizePct === undefined) {
      errors.push(`${link.filename}: relation ${link.source} -[${link.type}]-> ${link.target} claims evidenceBasis without effectSizePct`);
    }
  }

  for (const node of nodes) {
    if (node.probabilityPct !== undefined && (typeof node.probabilityPct !== "number" || node.probabilityPct < 0 || node.probabilityPct > 100)) errors.push(`node ${node.id}: probabilityPct outside [0,100]`);
    if (node.confidenceScore !== undefined && (typeof node.confidenceScore !== "number" || node.confidenceScore < 0 || node.confidenceScore > 1)) errors.push(`node ${node.id}: confidenceScore outside [0,1]`);
    if (node.effectSizePct !== undefined && (typeof node.effectSizePct !== "number" || node.effectSizePct < -100)) errors.push(`node ${node.id}: invalid effectSizePct`);
    if (node.valenceScore !== undefined && (typeof node.valenceScore !== "number" || node.valenceScore < -1 || node.valenceScore > 1)) errors.push(`node ${node.id}: valenceScore outside [-1,1]`);
    if (node.humanValenceDelta !== undefined && (typeof node.humanValenceDelta !== "number" || node.humanValenceDelta < -2 || node.humanValenceDelta > 2)) errors.push(`node ${node.id}: humanValenceDelta outside [-2,2]`);
    const st = node.semanticType || node.nodeType;
    if (["observation", "estimate"].includes(st) && !node.contextId && !node.populationOrSystem) errors.push(`node ${node.id}: ${st} requires a contextId or populationOrSystem`);
    if (st === "system_state") {
      const allowed = new Set((ontology.stateOrientation?.values || []).map(value => value.id));
      if (!node.stateOrientation) errors.push(`node ${node.id}: system_state misses stateOrientation`);
      else if (!allowed.has(node.stateOrientation)) errors.push(`node ${node.id}: unknown stateOrientation "${node.stateOrientation}" (expected ${[...allowed].join(" | ")})`);
    }
    if (st === "terme") {
      const pending = node.definitionStatus === "to_define";
      if (!node.context?.trim()) errors.push(`node ${node.id}: terme misses context`);
      if (!pending && !node.definition?.trim()) errors.push(`node ${node.id}: terme misses definition`);
      if (node.definitionStatus && !["defined", "to_define"].includes(node.definitionStatus)) {
        errors.push(`node ${node.id}: invalid definitionStatus ${node.definitionStatus}`);
      }
      if (pending && node.definition?.trim()) errors.push(`node ${node.id}: terme marked to_define but carries a definition`);
    }
    if (st === "estimate") {
      for (const field of ["metricId", "methodId", "supportingNodes", "quantificationStatus"]) if (!node[field]) errors.push(`node ${node.id}: estimate misses ${field}`);
    }
    if (st === "decision") {
      for (const field of ["decisionStatus", "responsibleRole", "decisionDue", "optionCriteria", "closureEvidence", "reviewDate"]) {
        if (node[field] === undefined || node[field] === "" || (Array.isArray(node[field]) && node[field].length === 0)) errors.push(`node ${node.id}: decision misses ${field}`);
      }
      if (!ontology.decisionLifecycle?.statuses?.includes(node.decisionStatus)) errors.push(`node ${node.id}: invalid decisionStatus ${node.decisionStatus}`);
      if (node.decisionStatus === "approved") {
        for (const field of ontology.decisionLifecycle.requiredForApproval || []) if (!node[field]) errors.push(`node ${node.id}: approved decision misses ${field}`);
      }
    }
    if (st === "decision_option") {
      for (const field of ["optionCode", "optionBenefits", "optionRisks", "optionConditions"]) {
        if (node[field] === undefined || node[field] === "" || (Array.isArray(node[field]) && node[field].length === 0)) errors.push(`node ${node.id}: decision option misses ${field}`);
      }
    }
    if (st === "source_document" && node.sourceHash && node.sourcePath) {
      try {
        const content = await fs.readFile(path.resolve(projectDir, node.sourcePath));
        const actualHash = createHash("sha256").update(content).digest("hex").toUpperCase();
        if (actualHash !== node.sourceHash.toUpperCase()) errors.push(`node ${node.id}: sourceHash does not match ${node.sourcePath}`);
      } catch {
        errors.push(`node ${node.id}: durable source is missing at ${node.sourcePath}`);
      }
    }
    if (st === "task") {
      for (const field of ["workStatus", "priority", "autonomyMode", "acceptanceCriteria", "verificationCommand", "updatedAt"]) {
        if (node[field] === undefined || node[field] === "" || (Array.isArray(node[field]) && node[field].length === 0)) errors.push(`node ${node.id}: task misses ${field}`);
      }
      if (!["proposed", "ready", "in_progress", "blocked", "done", "cancelled"].includes(node.workStatus)) errors.push(`node ${node.id}: invalid task workStatus ${node.workStatus}`);
      if (!["autonomous", "review_required"].includes(node.autonomyMode)) errors.push(`node ${node.id}: invalid autonomyMode ${node.autonomyMode}`);
      if (typeof node.priority !== "number" || node.priority < 0 || node.priority > 100) errors.push(`node ${node.id}: priority outside [0,100]`);
    }
    if (st === "change" && (!node.completedAt || !node.changedPaths?.length)) errors.push(`node ${node.id}: change requires completedAt and changedPaths`);
    if (node.verificationCommand !== undefined) {
      for (const reason of checkVerificationCommand(node.verificationCommand, declaredScripts)) {
        errors.push(`node ${node.id}: verificationCommand ${reason}`);
      }
    }
    if (st === "consultation") {
      const contract = ontology.consultationContract || {};
      for (const field of contract.requiredFields || []) {
        if (node[field] === undefined || node[field] === "") errors.push(`node ${node.id}: consultation misses ${field}`);
      }
      if (!contract.statuses?.includes(node.consultationStatus)) errors.push(`node ${node.id}: invalid consultationStatus ${node.consultationStatus}`);
      if (["published", "harvested", "closed"].includes(node.consultationStatus)) {
        for (const field of contract.requiredWhenPublished || []) {
          if (!node[field]) errors.push(`node ${node.id}: consultation ${node.consultationStatus} misses ${field}`);
        }
      }
    }
  }

  // Doctrine de récolte (consultationContract) : une réponse sollicitée documente qu'une personne
  // l'a dit, jamais qu'elle a raison. Le validateur refuse donc qu'un chiffre du modèle descende
  // d'un commentaire — sans quoi la boucle de consultation deviendrait une usine à confiance
  // fabriquée, où l'accord d'une audience se lirait comme une preuve.
  const harvested = new Set(links.filter(link => link.type === "ANSWERS").map(link => link.source));
  for (const node of nodes.filter(node => harvested.has(node.id))) {
    for (const field of ["probabilityPct", "confidenceScore", "effectSizePct"]) {
      if (node[field] !== undefined) errors.push(`node ${node.id}: a consultation reply carries ${field}; a reply produces a task or an experiment, never a number`);
    }
  }
  for (const link of links.filter(link => harvested.has(link.source))) {
    if (link.type === "SUPPORTS_ESTIMATE") errors.push(`${link.filename}: ${link.source} answers a consultation and cannot support an estimate`);
    for (const field of ["effectSizePct", "confidenceScore", "evidenceBasis"]) {
      if (link[field] !== undefined) errors.push(`${link.filename}: relation from consultation reply ${link.source} carries ${field}`);
    }
  }

  for (const metric of ["probabilityPct", "confidenceScore", "effectSizePct"]) {
    const definition = ontology.quantification?.[metric];
    if (!definition?.definition || !definition.requires?.includes("supportingNodes")) errors.push(`quantification ${metric} is incomplete`);
  }
  if (!new Set(ontology.hierarchy?.kinds || []).has("subcase_of")) errors.push("hierarchy kinds are incomplete");
  for (const option of nodes.filter(node => node.nodeType === "decision_option")) {
    const optionLinks = links.filter(link => link.source === option.id && link.type === "OPTION_FOR");
    if (optionLinks.length !== 1) errors.push(`node ${option.id}: decision option must have exactly one OPTION_FOR link`);
  }

  if (graphConfig.id === "design") {
    validateParameterAnchor(ontology, nodes);
    validateBlueprintAnchor(ontology, nodes);
    validateImportAnchor(ontology, nodes);
    validatePredictionAnchor(ontology, nodes);
  }

  return { nodes: nodes.length, links: links.length };
}

// `blueprintContract` : ancrage schéma ↔ graphe pour le contrat de naissance du L1.
// Le validateur ne sait pas si un blueprint est complet, ni ce que contient une
// instance : il vérifie seulement que les deux axiomes constitutionnels existent
// et que chaque catégorie interdite par le schéma est portée par l'axiome de
// prohibition. Sans cette réciprocité, retirer une interdiction du graphe
// laisserait le schéma continuer à l'annoncer, ce qui est la pire des deux
// erreurs possibles : une garantie affichée que plus rien ne soutient.
function validateBlueprintAnchor(ontology, nodes) {
  const contract = ontology.blueprintContract;
  if (!contract) return errors.push("ontology misses blueprintContract");
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const field of ["constitutionalAxiom", "prohibitionAxiom"]) {
    const node = byId.get(contract[field]);
    const st = node?.semanticType || node?.nodeType;
    if (!node) errors.push(`blueprintContract ${field} points to unknown node ${contract[field] || "?"}`);
    else if (st !== "axiom") errors.push(`blueprintContract ${field} points to ${node.id}, which is a ${st} and not an axiom`);
  }
  const layers = (contract.layers || []).map(layer => layer.id);
  if (JSON.stringify(layers) !== JSON.stringify(["constitution", "seed", "citizen_state"])) {
    errors.push("blueprintContract must declare exactly the layers constitution, seed and citizen_state, in that order");
  }
  const prohibition = byId.get(contract.prohibitionAxiom);
  const carried = new Set(prohibition?.[contract.prohibitionField] || []);
  for (const category of contract.prohibitedPrefills || []) {
    if (!carried.has(category)) errors.push(`blueprintContract prohibits ${category}, which ${contract.prohibitionAxiom} does not carry`);
  }
  for (const category of carried) {
    if (!(contract.prohibitedPrefills || []).includes(category)) errors.push(`node ${contract.prohibitionAxiom} prohibits ${category}, which the ontology does not declare`);
  }
  if (!carried.size) errors.push(`node ${contract.prohibitionAxiom}: the prohibition axiom carries no ${contract.prohibitionField}`);
  for (const node of nodes.filter(node => Array.isArray(node[contract.prohibitionField]))) {
    if (node.id !== contract.prohibitionAxiom) errors.push(`node ${node.id}: only ${contract.prohibitionAxiom} may carry ${contract.prohibitionField}`);
  }
}

// `importContract` : ancrage schéma ↔ graphe pour l'échelle des sources du seed.
// Une échelle déclarée dans le schéma mais dépourvue de méthode dans le graphe
// annonce une capacité d'import que rien ne décrit ; une méthode d'import absente
// de l'échelle entre dans le seed sans doctrine. Les deux côtés doivent donc se
// répondre exactement, une catégorie par méthode.
function validateImportAnchor(ontology, nodes) {
  const contract = ontology.importContract;
  if (!contract) return errors.push("ontology misses importContract");
  const byId = new Map(nodes.map(node => [node.id, node]));
  const pipeline = byId.get(contract.pipelineNode);
  const pipelineSt = pipeline?.semanticType || pipeline?.nodeType;
  if (!pipeline) errors.push(`importContract pipelineNode points to unknown node ${contract.pipelineNode || "?"}`);
  else if (pipelineSt !== "mechanism") errors.push(`importContract pipelineNode points to ${pipeline.id}, which is a ${pipelineSt} and not a mechanism`);

  const declared = (contract.sourceLadder || []).map(source => source.id);
  if (!declared.length) errors.push("importContract declares an empty sourceLadder");
  const carried = new Map();
  for (const node of nodes.filter(node => node[contract.sourceKindField])) {
    const kind = node[contract.sourceKindField];
    const st = node.semanticType || node.nodeType;
    if (st !== "method") errors.push(`node ${node.id}: ${contract.sourceKindField} requires nodeType method, not ${st}`);
    if (!declared.includes(kind)) errors.push(`node ${node.id}: import source kind ${kind} is not declared in the ontology ladder`);
    if (carried.has(kind)) errors.push(`import source kind ${kind} is claimed by both ${carried.get(kind)} and ${node.id}`);
    carried.set(kind, node.id);
  }
  for (const kind of declared) {
    if (!carried.has(kind)) errors.push(`importContract declares source kind ${kind}, which no import method carries`);
  }
  for (const nature of contract.claimNatures || []) {
    if (typeof nature !== "string" || !nature) errors.push("importContract declares an invalid claim nature");
  }
  if (!(contract.claimNatures || []).includes("inference")) errors.push("importContract must keep inference as a distinct claim nature");
}

// `predictionContract` : ancrage schéma ↔ graphe pour la retenue du moteur de
// prédiction. Une liste de domaines restreints est une promesse faite à la
// personne modélisée ; comme toute promesse, elle ne vaut que si les deux côtés
// disent la même chose. Le validateur refuse donc qu'un domaine soit annoncé par
// le schéma sans être porté par le nœud de retenue, ou l'inverse.
function validatePredictionAnchor(ontology, nodes) {
  const contract = ontology.predictionContract;
  if (!contract) return errors.push("ontology misses predictionContract");
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const field of ["engineNode", "restrictionNode"]) {
    const node = byId.get(contract[field]);
    const st = node?.semanticType || node?.nodeType;
    if (!node) errors.push(`predictionContract ${field} points to unknown node ${contract[field] || "?"}`);
    else if (st !== "mechanism") errors.push(`predictionContract ${field} points to ${node.id}, which is a ${st} and not a mechanism`);
  }
  const restriction = byId.get(contract.restrictionNode);
  const carried = new Set(restriction?.[contract.restrictionField] || []);
  if (!carried.size) errors.push(`node ${contract.restrictionNode}: the restriction node carries no ${contract.restrictionField}`);
  for (const domain of contract.restrictedDomains || []) {
    if (!carried.has(domain)) errors.push(`predictionContract restricts ${domain}, which ${contract.restrictionNode} does not carry`);
  }
  for (const domain of carried) {
    if (!(contract.restrictedDomains || []).includes(domain)) errors.push(`node ${contract.restrictionNode} restricts ${domain}, which the ontology does not declare`);
  }
  for (const node of nodes.filter(node => Array.isArray(node[contract.restrictionField]))) {
    if (node.id !== contract.restrictionNode) errors.push(`node ${node.id}: only ${contract.restrictionNode} may carry ${contract.restrictionField}`);
  }
}

// `parameterContract` : ancrage code ↔ graphe dans les deux sens. Un paramètre
// décisif peut rester sans décision — la dette est mesurée, jamais interdite.
// Ce qui est refusé, c'est un ancrage qui ment : une décision qui revendique un
// paramètre disparu, ou un paramètre qui pointe vers une décision inexistante.
// Sans cette réciprocité, renommer une constante laisserait sa justification
// pourrir en silence, ce qui est exactement le drift que le contrat ferme.
function validateParameterAnchor(ontology, nodes) {
  const contract = ontology.parameterContract;
  if (!contract) return errors.push("ontology misses parameterContract");
  const rungs = new Set((ontology.evidenceLadder?.rungs || []).map(rung => rung.id));
  const rungById = new Map((ontology.evidenceLadder?.rungs || []).map(rung => [rung.id, rung]));
  const declared = listCodeParameters();
  const declaredRefs = new Set(declared.map(parameter => parameter.ref));

  const claimedBy = new Map();
  for (const node of nodes.filter(node => Array.isArray(node.codeParameters))) {
    const st = node.semanticType || node.nodeType;
    for (const field of contract.requiredOnDecision || []) {
      if (!(field in node)) errors.push(`node ${node.id}: parameter decision misses ${field}`);
    }
    if (st !== "decision") errors.push(`node ${node.id}: codeParameters requires nodeType decision, not ${st}`);
    for (const ref of node.codeParameters) {
      if (!declaredRefs.has(ref)) errors.push(`node ${node.id}: codeParameters references unknown parameter ${ref}`);
      if (claimedBy.has(ref)) errors.push(`parameter ${ref} is claimed by both ${claimedBy.get(ref)} and ${node.id}`);
      claimedBy.set(ref, node.id);
    }
    // Un barreau nul est légal et déclare l'absence de justification ; un barreau
    // revendiqué doit exister, et ceux qui ne s'auto-invalident pas exigent une
    // date de revue, puisque rien ne viendra les contredire tout seuls.
    if (node.evidenceRung !== null && node.evidenceRung !== undefined) {
      if (!rungs.has(node.evidenceRung)) errors.push(`node ${node.id}: unknown evidenceRung ${node.evidenceRung}`);
      const rung = rungById.get(node.evidenceRung);
      if (rung?.requiresReviewDate && !node.reviewDate) errors.push(`node ${node.id}: evidenceRung ${rung.id} requires a reviewDate`);
      if (rung?.requiresField && !node[rung.requiresField]) errors.push(`node ${node.id}: evidenceRung ${rung.id} requires ${rung.requiresField}`);
    }
  }

  const decisionIds = new Set(nodes.filter(node => (node.semanticType || node.nodeType) === "decision").map(node => node.id));
  for (const parameter of declared) {
    if (!parameter.decisionId) continue;
    if (!decisionIds.has(parameter.decisionId)) {
      errors.push(`code parameter ${parameter.ref}: decisionId ${parameter.decisionId} does not resolve to a decision node`);
      continue;
    }
    if (claimedBy.get(parameter.ref) !== parameter.decisionId) {
      errors.push(`code parameter ${parameter.ref}: points to ${parameter.decisionId}, which does not claim it back in codeParameters`);
    }
  }
}
