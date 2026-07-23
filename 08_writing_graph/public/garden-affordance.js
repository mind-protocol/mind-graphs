// Cité-jardin — traduction nomenclature → affordance.
// Module pur : aucune dépendance au DOM, testable hors navigateur.
// Le sens d'une relation doit être perçu (un mur, une corde qui pend) plutôt que
// lu sur une étiquette ; ce fichier est la seule table de correspondance.

// --- Vitalité : le statut épistémique gouverne la matière ---------------------
// Garde-fou anti-mensonge : une proposition ne doit jamais être rendue en granit.
// Une entrée par statut de `epistemicStatuses` — ni plus, ni moins. Un statut
// non traduit retomberait en silence sur « chantier », ce qui ferait passer un
// énoncé réfuté pour un ouvrage en construction.
export const VITALITY = {
  documented: { key: "documented", label: "documenté", var: "--vit-documented", plot: "solid", note: "bâti achevé" },
  observed: { key: "documented", label: "observé", var: "--vit-documented", plot: "solid", note: "bâti achevé" },
  working_hypothesis: { key: "hypothesis", label: "hypothèse de travail", var: "--vit-hypothesis", plot: "sprout", note: "pousse en croissance" },
  design_proposal: { key: "proposal", label: "proposition de design", var: "--vit-proposal", plot: "scaffold", note: "chantier · échafaudage" },
  target: { key: "target", label: "cible", var: "--vit-target", plot: "foundation", note: "fondation balisée" },
  test_target: { key: "target", label: "cible de test", var: "--vit-target", plot: "foundation", note: "fondation balisée" },
  scenario: { key: "scenario", label: "scénario", var: "--vit-scenario", plot: "mirage", note: "horizon conditionnel — rien n'est posé" },
  speculative_horizon: { key: "scenario", label: "horizon spéculatif", var: "--vit-scenario", plot: "mirage", note: "horizon lointain — rien n'est posé" },
  unresolved: { key: "unresolved", label: "question ouverte", var: "--vit-unresolved", plot: "chasm", note: "faille · gouffre" },
  refuted: { key: "ruin", label: "réfuté", var: "--vit-ruin", plot: "ruin", note: "ruine — l'ouvrage est tombé" },
  superseded: { key: "ruin", label: "remplacé", var: "--vit-ruin", plot: "ruin", note: "ruine — un autre ouvrage a pris sa place" }
};

export const vitalityOf = (node) => VITALITY[node.epistemicStatus] || VITALITY.design_proposal;

export const GLYPH = {
  mechanism: "⚙", institution: "🏛", axiom: "◆", working_hypothesis: "🌱",
  system_state: "🎯", open_question: "❓", source_document: "📜", claim: "🧩",
  experiment: "🧪", observation: "🔬", decision: "⚖", task: "🔧", change: "✔",
  economic_mechanism: "⚙", design_effect: "✦", design_rationale: "✎", horizon: "🌅"
};

export const glyphOf = (node) => GLYPH[node.nodeType] || "▪";

// --- Prédicat → affordance ----------------------------------------------------
export const AFFORD = {
  BLOCKS: { kind: "wall", verb: "conditionne ou bloque", scaffoldNote: "on ne passe pas" },
  CONTRADICTS: { kind: "wall", verb: "fracture", scaffoldNote: "tension ouverte" },
  SAFEGUARDS: { kind: "rampart", verb: "protège d'un rempart", scaffoldNote: "garde-fou" },
  FEEDS: { kind: "flow", verb: "irrigue", scaffoldNote: "flux d'énergie" },
  GROUNDS: { kind: "grounds", verb: "fonde", scaffoldNote: "fondation porteuse" },
  IMPLEMENTS: { kind: "road", verb: "met en œuvre", scaffoldNote: "route de convergence" },
  CONVERGES_IN: { kind: "road", verb: "converge dans", scaffoldNote: "route de convergence" },
  CAUSES: { kind: "causal", verb: "produit", scaffoldNote: "franchissement causal" },
  LEADS_TO: { kind: "causal", verb: "conduit à", scaffoldNote: "franchissement causal" },
  MOTIVATES: { kind: "road", verb: "motive", scaffoldNote: "raison" },
  TESTS: { kind: "tests", verb: "met à l'épreuve", scaffoldNote: "échafaudage de test" },
  ADDRESSES: { kind: "bridge", verb: "répond à", scaffoldNote: "pont sur la faille" },
  PART_OF: { kind: "subcase", verb: "est une partie de", scaffoldNote: "imbrication" },
  SUBCASE_OF: { kind: "subcase", verb: "spécialise", scaffoldNote: "imbrication" },
  DERIVED_FROM: { kind: "root", verb: "dérive de", scaffoldNote: "racine de provenance" },
  AUTHORED_BY: { kind: "root", verb: "attribué à", scaffoldNote: "racine de provenance" }
};

export const affordOf = (link) =>
  (link.relationScope === "provenance" ? AFFORD.DERIVED_FROM : AFFORD[link.type]) ||
  { kind: "road", verb: link.relationLabel || link.type, scaffoldNote: "lien" };

// --- Matière d'un franchissement causal : corde ↔ pierre ----------------------
// `linkQuantification` de l'ontologie place la force sur l'arête elle-même, pas
// sur le statut épistémique des nœuds. La matière traduit donc exactement ce que
// l'arête ose affirmer : sans taille d'effet il n'y a rien sur quoi marcher.
export const CAUSAL_MATERIALS = {
  rope: { key: "rope", label: "pont de corde", rank: 0, sag: 1, note: "affirmation causale nue — rien à mesurer" },
  taut_rope: { key: "taut_rope", label: "corde tendue", rank: 1, sag: 0.55, note: "assertion argumentée, sans mesure externe" },
  plank: { key: "plank", label: "passerelle de planches", rank: 2, sag: 0.22, note: "chiffré par un run de simulation" },
  stone: { key: "stone", label: "pont de pierre", rank: 3, sag: 0, note: "chiffré et défendu par une preuve du monde réel" }
};

const BASIS_MATERIAL = {
  assertion: CAUSAL_MATERIALS.taut_rope,
  simulation: CAUSAL_MATERIALS.plank,
  real_world: CAUSAL_MATERIALS.stone
};

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * Matière d'une arête causale, du pont de corde au pont de pierre.
 * Aucune promotion gratuite : une arête sans `effectSizePct` reste une corde,
 * quelle que soit la base de preuve revendiquée. La corroboration
 * (SUPPORTS_ESTIMATE / OBSERVES sur une extrémité) est un ancrage visible, pas
 * un changement de matière — sinon la preuve d'un voisin déteindrait sur le lien.
 */
export function causalMateriality(link = {}, { corroborated = false } = {}) {
  const effectSizePct = num(link.effectSizePct);
  const confidenceScore = num(link.confidenceScore);
  const basis = link.evidenceBasis || "";
  const quantified = effectSizePct !== null;
  const claimed = BASIS_MATERIAL[basis] || CAUSAL_MATERIALS.rope;

  let material = quantified ? claimed : CAUSAL_MATERIALS.rope;
  let reason;
  if (!quantified && basis) {
    reason = `base « ${basis} » revendiquée sans effectSizePct : le lien reste une corde`;
  } else if (!quantified) {
    reason = "ni taille d'effet, ni base de preuve sur l'arête";
  } else if (confidenceScore === null) {
    reason = `chiffré (${effectSizePct} %) mais sans confidenceScore explicite`;
  } else {
    reason = `${effectSizePct} % d'effet, confiance ${confidenceScore}`;
  }

  return {
    material,
    quantified,
    corroborated: Boolean(corroborated),
    basis,
    effectSizePct,
    // Une confiance absente n'est pas une confiance nulle, mais elle ne doit rien
    // épaissir : on la traite comme le plancher de l'échelle.
    confidence: confidenceScore ?? 0,
    confidenceKnown: confidenceScore !== null,
    reason
  };
}

/** Prédicats dont la matière est gouvernée par la quantification de l'arête. */
export const isCausalPredicate = (link) => affordOf(link).kind === "causal";

/** Relations qui corroborent une estimation portée par un nœud. */
export const CORROBORATING_PREDICATES = new Set(["SUPPORTS_ESTIMATE", "OBSERVES"]);
