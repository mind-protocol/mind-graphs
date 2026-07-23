import { semanticLabelOf, semanticTypeOf } from "./node-semantics.js";

const CAUSAL_TYPES = new Set(["CAUSES", "LEADS_TO", "SCENARIO_LEADS_TO", "PRESSURES", "MITIGATES", "AFFECTS_SCENARIO"]);
const SOLUTION_TYPES = new Set(["unlock", "mechanism", "institution", "economic_mechanism", "design_effect"]);
const SPECIFICATION_TYPES = new Set(["IMPLEMENTS", "TESTS", "ADDRESSES"]);

const idOf = value => typeof value === "object" ? value.id : value;
const ratio = (numerator, denominator) => denominator ? numerator / denominator : 0;
const percent = value => Math.round(value * 100);

function indicator(id, label, numerator, denominator, explanation, whyItMatters, limitation, action, weight) {
  const value = ratio(numerator, denominator);
  return { id, label, numerator, denominator, value, score: percent(value), explanation, whyItMatters, limitation, action, weight };
}

export function calculateGraphHealth(nodes, links) {
  const degrees = new Map(nodes.map(node => [node.id, 0]));
  links.forEach(link => {
    degrees.set(idOf(link.source), (degrees.get(idOf(link.source)) || 0) + 1);
    degrees.set(idOf(link.target), (degrees.get(idOf(link.target)) || 0) + 1);
  });
  const schemaEntities = [
    ...nodes.map(node => Boolean(node.id && node.name && node.nodeType && node.epistemicStatus && node.schemaVersion)),
    ...links.map(link => Boolean(link.type && link.relationFamily && link.relationScope && link.canonicalPredicate && link.schemaVersion))
  ];
  const provenanceEligible = nodes.filter(node => !["source_document", "dataset", "method", "metric", "context"].includes(semanticTypeOf(node)));
  const provenanceIds = new Set(links.filter(link => link.type === "DERIVED_FROM").map(link => idOf(link.source)));
  const questions = nodes.filter(node => semanticTypeOf(node) === "open_question");
  const addressedIds = new Set(links.filter(link => link.type === "ADDRESSES").map(link => idOf(link.target)));
  const solutions = nodes.filter(node => SOLUTION_TYPES.has(semanticTypeOf(node)));
  const specifiedIds = new Set(links.filter(link => SPECIFICATION_TYPES.has(link.type)).flatMap(link => [idOf(link.source), idOf(link.target)]));
  const causalLinks = links.filter(link => CAUSAL_TYPES.has(link.type));
  const contextualizedCausal = causalLinks.filter(link => link.contextId || link.populationOrSystem || link.causalCondition || link.validFrom || link.validTo);
  const quantifiedCausal = causalLinks.filter(link => link.quantificationStatus && link.quantificationStatus !== "unquantified");

  const indicators = [
    indicator("schema", "Conformité sémantique", schemaEntities.filter(Boolean).length, schemaEntities.length,
      "Part des nœuds et relations possédant leurs champs ontologiques essentiels.",
      "Sans type, statut ou prédicat canonique, les algorithmes comparent des objets qui ne sont pas sémantiquement équivalents.",
      "Cet indicateur vérifie la présence des champs, pas la justesse intellectuelle de leur qualification.",
      "Corriger les éléments incomplets avant toute nouvelle analyse.", .12),
    indicator("connectivity", "Connectivité", [...degrees.values()].filter(value => value > 0).length, nodes.length,
      "Part des nœuds reliés au moins une fois au reste du graphe.",
      "Un nœud isolé est introuvable par propagation et n’influence aucun diagnostic structurel.",
      "Une forte connectivité ne garantit ni la pertinence ni la causalité des liens.",
      "Relier ou archiver les nœuds isolés après revue éditoriale.", .08),
    indicator("provenance", "Couverture de provenance", provenanceEligible.filter(node => provenanceIds.has(node.id)).length, provenanceEligible.length,
      "Part des propositions reliées explicitement à un document ou jeu de données source.",
      "La provenance permet de revenir au texte d’origine, de distinguer extraction et interprétation et d’auditer les changements.",
      "Une source documentaire prouve l’origine d’une proposition, pas sa vérité empirique.",
      "Ajouter DERIVED_FROM aux propositions encore orphelines, avec page et section lorsque disponibles.", .20),
    indicator("questions", "Questions traitées", questions.filter(node => addressedIds.has(node.id)).length, questions.length,
      "Part des questions ouvertes ciblées par au moins une relation ADDRESSES.",
      "Une question non traitée peut bloquer plusieurs mécanismes ou décisions en aval.",
      "ADDRESSES signifie qu’une réponse est proposée ; cela ne signifie pas qu’elle est validée.",
      "Associer chaque question prioritaire à une réponse, un responsable et un critère de clôture.", .15),
    indicator("specification", "Solutions avec début de spécification", solutions.filter(node => specifiedIds.has(node.id)).length, solutions.length,
      "Part des mécanismes, institutions et capacités reliés à une implémentation, un test ou une question traitée.",
      "Une solution seulement nommée ne permet ni exécution, ni falsification, ni comparaison avec une alternative.",
      "Le calcul mesure la présence d’un lien de spécification, pas la qualité du protocole associé.",
      "Décrire entrées, sorties, responsables, échec possible et test pour chaque solution centrale.", .15),
    indicator("quantification", "Causalités quantifiées", quantifiedCausal.length, causalLinks.length,
      "Part des relations causales portant une quantification autre que « unquantified ».",
      "Sans ordre de grandeur, deux causalités qualitatives ne peuvent pas être comparées ou arbitrées.",
      "Une valeur quantitative reste fragile sans méthode, incertitude, baseline et preuves liées.",
      "Commencer par les causalités à fort impact aval et créer des nœuds estimate soutenus par des preuves.", .18),
    indicator("causal_context", "Causalités contextualisées", contextualizedCausal.length, causalLinks.length,
      "Part des causalités indiquant au moins une condition, population, période ou contexte d’application.",
      "Une causalité peut changer de signe ou disparaître selon le territoire, l’horizon et la population concernés.",
      "La présence d’un contexte ne garantit pas qu’il soit assez précis ou correctement choisi.",
      "Ajouter APPLIES_IN ou renseigner conditions, population et période sur les liens prioritaires.", .12)
  ];
  const countLabels = {
    schema: ["éléments complets", "éléments inspectés"],
    connectivity: ["nœuds reliés", "nœuds"],
    provenance: ["propositions sourcées", "propositions éligibles"],
    questions: ["questions avec réponse candidate", "questions ouvertes"],
    specification: ["solutions avec au moins un lien de spécification", "solutions"],
    quantification: ["liens causaux quantifiés", "liens causaux"],
    causal_context: ["liens causaux contextualisés", "liens causaux"]
  };
  indicators.forEach(item => {
    [item.numeratorLabel, item.denominatorLabel] = countLabels[item.id];
    item.lostPoints = Math.round((1 - item.value) * item.weight * 1000) / 10;
  });
  const weighted = indicators.reduce((sum, item) => sum + item.value * item.weight, 0);
  const totalWeight = indicators.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(weighted / totalWeight * 100);
  const level = score >= 80 ? "solide" : score >= 60 ? "à surveiller" : score >= 40 ? "fragile" : "critique";
  const drivers = indicators.filter(item => item.lostPoints > 0).sort((a, b) => b.lostPoints - a.lostPoints);
  return { score, level, indicators, drivers, totals: { nodes: nodes.length, links: links.length, causalLinks: causalLinks.length, questions: questions.length, solutions: solutions.length } };
}

const GUIDES = {
  fragile_claim: { why: "Cette flèche affirme qu’un changement contribue à en produire un autre. Elle peut donc influencer une décision de design, une priorité de recherche ou une anticipation de risque.", risk: "Si elle est fausse, trop générale ou dépendante d’un contexte non déclaré, le graphe propage une conclusion trompeuse vers tous ses descendants.", causes: ["Relation issue d’un document doctrinal plutôt que d’une observation.", "Population, horizon ou mécanisme intermédiaire non explicités.", "Absence d’estimation et de preuve reliée à l’affirmation."], steps: ["Formuler la causalité comme une hypothèse falsifiable.", "Déclarer population, horizon, conditions et métrique de résultat.", "Créer une estimation et la relier à une observation, un dataset ou une expérience."] },
  unanswered_question: { why: "La question est reliée à des éléments qui en dépendent, mais aucune réponse explicite ne clôt actuellement la dépendance.", risk: "Des choix en aval peuvent être présentés comme cohérents alors qu’ils reposent encore sur une décision ou une inconnue non résolue.", causes: ["Responsable ou échéance non désigné.", "Critère de réponse acceptable absent.", "Réponse présente dans un document mais non encodée avec ADDRESSES."], steps: ["Nommer la décision exacte à prendre.", "Identifier les nœuds bloqués et le coût du maintien de l’incertitude.", "Relier une réponse candidate avec ADDRESSES et définir son test de clôture."] },
  underspecified_solution: { why: "Le nœud est présenté comme une solution ou un mécanisme, mais ses conditions d’exécution et de validation sont insuffisamment reliées.", risk: "Le graphe peut surestimer la maturité du projet et masquer les dépendances techniques, institutionnelles ou humaines nécessaires.", causes: ["Solution décrite au niveau narratif seulement.", "Absence de protocole de test ou de métrique de succès.", "Questions bloquantes non reliées à la solution."], steps: ["Décrire les entrées, sorties et acteurs responsables.", "Ajouter au moins un test avec seuil de réussite et échec possible.", "Relier les questions, méthodes, datasets et contextes requis."] },
  contradiction: { why: "Deux propositions ou états semblent incompatibles, explicitement ou parce qu’ils décrivent des résultats opposés dans un contexte proche.", risk: "Sans arbitrage, différents parcours du graphe peuvent produire des recommandations mutuellement incompatibles.", causes: ["Contextes d’application différents mais non déclarés.", "Versions historiques mélangées.", "Désaccord réel entre sources ou hypothèses."], steps: ["Comparer précisément contexte, période et définition des termes.", "Encoder CONTRADICTS seulement si l’incompatibilité demeure.", "Conserver les deux propositions avec leurs preuves et statut épistémique."] },
  consolidation: { why: "Des prédicats ou nœuds proches fragmentent peut-être une même idée, ce qui disperse les liens et les scores.", risk: "La centralité et la recherche deviennent sensibles aux différences de formulation plutôt qu’à la structure réelle.", causes: ["Import de plusieurs documents utilisant des vocabulaires différents.", "Migration incomplète vers les prédicats canoniques.", "Doublons légitimes mais contexte insuffisamment explicité."], steps: ["Comparer définition, contexte et voisinage avant toute fusion.", "Choisir un identifiant canonique et conserver les alias.", "Ne fusionner automatiquement aucun contenu doctrinal."] },
  structural_bottleneck: { why: "Ce nœud se situe sur de nombreux chemins et concentre plusieurs dépendances amont et conséquences aval.", risk: "Une erreur, un retard ou une ambiguïté locale peut contaminer une part disproportionnée du modèle.", causes: ["Architecture réellement centralisée.", "Concept trop large regroupant plusieurs mécanismes.", "Relations alternatives ou redondances non modélisées."], steps: ["Vérifier la définition et les preuves du nœud en priorité.", "Chercher des chemins alternatifs et mécanismes de secours.", "Décomposer le nœud s’il combine plusieurs responsabilités."] },
  feedback_loop: { why: "Le cycle peut amplifier, stabiliser ou inverser un effet au fil du temps.", risk: "Une lecture linéaire des flèches ignore les délais, saturations et changements de signe propres aux boucles.", causes: ["Relations réciproques réellement dynamiques.", "Agrégation de phénomènes à des horizons différents.", "Sens, gain ou délai des relations non renseignés."], steps: ["Qualifier le signe de chaque relation du cycle.", "Ajouter délais, gain, seuils et mécanismes d’amortissement.", "Simuler la boucle dans plusieurs contextes plutôt que conclure depuis sa seule présence."] },
  evidence_leverage: { why: "Une même preuve pourrait réduire l’incertitude de plusieurs affirmations ou états situés en aval.", risk: "Investir dans des preuves locales à faible portée peut retarder la résolution des hypothèses réellement structurantes.", causes: ["Source centrale encore non testée.", "Plusieurs causalités dépendent du même mécanisme.", "Plan de validation organisé par document plutôt que par impact structurel."], steps: ["Définir la preuve minimale capable de discriminer les hypothèses.", "Mesurer combien de décisions seraient modifiées par chaque résultat possible.", "Prioriser une expérience réutilisable et relier explicitement ses résultats."] },
  causal_gap: { why: "Le mécanisme est décrit et relié, mais il n’affirme jamais ce qu’il déplace : le graphe le documente sans pouvoir raisonner avec lui.", risk: "Le modèle paraît riche alors qu’il ne permet aucune inférence : un mécanisme sans effet ne peut être ni priorisé, ni réfuté, ni simulé.", causes: ["L’effet est écrit en prose dans le résumé mais jamais saisi comme arête.", "Le périmètre ne contient aucun état ni métrique à viser.", "L’effet n’est pas connu et personne n’a encore assumé de le dire."], steps: ["Vérifier d’abord qu’un observable existe dans le périmètre ; le créer sinon.", "Ajouter un CAUSES vers l’état ou la métrique, avec effectSizePct, confidenceScore et evidenceBasis.", "Si l’effet est inconnu, ouvrir une question plutôt que laisser le silence."] },
  observability_gap: { why: "Le périmètre décrit des mécanismes sans exposer un seul état ou une seule métrique : il n’offre aucune cible falsifiable.", risk: "La saturation causale y restera nulle par construction, et l’effort de rédaction produira des mécanismes que rien ne pourra jamais tester.", causes: ["Le périmètre a été extrait d’un document qui décrit des moyens sans nommer de résultats observables.", "Les états ont été formulés comme des effets recherchés plutôt que comme des situations mesurables.", "L’instrumentation a été repoussée au moment de l’expérimentation."], steps: ["Formuler au moins un état désirable en termes observables, sans le confondre avec le souhait du projet.", "Ajouter son miroir indésirable : c’est lui qui rend le périmètre réfutable.", "Relier chaque état à une métrique par MEASURED_BY avant toute campagne de chiffrage."] },
  unmeasured_state: { why: "L’état décrit son indicateur en prose, ce qui suffit à un lecteur humain mais ne donne aucune unité à la causalité qui le vise.", risk: "Un effectSizePct écrit sur une arête entrante serait ininterprétable : on ne saurait pas de quelle grandeur il exprime la variation.", causes: ["stateIndicator a été rédigé avant l’introduction du prédicat MEASURED_BY.", "La métrique correspondante existe ailleurs dans le graphe sans être reliée.", "L’unité et la méthode de calcul n’ont pas encore été tranchées."], steps: ["Chercher d’abord une métrique existante qui objective l’indicateur décrit.", "Créer la métrique manquante avec son unité et sa méthode, sans inventer de valeur.", "Relier l’état à la métrique par MEASURED_BY et garder stateIndicator comme résumé humain."] },
  orphan_metric: { why: "La métrique est définie, parfois même produite par un protocole, mais aucun état du modèle ne s’y adosse.", risk: "L’effort de mesure reste invisible au raisonnement : quand la métrique bouge, rien dans le graphe ne s’améliore ni ne se dégrade.", causes: ["La métrique a été extraite d’un contrat de validation sans être rattachée au modèle causal.", "L’état qu’elle objective n’existe pas encore.", "La métrique instrumente une expérience isolée sans portée sur le modèle."], steps: ["Identifier l’état que la métrique objective réellement, et le créer s’il manque.", "Relier l’état à la métrique par MEASURED_BY.", "Si aucun état ne correspond, écarter la métrique explicitement avec sa raison plutôt que la supprimer."] },
  unquantified_causal: { why: "L’arête affirme une causalité sans exprimer sa force : elle est indiscernable d’une simple mention de voisinage.", risk: "Toutes les causalités pèsent alors le même poids dans une traversée, et une intuition non défendue circule avec la même autorité qu’un résultat mesuré.", causes: ["Les sept prérequis de quantification des nœuds ont été appliqués par erreur aux arêtes, qui n’en demandent que trois.", "La cible ne possède pas encore de métrique fournissant une unité.", "L’auteur a préféré le silence à une valeur qu’il jugeait trop grossière."], steps: ["Vérifier que la cible possède une métrique ; l’instrumenter d’abord sinon.", "Écrire effectSizePct même approximatif, avec un confidenceScore explicitement bas.", "Déclarer evidenceBasis : une assertion argumentée est un statut légitime, pas un aveu de faiblesse."] },
  mistyped_causal: { why: "Le prédicat causal est employé là où le contrat prévoit une intention (MOTIVATES) ou une condition de possibilité (UNLOCKS).", risk: "La famille causale se remplit d’arêtes qui ne pourront jamais être chiffrées, ce qui dilue la mesure de maturité causale et brouille la distinction entre effet visé et effet affirmé.", causes: ["Un design_effect a été traité comme un état observable.", "Une chaîne de capacités ou d’horizons a été typée causale par facilité.", "La migration des prédicats hérités n’a pas encore été arbitrée."], steps: ["Retyper l’arête selon le prédicat conforme, en reprenant sa justification d’origine.", "Pour un effet recherché, ajouter en parallèle le CAUSES vers l’état observable réellement visé.", "Conserver l’arête causale seulement si sa justification défend explicitement un effet mesurable."] }
};

export function enrichRecommendation(item, nodes, links = []) {
  const guide = GUIDES[item.category] || GUIDES.fragile_claim;
  const relatedIds = new Set([item.nodeId, ...(item.relatedNodeIds || [])].filter(Boolean));
  const related = nodes.filter(node => relatedIds.has(node.id));
  const types = [...new Set(related.map(semanticLabelOf))];
  const clusters = [...new Set(related.map(node => node.clusterId).filter(Boolean))];
  const relatedEdges = links.filter(link => relatedIds.has(idOf(link.source)) || relatedIds.has(idOf(link.target)));
  const documentIds = new Set(relatedEdges.filter(link => link.type === "DERIVED_FROM" && relatedIds.has(idOf(link.source))).map(link => idOf(link.target)));
  const documents = nodes.filter(node => documentIds.has(node.id)).map(node => node.name);
  const path = item.path?.length ? `Le chemin analysé traverse ${item.path.length} éléments : ${item.path.join(" → ")}.` : "Aucun chemin témoin n’a été fourni par cet algorithme.";
  const context = `${related.length} nœud(s) directement concernés${types.length ? `, principalement de type ${types.join(", ")}` : ""}. ${path}`;
  const problemByCategory = {
    fragile_claim: `Le graphe traite « ${item.title} » comme une causalité, mais la quantification, le contexte ou la preuve sont insuffisants.`,
    unanswered_question: `La question « ${item.title} » reste ouverte alors que des éléments en aval en dépendent.`,
    underspecified_solution: `La solution « ${item.title} » ne possède pas encore un contrat complet de mise en œuvre, de test et de justification.`,
    contradiction: `Le graphe contient une incompatibilité potentielle autour de « ${item.title} », sans arbitrage contextuel suffisant.`,
    consolidation: `Le vocabulaire autour de « ${item.title} » fragmente peut-être une même notion ou un même prédicat.`,
    structural_bottleneck: `« ${item.title} » concentre assez de chemins pour qu’une faiblesse locale affecte une large partie du graphe.`,
    feedback_loop: `La boucle « ${item.title} » est détectée structurellement, mais son signe, son délai et son gain restent inconnus.`,
    evidence_leverage: `Une campagne de preuve centrée sur « ${item.title} » pourrait réduire plusieurs incertitudes simultanément.`,
    causal_gap: `« ${item.title} » est documenté et relié, mais n’affirme aucun effet sur un état ou une métrique.`,
    observability_gap: `« ${item.title} » : ce périmètre n’expose aucune cible falsifiable, ce qui rend le contrat causal insatisfiable localement.`,
    unmeasured_state: `« ${item.title} » décrit son indicateur en prose sans métrique reliée, donc sans unité pour la causalité qui le vise.`,
    orphan_metric: `« ${item.title} » mesure quelque chose que le modèle causal n’utilise pas.`,
    unquantified_causal: `« ${item.title} » affirme une causalité sans exprimer sa force ni la nature de sa défense.`,
    mistyped_causal: `« ${item.title} » occupe la famille causale alors qu’il décrit une intention ou une condition de possibilité.`
  };
  const closureByCategory = {
    fragile_claim: ["Contexte, population et horizon déclarés.", "Métrique et baseline définies.", "Au moins une estimation reliée à une méthode et une preuve, ou prédicat causal rétrogradé."],
    unanswered_question: ["Responsable et échéance attribués.", "Réponse candidate reliée avec ADDRESSES.", "Critère de clôture vérifiable défini."],
    underspecified_solution: ["Entrées, sorties et responsable documentés.", "Test avec seuil de réussite et condition d’échec relié.", "Justification et implémentation explicites."],
    contradiction: ["Contexte et période des deux propositions comparés.", "Compatibilité ou incompatibilité décidée.", "CONTRADICTS encodé seulement si nécessaire."],
    consolidation: ["Différences sémantiques documentées.", "Identifiant canonique et alias décidés.", "Aucune information ou provenance perdue."],
    structural_bottleneck: ["Hypothèses centrales documentées.", "Voie alternative ou mécanisme de repli identifié.", "Tests prioritaires reliés au nœud."],
    feedback_loop: ["Signe, délai et gain qualifiés pour chaque lien.", "Seuils et amortisseurs identifiés.", "Au moins un scénario de simulation défini."],
    evidence_leverage: ["Décisions influencées identifiées.", "Protocole discriminant et métrique définis.", "Résultats réutilisables reliés avec SUPPORTS_ESTIMATE."],
    causal_gap: ["Observable disponible dans le périmètre.", "CAUSES vers un system_state ou une metric, avec ses trois champs.", "Ou question ouverte assumant explicitement effect_unknown."],
    observability_gap: ["Au moins un état désirable formulé en termes observables.", "Son miroir indésirable existe.", "Chaque état relié à une métrique par MEASURED_BY."],
    unmeasured_state: ["Métrique identifiée ou créée avec son unité et sa méthode.", "Relation MEASURED_BY posée.", "stateIndicator conservé et cohérent avec la métrique."],
    orphan_metric: ["État objectivé identifié.", "Relation MEASURED_BY posée, ou écartement motivé.", "Aucune métrique supprimée sans trace."],
    unquantified_causal: ["Cible pourvue d’une métrique.", "effectSizePct, confidenceScore et evidenceBasis renseignés.", "Métrique, baseline et horizon nommés dans la justification."],
    mistyped_causal: ["Prédicat conforme appliqué, ou emploi causal défendu par écrit.", "CAUSES parallèle créé vers l’état réellement visé si l’effet est affirmé.", "Justification d’origine conservée."]
  };
  const patchByCategory = {
    fragile_claim: "Créer ou compléter context, metric, method et estimate ; ajouter SUPPORTS_ESTIMATE ou revoir le prédicat.",
    unanswered_question: "Créer une réponse candidate et une relation ADDRESSES, puis renseigner décision et échéance.",
    underspecified_solution: "Ajouter les nœuds experiment/method/metric manquants et les relations TESTS, IMPLEMENTS ou SUPPORTS_ESTIMATE.",
    contradiction: "Ajouter APPLIES_IN aux propositions, puis CONTRADICTS seulement après revue.",
    consolidation: "Créer un alias canonique ou préparer une fusion contrôlée avec conservation de provenance.",
    structural_bottleneck: "Ajouter tests, preuves et chemin alternatif autour du nœud central.",
    feedback_loop: "Renseigner polarité, délai, gain et mécanismes d’amortissement sur les liens du cycle.",
    evidence_leverage: "Créer une expérience commune, ses métriques et estimations, puis relier les preuves aux cibles.",
    causal_gap: "Ajouter un CAUSES chiffré vers l’état ou la métrique affectée, après avoir vérifié qu’un observable existe.",
    observability_gap: "Créer les system_state du périmètre (désirable et indésirable) et leurs metric, reliées par MEASURED_BY.",
    unmeasured_state: "Créer ou réutiliser une metric, puis poser MEASURED_BY depuis l’état.",
    orphan_metric: "Poser MEASURED_BY depuis l’état objectivé, ou documenter l’écartement de la métrique.",
    unquantified_causal: "Renseigner effectSizePct, confidenceScore et evidenceBasis sur l’arête existante.",
    mistyped_causal: "Retyper l’arête en MOTIVATES ou UNLOCKS, et créer le CAUSES vers l’état observable si l’effet est affirmé."
  };
  const prioritySignals = [
    `Priorité heuristique ${item.priority}/100`,
    ...(item.metrics || []).slice(0, 3).map(metric => `${metric.label} : ${metric.value}`),
    related.length ? `${related.length} nœuds reliés au diagnostic` : null
  ].filter(Boolean);
  return { ...item, problem: problemByCategory[item.category] || item.summary, why: guide.why, risk: guide.risk, probableCauses: guide.causes, context, clusters, documents, relatedEdgeCount: relatedEdges.length, prioritySignals, graphPatch: patchByCategory[item.category], closureCriteria: closureByCategory[item.category] || [], steps: [item.action, ...guide.steps].filter((value, index, values) => value && values.indexOf(value) === index), reviewQuestions: ["Quel résultat observable ferait changer cette conclusion ?", "Dans quel contexte cette recommandation cesse-t-elle d’être valable ?", "Quelle décision concrète dépend de sa résolution ?"] };
}

export function buildWorkstreams(report, health) {
  const indicator = id => health.indicators.find(item => item.id === id);
  const saturation = report.causalSaturation;
  const coverage = report.observability;
  // La complétude causale précède les autres chantiers : tant qu'un périmètre n'expose pas
  // d'observable, aucun effort de quantification n'y est possible.
  const completeness = {
    id: "completeness", icon: "link", title: "Complétude causale",
    count: (report.categoryCounts.causal_gap || 0) + (report.categoryCounts.observability_gap || 0),
    unit: "lacunes d’ancrage",
    urgency: "critique",
    problem: saturation && coverage
      ? `${saturation.satisfied}/${saturation.mechanisms} mécanismes affirment un effet, ${coverage.measuredStates}/${coverage.states} états sont reliés à une métrique${coverage.blindClusters.length ? `, et ${coverage.blindClusters.length} périmètre(s) n’exposent aucun observable` : ""}.`
      : "Indicateurs d’ancrage indisponibles dans ce rapport.",
    action: "Créer l’observable manquant, le relier par MEASURED_BY, puis chiffrer le CAUSES. npm run work:propose en produit les tâches candidates."
  };
  return [
    completeness,
    { id: "causal", icon: "pulse", title: "Maturité causale", count: report.categoryCounts.fragile_claim || 0, unit: "causalités à revoir", urgency: "critique", problem: `${indicator("quantification").numerator}/${indicator("quantification").denominator} causalités quantifiées et ${indicator("causal_context").numerator}/${indicator("causal_context").denominator} contextualisées.`, action: "Contextualiser les liens à plus fort impact, puis créer métriques, estimations et preuves." },
    { id: "questions", icon: "question", title: "Décisions ouvertes", count: report.categoryCounts.unanswered_question || 0, unit: "questions prioritaires", urgency: "haute", problem: `${indicator("questions").numerator}/${indicator("questions").denominator} questions possèdent une réponse candidate.`, action: "Attribuer responsable, échéance, réponse candidate et critère de clôture." },
    { id: "solutions", icon: "tool", title: "Spécification des solutions", count: report.categoryCounts.underspecified_solution || 0, unit: "diagnostics de lacune", urgency: "haute", problem: `${indicator("specification").numerator}/${indicator("specification").denominator} solutions ont au moins un lien de spécification, sans garantir un contrat complet.`, action: "Compléter test, justification et implémentation pour les solutions centrales." },
    { id: "provenance", icon: "document", title: "Provenance", count: indicator("provenance").denominator - indicator("provenance").numerator, unit: "propositions à sourcer", urgency: "moyenne", problem: `${indicator("provenance").numerator}/${indicator("provenance").denominator} propositions éligibles sont reliées à une source.`, action: "Ajouter document, page, section et relation DERIVED_FROM." },
    { id: "normalization", icon: "merge", title: "Normalisation", count: report.categoryCounts.consolidation || 0, unit: "chantiers de consolidation", urgency: "moyenne", problem: "Des alias de prédicats et doublons potentiels dispersent la structure.", action: "Revoir les nuances avant migration canonique ou fusion contrôlée." },
    { id: "dynamics", icon: "loop", title: "Dynamique du système", count: report.categoryCounts.feedback_loop || 0, unit: "boucles détectées", urgency: "moyenne", problem: "Les cycles sont structurels ; signe, délai, gain et saturation restent à qualifier.", action: "Qualifier puis simuler les boucles avant d’en tirer une conclusion." }
  ];
}

export function buildAlgorithmExecutions(report, health, ontology, nodes, links) {
  const traversalSpecs = [
    ["unansweredQuestion", "Questions non résolues", "unanswered_question", "Suit les relations de blocage depuis les questions ouvertes et vérifie l’absence de réponse explicite."],
    ["underspecifiedSolution", "Solutions sous-spécifiées", "underspecified_solution", "Traverse implémentations, tests et réponses pour repérer les solutions sans contrat opérationnel suffisant."],
    ["fragileClaim", "Affirmations causales fragiles", "fragile_claim", "Inspecte les prédicats causaux et recherche une quantification ou une chaîne de preuve associée."],
    ["contradiction", "Contradictions", "contradiction", "Combine contradictions explicites et tensions entre états opposés partageant un contexte structurel."],
    ["duplicateCandidate", "Consolidation", "consolidation", "Compare noms normalisés, types et signatures de voisinage sans fusion automatique."],
    ["structuralBottleneck", "Goulots structurels", "structural_bottleneck", "Mesure l’intermédiarité directionnelle et l’impact aval pondéré des nœuds centraux."],
    ["feedbackLoop", "Boucles de rétroaction", "feedback_loop", "Extrait les composantes fortement connexes et fournit un cycle témoin à qualifier."],
    ["evidenceLeverage", "Preuves à fort levier", "evidence_leverage", "Priorise les preuves susceptibles de réduire plusieurs incertitudes situées en aval."]
  ];
  const traversal = traversalSpecs.map(([contractId, label, category, description]) => ({
    id: `traversal:${contractId}`,
    kind: "traversal",
    label,
    status: "completed",
    inspected: `${nodes.length} nœuds · ${links.length} relations`,
    outputs: report.categoryCounts[category] || 0,
    mutations: 0,
    description,
    contract: ontology.traversalContract?.[contractId] || null,
    limitation: "Résultat heuristique à revoir humainement ; aucune conclusion factuelle ni mutation n’est produite automatiquement."
  }));

  const byIndicator = Object.fromEntries(health.indicators.map(item => [item.id, item]));
  const canonicalCandidates = links.filter(link => link.canonicalPredicate && link.canonicalPredicate !== link.type).length;
  const consolidationCandidates = report.categoryCounts.consolidation || 0;
  const repair = [
    ["canonical_predicates", "Migration vers les prédicats canoniques", canonicalCandidates, "Remplacer les alias historiques après validation sémantique de chaque lien."],
    ["provenance", "Complétion de provenance", byIndicator.provenance.denominator - byIndicator.provenance.numerator, "Proposer DERIVED_FROM et les localisations documentaires manquantes."],
    ["question_resolution", "Clôture des questions", byIndicator.questions.denominator - byIndicator.questions.numerator, "Proposer une relation ADDRESSES, un responsable et un critère de clôture."],
    ["causal_enrichment", "Enrichissement causal", Math.max(byIndicator.quantification.denominator - byIndicator.quantification.numerator, byIndicator.causal_context.denominator - byIndicator.causal_context.numerator), "Ajouter contexte, métrique, estimation, méthode et preuve aux causalités prioritaires."],
    ["consolidation", "Consolidation contrôlée", consolidationCandidates, "Préparer des fusions ou alias, sans supprimer ni fusionner automatiquement les nœuds."]
  ].map(([id, label, candidates, description]) => ({
    id: `repair:${id}`,
    kind: "repair",
    label,
    status: "dry_run",
    inspected: `${nodes.length} nœuds · ${links.length} relations`,
    outputs: candidates,
    mutations: 0,
    description,
    contract: null,
    limitation: "Exécution en simulation : les candidats sont calculés, mais aucune écriture n’est appliquée sans revue et décision humaine."
  }));
  return [...traversal, ...repair];
}
