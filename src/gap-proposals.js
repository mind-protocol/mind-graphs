// Transformation déterministe des lacunes détectées en objets de travail du graphe.
//
// Doctrine (analysis.html) : une réparation produit des candidats, jamais une mutation
// implicite. Tout ce qui est généré ici choisit une direction du projet — quel état créer, quelle
// métrique adosser, quelle arête retyper — et reste donc `proposed` + `review_required`.
//
// Le générateur regroupe par nature de lacune et par périmètre : une tâche par chantier réel,
// jamais une tâche par finding, sinon 31 métriques orphelines produiraient 31 tâches illisibles.

const idOf = value => typeof value === "object" ? value.id : value;

const KINDS = {
  create_observable: {
    order: 1,
    ideaId: "idea-observability-floor",
    ideaName: "Idée · Socle observable par périmètre",
    ideaPhrase: "Un périmètre sans état ni métrique ne peut affirmer aucun effet, quel que soit le soin apporté à ses mécanismes.",
    ideaSummary: "Doter chaque périmètre qui décrit des mécanismes d’au moins un état désirable, de son miroir indésirable et d’une métrique, pour rendre le contrat causal satisfiable.",
    family: "Complétude causale · observabilité",
    taskPrefix: "task-observable-floor",
    title: cluster => `Tâche · Créer le socle observable de « ${cluster} »`,
    phrase: cluster => `Le périmètre « ${cluster} » décrit des mécanismes sans aucun état ni métrique à déplacer.`,
    basePriority: 88,
    criteria: () => [
      "Au moins un system_state désirable et un system_state indésirable existent pour le périmètre, chacun avec stateOrientation, stateDimension et stateIndicator.",
      "Chaque état créé est relié à au moins une metric par MEASURED_BY.",
      "Les états créés portent le clusterId du périmètre.",
      "npm run validate et npm test réussissent."
    ]
  },
  link_state_metric: {
    order: 2,
    ideaId: "idea-instrument-states",
    ideaName: "Idée · Instrumenter les états observables",
    ideaPhrase: "Un indicateur en texte libre ne donne aucune unité à la causalité qui vise l’état.",
    ideaSummary: "Convertir les stateIndicator textuels en métriques reliées par MEASURED_BY, pour que tout CAUSES entrant dispose d’une unité dans laquelle écrire son effectSizePct.",
    family: "Complétude causale · instrumentation",
    taskPrefix: "task-instrument-states",
    title: cluster => `Tâche · Instrumenter les états de « ${cluster} »`,
    phrase: cluster => `Les états de « ${cluster} » décrivent leur indicateur en prose sans métrique reliée.`,
    basePriority: 78,
    criteria: () => [
      "Chaque état visé porte au moins une relation MEASURED_BY vers une metric nommant l’unité et la méthode de calcul.",
      "stateIndicator est conservé comme résumé humain et reste cohérent avec les métriques reliées.",
      "Aucune valeur chiffrée n’est inventée : une métrique sans baseline reste une définition.",
      "npm run validate et npm test réussissent."
    ]
  },
  attach_metric: {
    order: 3,
    ideaId: "idea-anchor-metrics",
    ideaName: "Idée · Rattacher les métriques orphelines",
    ideaPhrase: "Une métrique que nul état n’adosse mesure une expérience isolée, pas le modèle.",
    ideaSummary: "Adosser chaque métrique existante à l’état qu’elle objective, ou l’archiver explicitement si elle n’instrumente aucun état du modèle.",
    family: "Complétude causale · instrumentation",
    taskPrefix: "task-anchor-metrics",
    title: cluster => `Tâche · Rattacher les métriques de « ${cluster} »`,
    phrase: cluster => `Les métriques de « ${cluster} » ne sont adossées à aucun état du graphe.`,
    basePriority: 66,
    criteria: () => [
      "Chaque métrique visée est soit reliée à un system_state par MEASURED_BY, soit explicitement écartée avec sa raison.",
      "Aucune métrique n’est supprimée : l’effort de mesure déjà consenti reste traçable.",
      "npm run validate et npm test réussissent."
    ]
  },
  encode_effect: {
    order: 4,
    ideaId: "idea-encode-mechanism-effects",
    ideaName: "Idée · Saisir les effets déjà connus",
    ideaPhrase: "L’effet d’un mécanisme est souvent déjà écrit en prose dans son résumé, mais jamais saisi comme arête.",
    ideaSummary: "Encoder en CAUSES chiffré les effets que les mécanismes affirment déjà dans leur summary, sans attendre de preuve externe : une assertion argumentée à confiance basse vaut mieux qu’un silence.",
    family: "Complétude causale · saisie",
    taskPrefix: "task-encode-effects",
    title: cluster => `Tâche · Saisir les effets des mécanismes de « ${cluster} »`,
    phrase: cluster => `Des mécanismes de « ${cluster} » alimentent le graphe sans jamais affirmer d’effet mesurable.`,
    basePriority: 72,
    criteria: () => [
      "Chaque mécanisme visé porte soit un CAUSES vers un system_state ou une metric, soit une question ouverte reliée qui assume effect_unknown.",
      "Chaque CAUSES ajouté porte effectSizePct, confidenceScore et evidenceBasis.",
      "Une assertion non mesurée porte evidenceBasis=assertion et un confidenceScore explicitement bas ; aucune valeur n’est empruntée à une source qui ne la contient pas.",
      "npm run validate et npm test réussissent."
    ]
  },
  quantify_causal_link: {
    order: 5,
    ideaId: "idea-quantify-causal-links",
    ideaName: "Idée · Chiffrer les arêtes causales existantes",
    ideaPhrase: "Une arête causale sans chiffre est indiscernable d’une simple mention.",
    ideaSummary: "Renseigner effectSizePct, confidenceScore et evidenceBasis sur les arêtes causales déjà présentes, en commençant par celles dont la cible possède une métrique.",
    family: "Complétude causale · quantification",
    taskPrefix: "task-quantify-links",
    title: cluster => `Tâche · Chiffrer les arêtes causales de « ${cluster} »`,
    phrase: cluster => `Des arêtes causales de « ${cluster} » n’expriment pas leur force.`,
    basePriority: 70,
    criteria: () => [
      "Chaque arête visée porte effectSizePct, confidenceScore et evidenceBasis.",
      "Chaque effectSizePct nomme sa métrique, sa baseline et son horizon dans la justification de l’arête.",
      "Les arêtes dont la cible n’a pas encore de métrique sont laissées en attente et listées, plutôt que chiffrées sans unité.",
      "npm run validate et npm test réussissent."
    ]
  },
  retype_link: {
    order: 6,
    ideaId: "idea-retype-causal-predicates",
    ideaName: "Idée · Retyper les prédicats causaux mal employés",
    ideaPhrase: "Viser un effet recherché ou enchaîner des capacités n’est pas affirmer une causalité.",
    ideaSummary: "Ramener vers MOTIVATES et UNLOCKS les arêtes causales qui ne peuvent pas être chiffrées, afin que la famille causale ne contienne que des affirmations testables.",
    family: "Complétude causale · nomenclature",
    taskPrefix: "task-retype-causal",
    title: cluster => `Tâche · Retyper les prédicats causaux de « ${cluster} »`,
    phrase: cluster => `Des arêtes causales de « ${cluster} » décrivent une intention ou une condition de possibilité.`,
    basePriority: 74,
    criteria: () => [
      "Chaque arête visée est retypée selon le prédicat conforme, ou conservée avec une justification écrite qui défend l’emploi causal.",
      "Un design_effect visé par une ancienne arête causale reçoit le MOTIVATES correspondant et, si l’effet est affirmé, un CAUSES vers l’état observable réel.",
      "Aucune nuance n’est perdue : la justification d’origine est reprise ou enrichie.",
      "npm run validate et npm test réussissent."
    ]
  }
};

const slug = value => String(value)
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hors-cluster";

const uniqueIds = (findings, key) => [...new Set(findings.flatMap(item => {
  const value = item.proposal?.[key];
  return value === undefined ? [] : [value];
}))];

/**
 * Regroupe les findings porteurs d'une `proposal` par nature de lacune puis par périmètre.
 * @returns {Array<{kind: string, clusterId: string, findings: Array<object>}>}
 */
export function groupProposals(findings) {
  const groups = new Map();
  for (const item of findings) {
    const kind = item.proposal?.kind;
    if (!kind || !KINDS[kind]) continue;
    const clusterId = item.proposal.clusterId || "(hors cluster)";
    const key = `${kind}::${clusterId}`;
    if (!groups.has(key)) groups.set(key, { kind, clusterId, findings: [] });
    groups.get(key).findings.push(item);
  }
  return [...groups.values()].sort((a, b) =>
    KINDS[a.kind].order - KINDS[b.kind].order || a.clusterId.localeCompare(b.clusterId, "fr"));
}

/**
 * Construit les nœuds idea/task et leurs relations à partir d'un rapport d'analyse.
 * Idempotent : les identifiants sont dérivés de la nature et du périmètre, jamais d'un compteur,
 * et tout objet déjà présent dans le corpus de travail est signalé au lieu d'être dupliqué.
 *
 * @param {object} report rapport de analyzeGraph
 * @param {{nodes: Array<object>, links: Array<object>}} work corpus project-work existant
 * @param {{today: string, maxTargets?: number}} options la date est injectée pour rester déterministe
 */
export function buildGapProposals(report, work, options = {}) {
  const today = options.today;
  if (!today) throw new Error("buildGapProposals requires an explicit today date");
  const maxTargets = options.maxTargets ?? 12;
  const existingNodeIds = new Set((work.nodes || []).map(node => node.id));
  const existingLinks = new Set((work.links || []).map(link => `${idOf(link.source)}|${link.type}|${idOf(link.target)}`));
  const knownNodeIds = new Set(options.knownNodeIds || []);

  const groups = groupProposals(report.findings || []);
  const nodes = [];
  const links = [];
  const skipped = [];
  const seenIdeas = new Set();

  const pushNode = node => {
    if (existingNodeIds.has(node.id) || nodes.some(item => item.id === node.id)) {
      skipped.push({ id: node.id, reason: "déjà présent dans project-work.json" });
      return false;
    }
    nodes.push(node);
    return true;
  };
  const pushLink = link => {
    const key = `${link.source}|${link.type}|${link.target}`;
    if (existingLinks.has(key) || links.some(item => `${item.source}|${item.type}|${item.target}` === key)) return;
    links.push(link);
  };

  for (const group of groups) {
    const spec = KINDS[group.kind];
    const clusterSlug = slug(group.clusterId);
    const taskId = `${spec.taskPrefix}-${clusterSlug}`;
    const maxPriority = Math.max(...group.findings.map(item => item.priority || 0));
    // La priorité reste bornée : elle ordonne un backlog, elle ne mesure rien.
    const priority = Math.min(100, Math.round(spec.basePriority + Math.min(10, group.findings.length)));

    if (!seenIdeas.has(spec.ideaId)) {
      seenIdeas.add(spec.ideaId);
      pushNode({
        id: spec.ideaId,
        name: spec.ideaName,
        nodeType: "idea",
        phrase: spec.ideaPhrase,
        family: spec.family,
        summary: spec.ideaSummary,
        workStatus: "proposed",
        priority: Math.min(100, spec.basePriority),
        autonomyMode: "review_required",
        updatedAt: today,
        clusterId: "project-work",
        generatedBy: `graph-analysis@${report.methodVersion}`
      });
    }

    const targetIds = uniqueIds(group.findings, "targetNodeId")
      .concat(uniqueIds(group.findings, "sourceNodeId"))
      .concat(group.findings.flatMap(item => item.proposal?.mechanismIds || []))
      .filter(id => knownNodeIds.size === 0 || knownNodeIds.has(id));
    const targets = [...new Set(targetIds)].slice(0, maxTargets);

    const created = pushNode({
      id: taskId,
      name: spec.title(group.clusterId),
      nodeType: "task",
      phrase: spec.phrase(group.clusterId),
      family: spec.family,
      summary: `${group.findings.length} lacune(s) de type ${group.kind} détectée(s) par l’audit dans ce périmètre. Priorité d’audit maximale observée : ${Math.round(maxPriority)}.`,
      workStatus: "proposed",
      priority,
      autonomyMode: "review_required",
      acceptanceCriteria: spec.criteria(group),
      verificationCommand: "npm run validate && npm test",
      updatedAt: today,
      clusterId: "project-work",
      generatedBy: `graph-analysis@${report.methodVersion}`,
      generatedFrom: group.findings.map(item => item.id).slice(0, maxTargets)
    });
    if (!created) continue;

    pushLink({
      source: spec.ideaId,
      target: taskId,
      type: "PROMOTES_TO",
      justification: `L’idée ${spec.ideaName.replace(/^Idée · /, "").toLowerCase()} devient une tâche bornée pour le périmètre « ${group.clusterId} ».`
    });
    for (const target of targets) {
      pushLink({
        source: taskId,
        target,
        type: "TARGETS",
        justification: `La tâche instruit la lacune détectée sur ce nœud ; elle ne présume ni de l’effet à saisir ni de la valeur à écrire.`
      });
    }
  }

  return { nodes, links, skipped, groups: groups.map(group => ({ kind: group.kind, clusterId: group.clusterId, findings: group.findings.length })) };
}

/**
 * Ébauches de nœuds de graphe à promouvoir à la main. Elles portent des marqueurs TODO explicites :
 * un état ou une métrique encode un choix de projet et ne peut pas être écrit par un algorithme.
 */
export function buildObservableScaffold(report, options = {}) {
  const today = options.today;
  if (!today) throw new Error("buildObservableScaffold requires an explicit today date");
  const blind = (report.findings || []).filter(item => item.proposal?.kind === "create_observable" && item.category === "observability_gap");
  const unmeasured = (report.findings || []).filter(item => item.proposal?.kind === "link_state_metric");

  const nodes = [];
  const links = [];
  for (const item of blind) {
    const clusterSlug = slug(item.proposal.clusterId);
    for (const [suffix, orientation, label] of [["target", "desirable", "Cible"], ["risk", "undesirable", "Risque"]]) {
      nodes.push({
        id: `state-${clusterSlug}-${suffix}`,
        name: `TODO · ${label} observable de ${item.proposal.clusterId}`,
        nodeType: "system_state",
        phrase: "TODO — formuler l’état en une phrase observable.",
        family: `${item.proposal.clusterId} · état`,
        summary: "TODO — décrire ce qui doit être vrai du système, et non ce que le projet souhaite.",
        stateOrientation: orientation,
        stateDimension: "TODO",
        stateIndicator: "TODO — nommer l’indicateur observable, puis le relier à une metric par MEASURED_BY.",
        clusterId: item.proposal.clusterId
      });
      links.push({
        source: `state-${clusterSlug}-${suffix}`,
        target: `metric-${clusterSlug}-${suffix}`,
        type: "MEASURED_BY",
        justification: "TODO — expliquer en quoi cette métrique objective l’état, avec son unité et sa méthode de calcul."
      });
      nodes.push({
        id: `metric-${clusterSlug}-${suffix}`,
        name: `TODO · Métrique ${label.toLowerCase()} de ${item.proposal.clusterId}`,
        nodeType: "metric",
        phrase: "TODO — définir la grandeur, son unité et sa méthode de calcul.",
        family: `${item.proposal.clusterId} · mesure`,
        summary: "TODO — préciser la population, la période et la source de données envisagée.",
        clusterId: item.proposal.clusterId
      });
    }
  }
  for (const item of unmeasured) {
    links.push({
      source: item.proposal.targetNodeId,
      target: `TODO-metric-for-${item.proposal.targetNodeId}`,
      type: "MEASURED_BY",
      justification: `TODO — instrumenter l’indicateur existant${item.proposal.indicator ? ` (« ${item.proposal.indicator} »)` : ""} : nommer la metric, son unité et sa méthode.`
    });
  }
  return {
    scope: "Ébauches générées par npm run work:propose — à relire, nommer et déplacer dans data/ avant tout seed.",
    generatedAt: today,
    warning: "Aucun de ces objets n’est valide en l’état : les marqueurs TODO doivent être remplacés par des choix humains explicites.",
    nodes,
    links
  };
}
