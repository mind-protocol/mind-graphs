// Cité-jardin — vocabulaire d'objets et de raccords.
// Module pur : aucune dépendance au DOM, testable hors navigateur.
//
// Principe unique dont tout le reste découle : **un objet montre sa fonction et
// s'il la remplit**. Un mécanisme est un moyen de transformer quelque chose, donc
// une machine avec une bouche d'entrée et une buse de sortie ; un mécanisme qui
// n'admet rien et ne produit rien se dessine tout seul comme un caisson scellé.
// Le déficit causal devient une propriété visible de chaque objet, sans compteur.

// --- Ports --------------------------------------------------------------------
// Quatre faces utiles, plus un capteur. Un port *déclaré mais non raccordé* se
// dessine bouché : c'est là que la donnée manquante se voit.
export const PORTS = ["intake", "outlet", "footing", "cap", "sensor"];

// Quels prédicats raccordent quel port. Un port sans prédicat entrant est bouché.
export const PORT_PREDICATES = {
  intake: { predicates: ["FEEDS", "CONVERGES_IN"], direction: "in" },
  outlet: { predicates: ["CAUSES", "LEADS_TO"], direction: "out" },
  footing: { predicates: ["GROUNDS", "IMPLEMENTS", "MOTIVATES", "DERIVED_FROM"], direction: "in" },
  cap: { predicates: ["SAFEGUARDS", "TESTS"], direction: "in" },
  sensor: { predicates: ["MEASURED_BY", "MEASURES"], direction: "both" }
};

// --- Un objet par type de nœud ------------------------------------------------
// `shape` est la silhouette dessinée ; `does` est la fonction que l'ontologie lui
// attribue, et qui justifie la forme. Le commentaire n'est pas décoratif : c'est
// le lien de traçabilité entre la nomenclature et le dessin.
export const OBJECTS = {
  // — machines : elles transforment quelque chose —
  mechanism: { shape: "machine", ports: ["intake", "outlet", "footing"], does: "transformer" },
  economic_mechanism: { shape: "meter_machine", ports: ["intake", "outlet", "footing"], does: "régler des quantités" },
  protocol: { shape: "plant", ports: ["intake", "outlet", "footing", "cap"], does: "le système étudié" },
  institution: { shape: "gatehouse", ports: ["intake", "outlet", "footing"], does: "organiser des personnes" },
  method: { shape: "jig", ports: ["cap"], does: "procéder" },
  unlock: { shape: "key", ports: ["footing"], does: "rendre possible" },

  // — socle : ce sur quoi on s'appuie —
  axiom: { shape: "bedrock", ports: [], does: "poser un choix normatif" },
  design_rationale: { shape: "fissure", ports: [], does: "dire la tension qui a fait bâtir" },
  source_document: { shape: "stele", ports: [], does: "attester la provenance" },
  actor: { shape: "marker", ports: [], does: "attribuer" },
  terme: { shape: "plaque", ports: [], does: "fixer un sens" },
  context: { shape: "stakes", ports: [], does: "délimiter la portée" },

  // — cibles : ce qui est observable —
  system_state: { shape: "beacon", ports: ["intake", "sensor"], does: "être observable" },
  metric: { shape: "dial", ports: ["sensor"], does: "mesurer" },
  estimate: { shape: "gauge", ports: ["footing"], does: "chiffrer avec incertitude" },
  // Piège à mensonge : un effet *voulu* ne doit jamais ressembler à un état observable.
  design_effect: { shape: "hologram", ports: [], does: "l'effet voulu, jamais observé" },

  // — affirmations et preuves —
  claim: { shape: "panel", ports: ["cap", "footing"], does: "affirmer" },
  working_hypothesis: { shape: "sprout", ports: ["cap", "footing"], does: "tenir provisoirement" },
  observation: { shape: "pin", ports: [], does: "constater" },
  experiment: { shape: "rig", ports: ["cap"], does: "éprouver" },
  dataset: { shape: "tank", ports: [], does: "contenir" },

  // — verrous et arbitrages —
  open_question: { shape: "chasm_gate", ports: [], does: "bloquer tant que non tranché" },
  decision: { shape: "switch", ports: ["footing"], does: "arbitrer" },
  decision_option: { shape: "siding", ports: [], does: "offrir une branche non choisie" },

  // — cognition (cortex L1) —
  subentity: { shape: "subentity_marker", ports: ["intake", "outlet", "cap"], does: "agir et moduler l'état" },
  subentity_goal: { shape: "subentity_target", ports: ["cap", "footing"], does: "cibler temporairement" },
  subentity_state_machine: { shape: "subentity_automaton", ports: ["intake", "outlet"], does: "spécifier un comportement" },
  subentity_action: { shape: "subentity_claw", ports: ["outlet", "footing"], does: "manipuler le graphe" },

  // — futurs —
  horizon: { shape: "tower", ports: [], does: "destination lointaine" },
  forecast_event: { shape: "storm", ports: [], does: "événement conditionnel" },
  consultation: { shape: "rostrum", ports: [], does: "soumettre au dehors" },

  // — journal du projet —
  idea: { shape: "pennant", ports: [], does: "piste non engagée" },
  task: { shape: "worksign", ports: [], does: "travail borné" },
  change: { shape: "milestone", ports: [], does: "trace immuable" }
};

export const objectOf = (node) => OBJECTS[node.semanticType || node.nodeType] || { shape: "panel", ports: [], does: "affirmer" };

// --- Un raccord par prédicat --------------------------------------------------
// `kind` est la forme du raccord. `port` dit sur quelle face il se branche, ce
// qui suffit souvent à faire comprendre la relation sans lire l'étiquette.
export const CONNECTORS = {
  // ce qui avance
  FEEDS: { kind: "pipe", port: "intake", note: "alimente l'entrée" },
  CONVERGES_IN: { kind: "pipe", port: "intake", note: "converge dans l'entrée" },
  CAUSES: { kind: "crossing", port: "outlet", note: "effet chiffrable produit par la buse" },
  LEADS_TO: { kind: "crossing", port: "outlet", note: "effet possible produit par la buse" },
  UNLOCKS: { kind: "key_link", port: "intake", note: "déverrouille l'accès" },

  // ce qui porte
  GROUNDS: { kind: "column", port: "footing", note: "colonne porteuse sous l'objet" },
  IMPLEMENTS: { kind: "bracket", port: "footing", note: "monté sur le principe qu'il applique" },
  MOTIVATES: { kind: "crack_tie", port: "footing", note: "bâti au-dessus de la tension qui l'a motivé" },
  ASSUMES: { kind: "tie", port: "footing", note: "repose sur une supposition non vérifiée" },

  // ce qui barre ou protège
  BLOCKS: { kind: "barrier", port: "intake", note: "barrière plantée dans l'entrée" },
  CONTRADICTS: { kind: "clash", port: "outlet", note: "deux sorties qui se percutent" },
  SAFEGUARDS: { kind: "shield", port: "cap", note: "bouclier boulonné, il n'interrompt aucun flux" },

  // ce qui éprouve et mesure
  TESTS: { kind: "probe", port: "cap", note: "sonde serrée sur l'objet" },
  MEASURED_BY: { kind: "sensor_wire", port: "sensor", note: "câble de capteur vers le cadran" },
  MEASURES: { kind: "sensor_wire", port: "sensor", note: "câble de capteur vers l'état" },
  USES_METHOD: { kind: "tie", port: "cap", note: "gabarit employé" },
  OBSERVES: { kind: "sight_line", port: null, note: "ligne de visée vers ce qui est constaté" },
  PRODUCES: { kind: "pipe", port: "outlet", note: "résultat sorti de l'appareil" },
  USES_DATASET: { kind: "tie", port: "intake", note: "puise dans le réservoir" },
  SUPPORTS_ESTIMATE: { kind: "anchor", port: "footing", note: "ancrage sous l'estimation" },

  // ce qui répond
  ADDRESSES: { kind: "plank", port: null, note: "planche posée en travers du verrou, non validée" },
  ANSWERS: { kind: "plank", port: null, note: "retour de consultation" },
  CONSULTS: { kind: "sight_line", port: null, note: "voie vers la tribune" },
  RECOMMENDS: { kind: "signpost", port: null, note: "panneau indicateur" },
  COMMUNICATES: { kind: "signpost", port: null, note: "mise en récit" },

  // scénarios : rien n'est posé, tout est conditionnel
  MAKES_PLAUSIBLE: { kind: "haze", port: null, note: "rend plausible, sans rien poser" },
  SCENARIO_LEADS_TO: { kind: "haze", port: null, note: "enchaînement conditionnel" },
  PRESSURES: { kind: "pressure", port: "cap", note: "pousse sur l'objet" },
  MITIGATES: { kind: "shield", port: "cap", note: "atténue la pression" },
  AFFECTS_SCENARIO: { kind: "haze", port: null, note: "influence relative" },

  // arbitrage
  OPTION_FOR: { kind: "siding_link", port: null, note: "voie de garage rattachée à l'aiguillage" },

  // le vocabulaire de l'ontologie : une plaque nomme ce qu'elle définit
  DEFINES: { kind: "nameplate", port: null, note: "fixe le sens de l'élément qu'il nomme" },

  // structure et provenance
  PART_OF: { kind: "nesting", port: null, note: "imbrication dans l'ensemble" },
  SUBCASE_OF: { kind: "nesting", port: null, note: "spécialisation" },
  APPLIES_IN: { kind: "perimeter", port: null, note: "périmètre d'application" },
  DERIVED_FROM: { kind: "root", port: "footing", note: "racine vers la stèle" },
  AUTHORED_BY: { kind: "root", port: "footing", note: "racine vers l'auteur" },

  // journal du projet
  PROMOTES_TO: { kind: "signpost", port: null, note: "promue en tâche" },
  TARGETS: { kind: "sight_line", port: null, note: "vise le travail" },
  DEPENDS_ON: { kind: "chain", port: null, note: "chaîne entre travaux" },
  DOCUMENTS_PROGRESS: { kind: "chain", port: null, note: "journalise l'achèvement" }
};

export const connectorOf = (link) =>
  CONNECTORS[link.type] || { kind: "tie", port: null, note: link.relationLabel || link.type };

/**
 * État des ports d'un nœud : lesquels sont raccordés, lesquels sont bouchés.
 * Un port bouché n'est pas une erreur de saisie — c'est la donnée telle qu'elle
 * est. La vue le montre sans le dramatiser.
 */
export function portStateOf(node, links) {
  const spec = objectOf(node);
  const state = { connected: [], capped: [], declared: spec.ports };
  for (const port of spec.ports) {
    const rule = PORT_PREDICATES[port];
    const wired = links.some((l) => {
      if (!rule.predicates.includes(l.type)) return false;
      if (rule.direction === "in") return l.target === node.id;
      if (rule.direction === "out") return l.source === node.id;
      return l.source === node.id || l.target === node.id;
    });
    (wired ? state.connected : state.capped).push(port);
  }
  return state;
}

/**
 * Régime d'une machine. Quatre états, et non deux : « admet sans rien produire »
 * n'est pas la même chose qu'un caisson scellé, et c'est le cas le plus parlant —
 * une machine qui avale un flux et n'en fait rien de mesurable.
 * Sur le corpus : 74 mécanismes scellés, 15 qui avalent, 2 qui tournent.
 */
export const MACHINE_STATES = ["running", "swallows", "vents", "sealed"];

export function machineStateOf(node, links) {
  const spec = objectOf(node);
  if (!spec.ports.includes("intake") || !spec.ports.includes("outlet")) return null;
  const state = portStateOf(node, links);
  const inWired = state.connected.includes("intake");
  const outWired = state.connected.includes("outlet");
  if (inWired && outWired) return "running";
  if (inWired) return "swallows";   // elle admet et ne produit rien de chiffrable
  if (outWired) return "vents";     // elle produit sans qu'on sache d'où
  return "sealed";                  // caisson : ni entrée, ni sortie
}

/** Caisson scellé : ni entrée ni sortie raccordée. */
export function isSealed(node, links) {
  return machineStateOf(node, links) === "sealed";
}

/** Buse bouchée : la machine n'affirme aucun effet, qu'elle admette ou non. */
export function producesNothing(node, links) {
  const state = machineStateOf(node, links);
  return state === "sealed" || state === "swallows";
}

/**
 * Séquence de blocage : ce qu'il faut dessiner pour que « A bloque B » se voie.
 * La barrière se plante dans l'entrée de B, le flux s'y accumule, et une amorce
 * remonte jusqu'à A pour qu'on sache qui bloque. Un `ADDRESSES` pose une planche
 * en matière d'échafaudage : franchissable provisoirement, jamais prouvé.
 */
export function blockageOf(blocker, blocked, links) {
  const answered = links.some((l) => l.type === "ADDRESSES" && l.target === blocker.id);
  const incomingFlow = links.filter((l) =>
    PORT_PREDICATES.intake.predicates.includes(l.type) && l.target === blocked.id).length;
  return {
    blocker, blocked, answered, incomingFlow,
    // le flux ne s'accumule que s'il existe : sans entrée, la barrière est sèche
    pooling: incomingFlow > 0,
    plank: answered,
    note: answered
      ? "traité par une réponse posée en travers ; la planche n'est pas validée"
      : "verrou ouvert : rien ne passe"
  };
}
