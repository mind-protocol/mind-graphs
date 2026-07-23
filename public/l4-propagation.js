// L4 — la loi de propagation proposée, rendue exécutable.
// Module pur : aucune dépendance au DOM, testable hors navigateur.
//
// Ce fichier n'est pas une vue. C'est l'instrument d'une **expérience** : il
// implémente `l4-physical-propagation-rule` telle qu'elle est écrite dans
// `data/l4-ontology-mapping.json`, la fait tourner sur le corpus réel, et
// enregistre ce qu'elle produit. La loi est un `design_proposal` dont le nœud
// dit lui-même « contrat de design, pas encore une loi calibrée » : la faire
// marcher est le seul moyen de savoir ce qu'elle sait faire.
//
// Discipline centrale : **aucun facteur n'est inventé en silence**. Chaque
// terme de l'équation déclare son origine — `measured` s'il vient d'une donnée,
// `stipulated` si l'expérience a dû choisir faute de donnée, `undefined_by_law`
// si la loi elle-même n'a pas de valeur pour le cas rencontré. Un test
// verrouille l'exhaustivité de cette table : un facteur sans origine déclarée
// fait échouer la suite.

/** L'équation, recopiée telle quelle depuis le nœud de la loi. */
export const L4_EQUATION =
  "I_ab(t)=E(t)*W(t)*P_ab*G(t)*K(t;recency,stability)";

/** Les cinq facteurs, dans l'ordre de l'équation. */
export const L4_FACTORS = ["E", "W", "P", "G", "K"];

export const ORIGINS = ["measured", "stipulated", "undefined_by_law"];

/**
 * Ce que l'expérience a dû stipuler, et pourquoi. Cette table est le prix
 * d'entrée : sans elle, faire tourner la loi reviendrait à fabriquer des
 * chiffres, c'est-à-dire à commettre l'erreur que la nomenclature interdit.
 */
export const STIPULATIONS = {
  E: "La loi dit l'énergie « injectée puis décroissante » sans donner de taux. "
    + "Aucun taux n'est introduit : l'énergie du pas suivant est exactement "
    + "l'influence du pas précédent (E₀ = 1 à l'injection). L'expérience "
    + "n'ajoute donc aucun paramètre libre.",
  W: "La loi veut un poids « acquis à long terme, d'évolution lente ». Le corpus "
    + "n'apprend rien : on substitue `traversalWeight`, la force sémantique "
    + "déclarée par famille dans l'ontologie — dont l'ontologie précise qu'elle "
    + "n'est « ni une probabilité ni une confiance ». Substitution, pas mesure.",
  K: "Depuis 0.4.0 le noyau temporel ne demande plus que recency et stability ; "
    + "delay et duration sont descendus au rang de comportements routés par gate. "
    + "Le corpus ne porte aucune de ces quantités sous forme numérique : K vaut 1, "
    + "noyau neutre. Le cœur temporel de la loi n'est donc pas exercé par ce corpus."
};

/**
 * Les prédicats inhibiteurs ne sont pas une liste tenue à la main : ils se lisent
 * dans le dictionnaire, seule source de vérité du signe. Un prédicat est
 * inhibiteur quand sa polarité avant est négative. Maintenir la liste en dur,
 * c'était une seconde vérité qui divergeait déjà : elle disait {BLOCKS,
 * CONTRADICTS} là où le dictionnaire dit aussi PRESSURES et MITIGATES.
 */
export function negativePredicates(dictionary) {
  const profiles = dictionary?.profiles ?? [];
  return new Set(
    profiles.filter((p) => Array.isArray(p.polarity) && p.polarity[0] < 0).map((p) => p.source)
  );
}

const EMPTY = new Set();

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * L'équation elle-même. Rien d'autre : un produit, exactement comme écrit.
 * Un facteur indéterminé rend l'influence indéterminée — il n'est pas remplacé
 * par une valeur commode.
 */
export function influence({ E, W, P, G, K }) {
  const factors = [E, W, P, G, K];
  if (factors.some((f) => f === null || f === undefined)) return null;
  return factors.reduce((product, f) => product * f, 1);
}

/**
 * Lecture d'une arête du corpus dans le vocabulaire de la loi.
 * `energy` est l'énergie entrante — l'influence du pas précédent.
 */
export function readFactors(link, { energy = 1, gateState = "open", negatives = EMPTY } = {}) {
  const type = link.type || "";

  // W : substitution déclarée (voir STIPULATIONS.W)
  const weight = num(link.traversalWeight);

  // P : le signe vient de la famille du prédicat, pas d'un chiffre inventé.
  // Le corpus porte aussi, sur 30 arêtes de prévision, une polarité en toutes
  // lettres — « mixte » notamment. La loi exige un scalaire dans [-1,1] et n'a
  // aucune valeur pour « mixte » : c'est la loi qui est muette, pas la donnée.
  const written = typeof link.polarity === "string" ? link.polarity.toLowerCase() : null;
  let P, originP;
  if (written && (written.startsWith("mixte") || written.startsWith("mixed"))) {
    P = null; originP = "undefined_by_law";
  } else if (written && written.startsWith("nég")) {
    P = -1; originP = "measured";
  } else if (written && written.startsWith("pos")) {
    P = 1; originP = "measured";
  } else if (negatives.has(type)) {
    P = -1; originP = "measured";
  } else {
    P = 1; originP = "measured";
  }

  // G : « part de l'influence autorisée par un sous-graphe de conditions ».
  // Un verrou ouvert ferme la porte. Un verrou *traité par un ADDRESSES* n'est
  // ni ouvert ni validé — et la loi n'a pas de valeur pour cet état : elle ne
  // connaît que la part autorisée, pas le statut épistémique de l'autorisation.
  let G, originG;
  if (gateState === "blocked") { G = 0; originG = "measured"; }
  else if (gateState === "addressed") { G = null; originG = "undefined_by_law"; }
  else { G = 1; originG = "measured"; }

  return {
    E: { value: num(energy), origin: "stipulated" },
    W: { value: weight, origin: weight === null ? "undefined_by_law" : "stipulated" },
    P: { value: P, origin: originP },
    G: { value: G, origin: originG },
    K: { value: 1, origin: "stipulated" }
  };
}

/**
 * Un pas de la marche : ce que la loi calcule pour une arête, et ce qu'elle a
 * dû supposer pour y arriver.
 */
export function step(link, context = {}) {
  const factors = readFactors(link, context);
  const values = {};
  for (const key of L4_FACTORS) values[key] = factors[key].value;
  const I = influence(values);
  const undefinedBy = L4_FACTORS.filter((k) => factors[k].origin === "undefined_by_law");
  return {
    link, factors, influence: I,
    // ce que la loi ne sait pas trancher, dit à l'endroit exact où ça se produit
    indeterminate: I === null,
    undefinedBy,
    reason: I === null
      ? `la loi n'a pas de valeur pour ${undefinedBy.join(", ")} sur cette arête`
      : `I = ${values.E.toFixed(3)} × ${values.W} × ${values.P} × ${values.G} × ${values.K}`
  };
}

/**
 * La marche complète le long d'un chemin d'arêtes. L'influence d'un pas devient
 * l'énergie du suivant : la loi ne reçoit aucun paramètre libre en cours de route.
 */
export function walk(links, { gateStateOf = () => "open", energy = 1, negatives = EMPTY } = {}) {
  const steps = [];
  let carried = energy;
  for (const link of links) {
    const current = step(link, { energy: carried, gateState: gateStateOf(link), negatives });
    steps.push(current);
    // une influence indéterminée ne se remplace pas par zéro : elle se propage
    carried = current.influence === null ? null : Math.abs(current.influence);
    if (carried === null) {
      // les pas suivants héritent de l'indétermination, sans la maquiller
      for (const rest of links.slice(steps.length)) {
        steps.push({
          link: rest, factors: null, influence: null, indeterminate: true,
          undefinedBy: ["E"],
          reason: "énergie entrante indéterminée : la loi ne peut plus rien calculer en aval"
        });
      }
      break;
    }
  }
  return { steps, arrival: steps.length ? steps[steps.length - 1].influence : null };
}

/**
 * Le résultat que cette expérience cherche : la loi distingue-t-elle une chaîne
 * causale prouvée d'une chaîne simplement affirmée ?
 *
 * `effectSizePct`, `confidenceScore` et `evidenceBasis` ne sont **dimensions
 * d'aucun facteur** de la loi. Deux chaînes de même longueur et de même famille
 * de prédicats produisent donc exactement la même influence, que l'une soit un
 * pont de pierre et l'autre un pont de corde. La ville rend cette différence
 * visible ; la loi ne la voit pas. C'est mesurable, et c'est ce qu'on mesure.
 */
export function evidenceBlindness(links, negatives = EMPTY) {
  const quantified = links.filter((l) => num(l.effectSizePct) !== null);
  const bare = links.filter((l) => num(l.effectSizePct) === null);
  const meanOf = (list) => {
    const values = list.map((l) => influence({ ...factorValues(l, negatives) })).filter((v) => v !== null);
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  };
  return {
    quantifiedCount: quantified.length,
    bareCount: bare.length,
    meanQuantified: meanOf(quantified),
    meanBare: meanOf(bare),
    // la loi ne lit aucun de ces champs : l'écart attendu est exactement nul
    lawReadsEvidence: false
  };
}

function factorValues(link, negatives = EMPTY) {
  const f = readFactors(link, { energy: 1, negatives });
  const values = {};
  for (const key of L4_FACTORS) values[key] = f[key].value;
  return values;
}
