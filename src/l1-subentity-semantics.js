// Lecture humaine de l'état d'une sous-entité : état dérivé, forme, icône,
// smiley affectif et phrases d'explication.
//
// Les huit états proviennent du blueprint `data/l1-design.json`
// (`subentity_state_machine`). Ce blueprint est un `design_proposal` : la
// machine à états n'est pas implémentée dans le runtime. Ce module ne prétend
// donc pas *lire* l'état d'une sous-entité — il le **dérive** de faits
// observables (place au workspace, enchère, pénalité, buts, promotion) selon
// une règle explicite, et transporte cette règle jusqu'à la vue pour qu'un
// lecteur puisse la contester.

import { FRENCH_AFFECT_PHRASES } from "./l1-affective-runtime.js";

// forme : `sides = 0` dessine un cercle, la forme par défaut.
export const SUBENTITY_STATES = Object.freeze({
  "state-monitoring": {
    label: "Veille",
    icon: "👁",
    shape: { sides: 0, rotation: 0 },
    doing: "Elle écoute son voisinage sémantique sans engager d'énergie."
  },
  "state-activation-evaluation": {
    label: "Évaluation",
    icon: "⚖",
    shape: { sides: 6, rotation: 0 },
    doing: "Elle pèse une opportunité : elle a produit une enchère mais n'a pas obtenu de place."
  },
  "state-workspace-bidding": {
    label: "Enchère",
    icon: "🙋",
    shape: { sides: 5, rotation: -18 },
    doing: "Elle est admise au workspace en soutien : elle occupe l'attention sans la conduire."
  },
  "state-targeting-planning": {
    label: "Ciblage",
    icon: "🎯",
    shape: { sides: 3, rotation: 0 },
    doing: "Elle conduit le workspace mais n'a encore verrouillé aucun but."
  },
  "state-execution": {
    label: "Exécution",
    icon: "⚡",
    shape: { sides: 4, rotation: 45 },
    doing: "Elle conduit le workspace et poursuit un but explicite."
  },
  "state-feedback-monitoring": {
    label: "Rétroaction",
    icon: "🔁",
    shape: { sides: 4, rotation: 0 },
    doing: "Elle vérifie le retour de son action avant de s'engager davantage."
  },
  "state-closure-consolidation": {
    label: "Consolidation",
    icon: "✅",
    shape: { sides: 0, rotation: 0, ring: true },
    doing: "Elle vient d'être promue : sa structure se consolide et ses arêtes gagnent du poids."
  },
  "state-frustration-pivot": {
    label: "Frustration",
    icon: "🌀",
    shape: { sides: 3, rotation: 180 },
    doing: "Son enchère est entièrement absorbée par ses pénalités : elle est en train de lâcher."
  }
});

export const AFFECT_SMILEYS = Object.freeze({
  curiosity: "🤔",
  desire: "😃",
  care: "🤗",
  fearOfError: "😟",
  frustration: "😤",
  surprise: "😮",
  anger: "😠"
});

/**
 * Dérive l'état d'une sous-entité de faits observables.
 * Chaque branche renvoie la règle qui l'a déclenchée : la vue affiche le
 * pourquoi à côté du quoi, et la dérivation reste réfutable.
 */
export function deriveSubentityState({ place, goals = [], behaviour = null, promotedThisTick = false }) {
  if (promotedThisTick) {
    return { id: "state-closure-consolidation", rule: "une promotion vient d'être enregistrée pour cette sous-entité" };
  }
  const score = Number(place?.score);
  const penalty = Number(place?.penalty);
  const positive = Number(place?.positiveScore);
  if (Number.isFinite(penalty) && Number.isFinite(positive) && positive > 0 && penalty >= positive) {
    return { id: "state-frustration-pivot", rule: `pénalité ${penalty.toFixed(3)} ≥ score positif ${positive.toFixed(3)}` };
  }
  if (place?.admitted && behaviour?.mode === "VERIFY") {
    return { id: "state-feedback-monitoring", rule: "admise au workspace et placée en mode métacognitif VERIFY" };
  }
  if (place?.role === "lead") {
    return goals.length
      ? { id: "state-execution", rule: `conduit le workspace et porte ${goals.length} but(s)` }
      : { id: "state-targeting-planning", rule: "conduit le workspace sans but enregistré" };
  }
  if (place?.role === "support") {
    return { id: "state-workspace-bidding", rule: `admise en soutien au rang ${place.rank}` };
  }
  if (Number.isFinite(score) && score > 0) {
    return { id: "state-activation-evaluation", rule: `enchère ${score.toFixed(3)} produite mais aucune place obtenue` };
  }
  return { id: "state-monitoring", rule: "aucune enchère retenue pendant ce tick" };
}

const joinFrench = parts => parts.length < 2 ? (parts[0] || "") : `${parts.slice(0, -1).join(", ")} et ${parts.at(-1)}`;

/** Phrase décrivant ce que la sous-entité fait, place au workspace comprise. */
export function describeDoing(stateId, place, budget) {
  const base = SUBENTITY_STATES[stateId]?.doing || "État indéterminé.";
  if (!place?.admitted) return base;
  const share = budget ? Math.round((place.characterAllocation / budget) * 100) : null;
  return `${base} Elle tient ${place.characterAllocation} caractères du workspace${share === null ? "" : ` (${share} %)`}.`;
}

/**
 * Phrase décrivant ce que la sous-entité voit : son champ attentionnel, son
 * centre de gravité, et la part d'attention qu'elle n'a pas su situer.
 */
export function describeSeeing(field) {
  if (!field || field.measurementStatus === "unavailable") {
    return "Aucun nœud activé n'a été enregistré : elle ne regarde rien de mesurable.";
  }
  const admitted = field.admitted.length;
  const named = field.admitted.filter(node => node.name).slice(0, 3).map(node => `« ${node.name} »`);
  const parts = [`Elle tient ${admitted} nœud(s) dans son champ, sur une capacité de ${field.capacity.maximum}`];
  if (named.length) parts.push(`dont ${joinFrench(named)}`);
  if (field.periphery.length) parts.push(`${field.periphery.length} en périphérie`);
  if (field.pruned.length) parts.push(`${field.pruned.length} élagué(s) sous le seuil de rétention`);
  const barycentre = field.barycentre;
  const centre = !barycentre || barycentre.measurementStatus === "unavailable"
    ? " Son centre de gravité n'est pas situable : les nœuds de son champ ne portent pas de cluster."
    : ` Son centre de gravité est dans « ${barycentre.clusterId} », à ${Math.round(barycentre.concentration * 100)} % de concentration.`;
  return `${parts.join(", ")}.${centre}`;
}

/** Smiley affectif. Une absence de mesure ne reçoit jamais de visage neutre : ce serait une affirmation. */
export function describeFeeling(feeling) {
  if (!feeling || feeling.measurementStatus === "unavailable") {
    return { smiley: null, text: "Affect non mesuré.", measurementStatus: "unavailable", reason: feeling?.reason || null };
  }
  return {
    smiley: AFFECT_SMILEYS[feeling.affect] || null,
    text: `Elle est ${FRENCH_AFFECT_PHRASES[feeling.affect] || feeling.affect}.`,
    measurementStatus: feeling.measurementStatus,
    affect: feeling.affect
  };
}

/**
 * Compile le cockpit complet de contrôle manuel d'une sous-entité :
 * identité/prompt, périmètre perceptif, liens visibles, état dérivé,
 * recommandation algorithmique et actions manuelles disponibles.
 */
export function compileSubentityCockpit(state = {}, subentityId) {
  if (!subentityId) throw new Error("compileSubentityCockpit requires a subentityId.");
  const subentities = state.subentities || [];
  const entity = subentities.find(item => item.id === subentityId || item.coalitionKey === subentityId) || {
    id: subentityId,
    name: String(subentityId).replace(/^candidate-coalition-/, "Coalition "),
    level: "candidate",
    status: "candidate",
    weight: 1.0,
    stability: 0.5,
    certainty: 0.5,
    dominantAffect: "curiosity",
    goals: [{ key: "evaluer_coalition", score: 1.0 }],
    signature: {}
  };

  const latestSnapshot = [...(state.workspaceSnapshots || [])]
    .sort((a, b) => String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")))[0] || null;
  const place = (latestSnapshot?.slots || []).find(slot => slot.controllerId === subentityId) || null;
  const derived = deriveSubentityState({ place, goals: entity.goals || [], promotedThisTick: false });

  // Périmètre et liens visibles
  const activeNodeIds = [...new Set([
    ...Object.keys(entity.signature || {}).filter(k => k.startsWith("node:")).map(k => k.replace("node:", "")),
    ...(place?.nodeIds || [])
  ])];

  const visibleRelations = (state.relations || []).filter(edge =>
    edge.source === subentityId || edge.target === subentityId || activeNodeIds.includes(edge.source) || activeNodeIds.includes(edge.target)
  ).slice(0, 15);

  // Recommandation algorithmique
  let recommendation = {
    action: "maintain_automatic_monitoring",
    label: "Maintenir la veille automatique",
    reason: "L'algorithme de récurrence et la coalition perçue sont stables."
  };
  if (entity.level !== "high" && (entity.weight || 0) >= 3.0) {
    recommendation = {
      action: "promote_subentity",
      label: "Promouvoir en niveau haut",
      reason: "Le poids d'évidence accumulé dépasse le seuil pour l'admission au niveau haut."
    };
  } else if (derived.id === "state-frustration-pivot") {
    recommendation = {
      action: "pivot_strategy",
      label: "Pivoter les pénalités et libérer",
      reason: "Pénalités excessives au workspace : il est recommandé d'alléger la pression."
    };
  } else if (place?.role === "lead" && entity.goals?.length) {
    recommendation = {
      action: "execute_primary_goal",
      label: "Poursuivre l'exécution du but",
      reason: `La sous-entité est en tête et porte le but « ${entity.goals[0]?.key || entity.goals[0]} ».`
    };
  }

  // Prompt / Mission opérationnelle
  const goalsSummary = (entity.goals || []).map(g => typeof g === "string" ? g : g.key).join(", ") || "Aucun but attribué";
  const missionPrompt = `Sous-entité « ${entity.name || entity.id} » [Niveau: ${entity.level || "low"}, Statut: ${entity.status || "candidate"}]. Buts actifs: ${goalsSummary}. Affect dominant: ${entity.dominantAffect || "aucun"}. Mission: Évaluer et exécuter les actions relatives à sa coalition sémantique.`;

  // Actions manuelles disponibles
  const isManuallyControlled = Boolean(state.manualControl?.active && state.manualControl?.subentityId === subentityId);
  const availableActions = [
    {
      id: "set_attention_head",
      label: "🎯 Définir la tête d'attention",
      description: "Changer le nœud qui sert de focalisation principale (tête d'attention) pour la sous-entité",
      requiresInput: "nodeId",
      current: Boolean(entity.headNodeId)
    },
    {
      id: "admit_node",
      label: "📥 Faire entrer une node au périmètre",
      description: "Choisir et intégrer le nœud voulu dans la signature d'attention de la sous-entité",
      requiresInput: "nodeId",
      current: false
    },
    {
      id: "remove_node",
      label: "🗑️ Retirer une node du périmètre",
      description: "Retirer un nœud du champ d'attention de la sous-entité",
      requiresInput: "nodeId",
      current: false
    },
    {
      id: "create_node",
      label: "✨ Créer une nouvelle node",
      description: "Instancier un nouveau nœud dans le graphe L1 et l'intégrer au champ de la sous-entité",
      requiresInput: "nodePayload",
      current: false
    },
    {
      id: "inject_node_energy",
      label: "⚡ Diriger de l'énergie dans un nœud",
      description: "Allouer une part d'énergie (10%, 25%, 50%, 100%) vers un nœud spécifique de la sous-entité",
      requiresInput: "energyPayload",
      current: false
    },
    {
      id: "create_relation",
      label: "🔗 Créer un lien sémantique",
      description: "Tisser un lien sémantique entre une node source et une node cible avec le type choisi (ex: ACTIVATES, OCCUPIES, SUPPORTS_EMERGENCE)",
      requiresInput: "relationPayload",
      current: false
    },
    {
      id: "clear",
      label: "🔄 Libérer le contrôle (Mode automatique)",
      description: "Restituer la sous-entité à l'arbitrage automatique par le runtime L1",
      current: !isManuallyControlled
    }
  ];

  return {
    subentity: {
      id: entity.id,
      name: entity.name || entity.id,
      level: entity.level,
      status: entity.status,
      weight: entity.weight || 0,
      stability: entity.stability || 0,
      certainty: entity.certainty || 0,
      goals: entity.goals || [],
      strategies: entity.strategies || [],
      preferences: entity.preferences || [],
      beliefs: entity.beliefs || [],
      dominantAffect: entity.dominantAffect || null,
      missionPrompt
    },
    perception: {
      signature: entity.signature || {},
      activeNodeIds,
      visibleRelations,
      place
    },
    stateMachine: {
      stateId: derived.id,
      label: SUBENTITY_STATES[derived.id]?.label || derived.id,
      icon: SUBENTITY_STATES[derived.id]?.icon || "👁",
      rule: derived.rule,
      doing: describeDoing(derived.id, place, latestSnapshot?.characterBudget)
    },
    recommendation,
    availableActions,
    manualControl: state.manualControl || null
  };
}
