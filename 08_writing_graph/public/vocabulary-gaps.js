// Mesure du flou du graphe : ce que les nœuds emploient sans l'avoir défini,
// et ce qu'ils affirment sans dire où ça s'applique.
//
// Le déficit de contexte est le même type de trou que le déficit causal : le
// type `terme` existe, le prédicat `APPLIES_IN` existe, et la donnée est vide.
// Un lecteur qui tombe sur « La connaissance organise son prochain test » ne
// peut pas savoir de quelle connaissance ni de quel graphe on parle. Ce module
// ne comble pas le trou — définir un mot du projet est un acte doctrinal — il le
// rend mesurable, comme la saturation causale.

export const VOCABULARY_METHOD_VERSION = "1.0.0";

// Mots-outils : leur absence de définition n'apprend rien.
const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "d", "au", "aux", "et", "ou", "où",
  "que", "qui", "quoi", "dont", "ce", "cet", "cette", "ces", "son", "sa", "ses", "leur",
  "leurs", "il", "elle", "ils", "elles", "on", "nous", "vous", "je", "tu", "se", "sur",
  "sous", "dans", "par", "pour", "avec", "sans", "vers", "chez", "entre", "est", "sont",
  "être", "avoir", "fait", "faire", "peut", "doit", "plus", "moins", "très", "tout",
  "tous", "toute", "toutes", "pas", "ne", "ni", "en", "y", "a", "à", "the", "of", "to",
  "and", "in", "for", "from", "with", "into", "a", "an", "is", "are", "be", "it", "its",
  "than", "then", "as", "at", "on", "by", "or", "not", "no", "this", "that",
  // Formes verbales et adverbes qui reviennent partout dans la prose : ils ne se
  // définissent pas. Sans eux, la liste des mots à définir se remplit de bruit —
  // constaté sur le corpus, où « devient » et « restent » arrivaient en tête.
  "devient", "deviennent", "reste", "restent", "rester", "etre", "sont", "etait",
  "comme", "avant", "apres", "chaque", "deux", "trois", "meme", "memes", "encore",
  "aussi", "alors", "donc", "ainsi", "cela", "elles", "leurs", "selon", "lorsque",
  "quand", "toujours", "jamais", "beaucoup", "peu", "bien", "mal", "autre", "autres",
  "propre", "propres", "seul", "seule", "seules", "seuls", "certains", "certaines",
  "notamment", "pourtant", "cependant", "afin", "puis", "ensuite", "enfin", "deja",
  "here", "there", "when", "which", "what", "how", "why", "into", "over", "under"
]);

const words = (text) => String(text || "")
  .toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .split(/[^a-z0-9]+/)
  .filter((w) => w.length > 3 && !STOPWORDS.has(w));

/** Vocabulaire déjà fixé : un `terme` complet vaut définition. */
export function definedVocabulary(nodes) {
  const defined = new Set();
  for (const node of nodes) {
    if (node.nodeType !== "terme" || !node.name || !node.definition) continue;
    for (const w of words(node.name)) defined.add(w);
  }
  return defined;
}

/**
 * Mots que le corpus emploie le plus dans ses `phrase` et ses `name` sans les
 * avoir définis. Trié par portée réelle : un mot qui traverse plusieurs clusters
 * pèse plus qu'un mot répété dans un seul, parce qu'il porte une ambiguïté
 * partagée entre plusieurs parties du projet.
 */
export function undefinedTerms(nodes, { limit = 20, minOccurrences = 4 } = {}) {
  const defined = definedVocabulary(nodes);
  const seen = new Map();
  for (const node of nodes) {
    const cluster = node.clusterId || "";
    for (const w of new Set([...words(node.name), ...words(node.phrase)])) {
      if (defined.has(w)) continue;
      if (!seen.has(w)) seen.set(w, { word: w, occurrences: 0, clusters: new Set(), samples: [] });
      const entry = seen.get(w);
      entry.occurrences += 1;
      entry.clusters.add(cluster);
      if (entry.samples.length < 3) entry.samples.push(node.id);
    }
  }
  return [...seen.values()]
    .filter((e) => e.occurrences >= minOccurrences)
    .map((e) => ({ ...e, clusters: [...e.clusters].sort(), reach: e.clusters.size }))
    .sort((a, b) => (b.reach - a.reach) || (b.occurrences - a.occurrences) || (a.word < b.word ? -1 : 1))
    .slice(0, limit);
}

// Types dont une affirmation vaut dans un périmètre : sans `APPLIES_IN`, on ne
// sait ni sur quelle population, ni sur quel territoire, ni à quelle période
// elle est censée tenir.
export const SCOPED_TYPES = new Set([
  "claim", "working_hypothesis", "estimate", "system_state", "observation", "experiment"
]);

/** Affirmations qui ne disent pas où elles s'appliquent. */
export function unscopedClaims(nodes, links) {
  const scoped = new Set(
    links.filter((l) => l.type === "APPLIES_IN").map((l) => l.source)
  );
  return nodes
    .filter((n) => SCOPED_TYPES.has(n.nodeType))
    .filter((n) => !scoped.has(n.id) && !n.contextId && !n.populationOrSystem)
    .map((n) => ({ id: n.id, name: n.name, nodeType: n.nodeType, clusterId: n.clusterId || "" }));
}

/**
 * Indicateurs de flou, sur le modèle de la saturation causale : des ratios
 * explicables, jamais un refus. L'humain résorbe cas par cas.
 */
export function vocabularyGapReport(nodes, links, options = {}) {
  const terms = nodes.filter((n) => n.nodeType === "terme").length;
  const contexts = nodes.filter((n) => n.nodeType === "context").length;
  const scopedTotal = nodes.filter((n) => SCOPED_TYPES.has(n.nodeType)).length;
  const unscoped = unscopedClaims(nodes, links);
  const appliesIn = links.filter((l) => l.type === "APPLIES_IN").length;
  return {
    methodVersion: VOCABULARY_METHOD_VERSION,
    definedTerms: terms,
    contexts,
    appliesIn,
    scopedTotal,
    unscoped: unscoped.length,
    // part des affirmations qui disent où elles s'appliquent
    scopeSaturation: scopedTotal ? (scopedTotal - unscoped.length) / scopedTotal : 1,
    undefinedTerms: undefinedTerms(nodes, options),
    findings: buildFindings(unscoped, undefinedTerms(nodes, options))
  };
}

function buildFindings(unscoped, undefined_) {
  const findings = [];
  for (const term of undefined_.slice(0, 8)) {
    findings.push({
      category: "undefined_vocabulary",
      id: `undefined-term-${term.word}`,
      title: `« ${term.word} » est employé sans être défini`,
      detail: `Le mot apparaît dans ${term.occurrences} nœuds répartis sur ${term.reach} cluster${term.reach > 1 ? "s" : ""}, `
        + "sans nœud `terme` qui en fixe le sens. Un lecteur ne peut pas savoir de quoi le graphe parle.",
      remedy: "Créer un nœud `terme` avec `definition` et `context`, ou retirer le mot des énoncés s'il n'est pas du vocabulaire du projet.",
      severity: term.reach >= 3 ? "high" : "medium",
      samples: term.samples
    });
  }
  if (unscoped.length) {
    findings.push({
      category: "unscoped_claim",
      id: "unscoped-claims",
      title: `${unscoped.length} affirmations ne disent pas où elles s'appliquent`,
      detail: "Ni `APPLIES_IN`, ni `contextId`, ni `populationOrSystem` : le périmètre de validité n'est pas déclaré.",
      remedy: "Relier l'affirmation à un nœud `context` par `APPLIES_IN`, ou renseigner son périmètre.",
      severity: "medium",
      samples: unscoped.slice(0, 5).map((n) => n.id)
    });
  }
  return findings;
}
