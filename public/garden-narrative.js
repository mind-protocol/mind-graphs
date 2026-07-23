// Cité-jardin — le récit d'un district.
// Module pur : aucune dépendance au DOM, testable hors navigateur.
//
// Une carte sans quête n'est pas lisible. Ce module répond à quatre questions
// dans l'ordre où un lecteur se les pose : où va-t-on, par où passe-t-on,
// qu'est-ce qui barre la route, et par quoi commence-t-on. Quand la donnée ne
// permet pas d'y répondre, il le dit au lieu de le masquer.

// --- Rôle narratif d'un nœud --------------------------------------------------
// La *forme* d'une parcelle dit son rôle dans l'histoire ; sa *matière* dit son
// statut épistémique (voir garden-affordance.js). Deux canaux orthogonaux.
const ROLE_BY_TYPE = {
  // la cible : ce que le district cherche à déplacer, et qui est observable
  system_state: "objective", metric: "objective", horizon: "objective", forecast_event: "objective",
  // le verrou : ce qui barre la route tant que ce n'est pas tranché
  open_question: "gate", decision: "gate", decision_option: "gate",
  // la machinerie : ce qui agit
  mechanism: "machinery", economic_mechanism: "machinery", institution: "machinery",
  protocol: "machinery", unlock: "machinery", method: "machinery",
  // le socle : ce sur quoi on s'appuie
  axiom: "ground", source_document: "ground", design_rationale: "ground",
  actor: "ground", terme: "ground", context: "ground", consultation: "ground",
  // les affirmations et leurs preuves
  claim: "claim", working_hypothesis: "claim", design_effect: "claim", estimate: "claim",
  observation: "claim", experiment: "claim", dataset: "claim",
  // le journal du projet, hors récit causal
  idea: "journal", task: "journal", change: "journal"
};

export const ROLES = ["ground", "machinery", "claim", "gate", "objective", "journal"];
export const roleOf = (node) => ROLE_BY_TYPE[node.nodeType] || "claim";

// Voie par défaut quand aucun chemin ne mène à une cible : on retombe sur le
// rôle, qui reste un ordre de lecture honnête (socle → machinerie → affirmation).
const LANE_BY_ROLE = { ground: 0, machinery: 1, claim: 2, gate: 2, objective: 4, journal: 1 };
export const LANE_COUNT = 5;

// Prédicats qui avancent vers la cible. Un DERIVED_FROM ou un PART_OF ne
// « progresse » pas : ce sont de la provenance et de l'imbrication.
export const FORWARD_PREDICATES = new Set([
  "CAUSES", "LEADS_TO", "FEEDS", "IMPLEMENTS", "CONVERGES_IN",
  "UNLOCKS", "MOTIVATES", "GROUNDS", "PRODUCES", "MEASURED_BY"
]);

// Prédicats qui barrent. Ils ne font pas avancer : ils opposent.
export const BLOCKING_PREDICATES = new Set(["BLOCKS", "CONTRADICTS"]);

// Prédicats de convergence : ceux par lesquels plusieurs ouvrages bâtissent la
// même chose. Ils désignent le point où le district met réellement son poids.
export const CONVERGING_PREDICATES = new Set(["IMPLEMENTS", "CONVERGES_IN", "CAUSES", "LEADS_TO", "FEEDS"]);

const isObjective = (node) => roleOf(node) === "objective";

/**
 * Récit d'un district : cibles, voies, avenue principale, verrous, et le vide
 * nommé quand il n'y a rien à viser.
 */
export function buildNarrative(nodes, links, { mainCluster = "" } = {}) {
  const core = nodes.filter((n) => (n.clusterId || "") === mainCluster);
  const scope = core.length ? core : nodes;
  const inScope = new Set(scope.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const forward = links.filter((l) => FORWARD_PREDICATES.has(l.type) && byId.has(l.source) && byId.has(l.target));
  const inbound = new Map();
  for (const l of forward) inbound.set(l.target, (inbound.get(l.target) || 0) + 1);

  const objectives = scope.filter(isObjective);
  objectives.sort((a, b) => objectiveScore(b, inbound) - objectiveScore(a, inbound)
    || (a.id < b.id ? -1 : 1));
  // La distance se mesure vers ce que la ville désigne réellement comme
  // destination : le jardin d'abord, les états observables ensuite. La calculer
  // sur les seuls observables faisait compter comme « ne mène nulle part » les
  // ouvrages qui bâtissent le jardin.
  const garden = convergenceHub(scope, links, byId);
  const destinations = [];
  if (garden) destinations.push(garden.node);
  for (const o of objectives) if (!destinations.some((d) => d.id === o.id)) destinations.push(o);
  const distance = distanceToObjectives(destinations, forward, byId);

  const lanes = new Map();
  for (const n of nodes) {
    const d = distance.get(n.id);
    let lane;
    if (isObjective(n)) lane = LANE_COUNT - 1;
    else if (d !== undefined) lane = Math.max(1, (LANE_COUNT - 1) - d);
    else lane = LANE_BY_ROLE[roleOf(n)] ?? 2;
    // le socle reste au socle : un axiome ne devient pas machinerie parce qu'il
    // se trouve à deux sauts d'une cible
    if (roleOf(n) === "ground") lane = 0;
    lanes.set(n.id, lane);
  }

  // L'avenue mène au jardin quand il y en a un : c'est lui la destination.
  const path = criticalPath(garden ? garden.node : objectives[0], forward, byId, distance, inScope);
  const pathIds = new Set(path.map((n) => n.id));
  const gates = findGates(scope, links, byId, pathIds, inScope);

  return {
    garden,
    objectives,
    // Le vide est un résultat, pas une absence de résultat : il se dit.
    voidReason: objectives.length ? null : voidReason(scope),
    lanes,
    distance,
    path,
    pathIds,
    gates,
    entry: path[0] || null,
    reach: reachStats(scope, distance)
  };
}

// Un `system_state` porte stateIndicator et stateOrientation : il est falsifiable
// maintenant. Un horizon ou un scénario ne l'est pas ; il ne devient la cible
// qu'à défaut. Deux corrections décisives sur ce classement :
//  - un état *indésirable* est un danger, pas une destination. Le district ne
//    « cherche pas à l'atteindre » : il l'évite. Il ne prend la tête que si le
//    district ne vise rien d'autre.
//  - à type égal, la vraie destination est celle vers laquelle le district
//    argumente réellement, donc celle qui reçoit le plus d'arêtes avancantes.
function objectiveScore(node, inbound) {
  const type = node.nodeType === "system_state" ? 30
    : node.nodeType === "metric" ? 20
      : node.nodeType === "horizon" ? 10 : 0;
  const adverse = orientationOf(node) === "adverse" ? -25 : 0;
  const pull = Math.min(9, inbound.get(node.id) || 0);
  return type + adverse + pull;
}

/**
 * Le jardin-endgame : le point sur lequel le district met réellement son poids,
 * quel que soit son type. Dans le district Science, cinq ouvrages `IMPLEMENTS`
 * la thèse « Connaissance scientifique calculable » alors que le seul état
 * observable n'en reçoit qu'un — désigner l'état comme but afficherait un jardin
 * vide à côté du vrai centre de gravité.
 *
 * Ce que le jardin *contient* n'est pas une étiquette : ce sont les ouvrages qui
 * convergent dessus. Ils le définissent, et ils sont plantés sur son pourtour.
 */
export function convergenceHub(scope, links, byId) {
  const inScope = new Set(scope.map((n) => n.id));
  const arrivals = new Map();
  for (const l of links) {
    if (!CONVERGING_PREDICATES.has(l.type)) continue;
    if (!inScope.has(l.target) || !byId.has(l.source)) continue;
    if (!arrivals.has(l.target)) arrivals.set(l.target, []);
    arrivals.get(l.target).push(l);
  }
  let best = null;
  for (const [id, incoming] of arrivals) {
    // à convergence égale, l'observable l'emporte : c'est lui qui est falsifiable
    const score = incoming.length * 10 + (isObjective(byId.get(id)) ? 1 : 0);
    if (!best || score > best.score) best = { node: byId.get(id), incoming, score };
  }
  if (!best || best.incoming.length < 2) return null; // un seul apport n'est pas une convergence
  return {
    node: best.node,
    // les ouvrages qui définissent le jardin, dans un ordre stable
    defines: best.incoming
      .map((l) => ({ node: byId.get(l.source), link: l }))
      .filter((e) => e.node)
      .sort((a, b) => (a.node.id < b.node.id ? -1 : 1)),
    convergence: best.incoming.length
  };
}

function distanceToObjectives(objectives, forward, byId) {
  const incoming = new Map();
  for (const l of forward) {
    if (!incoming.has(l.target)) incoming.set(l.target, []);
    incoming.get(l.target).push(l.source);
  }
  const distance = new Map();
  let frontier = objectives.map((n) => n.id);
  frontier.forEach((id) => distance.set(id, 0));
  let depth = 0;
  while (frontier.length && depth < 12) {
    depth += 1;
    const next = [];
    for (const id of frontier) {
      for (const source of incoming.get(id) || []) {
        if (distance.has(source) || !byId.has(source)) continue;
        distance.set(source, depth);
        next.push(source);
      }
    }
    frontier = next;
  }
  return distance;
}

// L'avenue principale : la remontée depuis la cible par l'arête la plus
// porteuse, jusqu'à ne plus pouvoir remonter. Déterministe à donnée égale.
function criticalPath(objective, forward, byId, distance, inScope = null) {
  if (!objective) return [];
  const incoming = new Map();
  for (const l of forward) {
    if (!incoming.has(l.target)) incoming.set(l.target, []);
    incoming.get(l.target).push(l);
  }
  const chain = [objective];
  const seen = new Set([objective.id]);
  let current = objective;
  while (chain.length < 12) {
    const candidates = (incoming.get(current.id) || [])
      .filter((l) => byId.has(l.source) && !seen.has(l.source))
      // on ne remonte que vers plus loin de la cible : jamais de retour en arrière
      .filter((l) => (distance.get(l.source) ?? Infinity) > (distance.get(current.id) ?? 0));
    if (!candidates.length) break;
    // Le récit d'un district commence chez lui : à poids égal, un ouvrage du
    // district l'emporte sur un faubourg voisin, sinon le « commencer ici »
    // renvoie vers un autre cluster que celui qu'on regarde.
    const score = (l) => edgeWeight(l) + (inScope && inScope.has(l.source) ? 0.5 : 0);
    candidates.sort((a, b) => score(b) - score(a) || (a.source < b.source ? -1 : 1));
    current = byId.get(candidates[0].source);
    seen.add(current.id);
    chain.push(current);
  }
  return chain.reverse();
}

// Une arête chiffrée porte mieux qu'une arête nue : l'avenue passe de préférence
// par ce qui est défendu, pas par ce qui est seulement affirmé.
function edgeWeight(link) {
  const base = typeof link.traversalWeight === "number" ? link.traversalWeight : 0.5;
  const quantified = typeof link.effectSizePct === "number" ? 0.35 : 0;
  const confidence = typeof link.confidenceScore === "number" ? link.confidenceScore * 0.25 : 0;
  const canonical = link.type === "CAUSES" ? 0.2 : 0;
  return base + quantified + confidence + canonical;
}

// Un verrou n'est un verrou que s'il barre quelque chose. Un `open_question`
// isolé est une note, pas une grille en travers de la route.
function findGates(scope, links, byId, pathIds, inScope) {
  const gates = [];
  for (const node of scope) {
    if (roleOf(node) !== "gate") continue;
    const blocks = links.filter((l) =>
      BLOCKING_PREDICATES.has(l.type) && l.source === node.id && inScope.has(l.target));
    const answered = links.filter((l) => l.type === "ADDRESSES" && l.target === node.id);
    const onPath = blocks.some((l) => pathIds.has(l.target)) || pathIds.has(node.id);
    gates.push({
      node,
      blocks: blocks.map((l) => byId.get(l.target)).filter(Boolean),
      answered: answered.length > 0,
      onCriticalPath: onPath,
      severity: (onPath ? 2 : 0) + Math.min(2, blocks.length) + (answered.length ? 0 : 1)
    });
  }
  return gates.sort((a, b) => b.severity - a.severity);
}

function voidReason(scope) {
  const machinery = scope.filter((n) => roleOf(n) === "machinery").length;
  if (!scope.length) return "Ce district est vide.";
  if (machinery) {
    return `Ce district décrit ${machinery} mécanisme${machinery > 1 ? "s" : ""} mais aucun état observable : `
      + "le chemin ne mène à rien de mesurable, et aucun CAUSES ne peut y aboutir.";
  }
  return "Ce district ne contient aucun état observable : il ne vise rien de mesurable.";
}

function reachStats(scope, distance) {
  const connected = scope.filter((n) => distance.has(n.id)).length;
  return { total: scope.length, connected, stranded: scope.length - connected };
}

/**
 * Part de l'éclairage d'une cible : combien des affirmations causales qui la
 * visent sont réellement chiffrées. Un phare éteint est une cible que personne
 * n'a encore défendue par un nombre.
 */
export function objectiveCharge(objective, links) {
  const incoming = links.filter((l) =>
    (l.type === "CAUSES" || l.type === "LEADS_TO") && l.target === objective.id);
  if (!incoming.length) return { claimed: 0, quantified: 0, charge: 0 };
  const quantified = incoming.filter((l) => typeof l.effectSizePct === "number").length;
  return { claimed: incoming.length, quantified, charge: quantified / incoming.length };
}

/**
 * Orientation d'un état : ce qu'on vise, ou ce qu'on veut éviter.
 * Le corpus porte les identifiants `desirable`, `undesirable` et `mixed`. La
 * normalisation reste tolérante aux anciennes graphies françaises, pour qu'un
 * fichier non migré s'affiche encore correctement au lieu de devenir neutre.
 */
export function orientationOf(node) {
  const raw = String(node.stateOrientation || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!raw) return "neutral";
  if (raw.startsWith("in") || raw.startsWith("un") || raw.startsWith("non")) return "adverse";
  if (raw.startsWith("desirable")) return "desirable";
  return "neutral";
}
