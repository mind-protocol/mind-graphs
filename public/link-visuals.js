// La couche visuelle peut raffiner une famille d'ontologie quand deux prédicats de la même famille
// doivent se lire différemment sur le canvas : BLOCKS (design_reasoning) est rendu comme un mur et
// CONTRADICTS (evidence) comme un choc. Ces familles visuelles supplémentaires ne changent rien au
// modèle : l'ontologie reste la source de vérité du sens, link-visuals seulement de l'apparence.
export const TYPE_FAMILIES = {
  UNLOCKS: "enablement",
  GROUNDS: "normative",
  SAFEGUARDS: "normative",
  IMPLEMENTS: "normative",
  LEADS_TO: "causal",
  CAUSES: "causal",
  CONVERGES_IN: "flow",
  FEEDS: "flow",
  MAKES_PLAUSIBLE: "scenario",
  SCENARIO_LEADS_TO: "scenario",
  PRESSURES: "scenario",
  MITIGATES: "scenario",
  AFFECTS_SCENARIO: "scenario",
  MOTIVATES: "design_reasoning",
  ASSUMES: "design_reasoning",
  ADDRESSES: "design_reasoning",
  BLOCKS: "obstruction",
  OBSERVES: "evidence",
  PRODUCES: "evidence",
  USES_METHOD: "validation",
  MEASURES: "validation",
  MEASURED_BY: "validation",
  USES_DATASET: "evidence",
  APPLIES_IN: "contextual",
  TESTS: "validation",
  COMMUNICATES: "communication",
  DERIVED_FROM: "evidence",
  AUTHORED_BY: "evidence",
  SUPPORTS_ESTIMATE: "evidence",
  CONTRADICTS: "conflict",
  PART_OF: "hierarchy",
  SUBCASE_OF: "hierarchy",
  PROMOTES_TO: "workflow",
  TARGETS: "workflow",
  DEPENDS_ON: "workflow",
  DOCUMENTS_PROGRESS: "workflow"
};

export const LINK_FAMILY_STYLES = {
  enablement: { dash: [10, 4, 2, 4], width: 1.8, speed: .022, cap: "butt" },
  normative: { dash: [], width: 4.2, speed: 0, cap: "round", rail: true },
  causal: { dash: [], width: 2.8, speed: .00016, cap: "round", pulse: true },
  flow: { dash: [10, 7], width: 2, speed: .045, cap: "butt", pulse: true },
  scenario: { dash: [14, 8], width: 1.9, speed: .018, cap: "round", pulse: true },
  design_reasoning: { dash: [2, 6], width: 2, speed: .026, cap: "round" },
  validation: { dash: [2, 3, 9, 3], width: 2.2, speed: .035, cap: "butt", pulse: true },
  communication: { dash: [1, 7], width: 2.2, speed: .05, cap: "round" },
  evidence: { dash: [5, 3], width: 4, speed: 0, cap: "butt", rail: true },
  hierarchy: { dash: [], width: 4.5, speed: 0, cap: "butt", rail: true },
  contextual: { dash: [7, 3, 1, 3], width: 1.8, speed: .012, cap: "round" },
  workflow: { dash: [8, 4], width: 2.5, speed: .02, cap: "round", pulse: true },
  obstruction: { dash: [], width: 3.6, speed: 0, cap: "butt" },
  conflict: { dash: [5, 5], width: 2.6, speed: .04, cap: "round", pulse: true }
};

// Expressive endpoint markers ("almost a video game"): the arrowhead is
// replaced by a glyph that looks like what the relation does.
const LINK_TERMINATORS = {
  BLOCKS: "wall",
  CONTRADICTS: "clash",
  SAFEGUARDS: "guard",
  MITIGATES: "guard",
  UNLOCKS: "key",
  RECOMMENDS: "star"
};

export function linkTerminator(link) {
  return LINK_TERMINATORS[link.type] || "arrow";
}

export function linkFamily(link) {
  return link.relationFamily || TYPE_FAMILIES[link.type] || "design_reasoning";
}

export function linkVisualStyle(link) {
  return LINK_FAMILY_STYLES[linkFamily(link)] || LINK_FAMILY_STYLES.design_reasoning;
}
