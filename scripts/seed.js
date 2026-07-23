import fs from "node:fs/promises";
import path from "node:path";
import { getGraph, getClient, graphName } from "../src/db.js";
import { buildRelationJustification } from "../public/relation-justification.js";
import {
  loadManifest, selectGraph, loadOntology, readDatasets, datasetNodes, datasetLinks
} from "../src/graph-manifest.js";

const graphId = process.argv.find(arg => arg.startsWith("--graph="))?.split("=")[1] || "design";
const manifest = await loadManifest();
const graphConfig = selectGraph(manifest, graphId);
if (graphConfig.status !== "active") {
  throw new Error(`Graph "${graphId}" is declared but not active: ${graphConfig.frontier?.note || "no ontology or dataset yet"}`);
}
const graphOntology = await loadOntology(graphConfig);
const datasets = await readDatasets(graphConfig);
const datasetById = new Map(datasets.map(entry => [entry.id, entry]));

const ontologyNodeTypes = new Map([
  ...graphOntology.nodeTypes.map(type => [type.id, type]),
  ...(graphOntology.semanticTypes || []).map(type => [type.id, type])
]);
const ontologyRelationTypes = new Map(graphOntology.relationTypes.map(type => [type.id, type]));
const activeRelationTypes = new Set(graphOntology.relationTypes.filter(type => type.status === "active").map(type => type.id));

function normalizeNode(node, defaults = {}) {
  return {
    id: node.id,
    name: node.name,
    phrase: node.phrase,
    phraseStatus: defaults.phraseStatus || "proposition de travail",
    family: node.family,
    region: defaults.region || "Mind Protocol · projet NLR",
    period: defaults.period || "hypothèse de projet · 2026",
    startYear: node.year ?? defaults.startYear ?? 2026,
    dateLabel: node.dateLabel || defaults.dateLabel || "projection 2026",
    nodeType: node.nodeType,
    semanticType: node.semanticType || node.nodeType,
    status: node.status || defaults.status || "proposition de design",
    summary: node.summary,
    sourceUrl: node.sourceUrl || "",
    sourceTitle: node.sourceTitle || "",
    forecastWindow: node.dateLabel || "",
    forecastConfidence: node.confidence || "",
    forecastSignals: node.signals || "",
    forecastAssumptions: node.assumptions || "",
    forecastImpact: node.impact || "",
    forecastResponse: node.response || "",
    hypothesisBasis: node.hypothesisBasis || "",
    verificationNeeded: node.verificationNeeded || "",
    questionCategory: node.questionCategory || "",
    decisionNeeded: node.decisionNeeded || "",
    decisionStatus: node.decisionStatus || "",
    responsibleRole: node.responsibleRole || "",
    decisionDue: node.decisionDue || "",
    chosenOptionId: node.chosenOptionId || "",
    decisionRationale: node.decisionRationale || "",
    reviewDate: node.reviewDate || "",
    closureEvidence: node.closureEvidence || "",
    optionCriteria: node.optionCriteria || [],
    // Ancrage `parameterContract` : sans ces trois champs, l'API rend une décision
    // de paramètre amputée de ce qu'elle gouverne, et un barreau nul devient
    // indiscernable d'un champ jamais persisté.
    codeParameters: node.codeParameters || [],
    evidenceRung: node.evidenceRung || "",
    evidenceRungNote: node.evidenceRungNote || "",
    optionCode: node.optionCode || "",
    optionBenefits: node.optionBenefits || [],
    optionRisks: node.optionRisks || [],
    optionConditions: node.optionConditions || [],
    stateOrientation: node.stateOrientation || "",
    stateDimension: node.stateDimension || "",
    stateIndicator: node.stateIndicator || "",
    clusterId: node.clusterId || defaults.clusterId || "",
    sourcePage: node.sourcePage || "",
    documentSection: node.documentSection || "",
    epistemicStatus: node.epistemicStatus || "",
    contextId: node.contextId || "",
    context: node.context || "",
    definition: node.definition || "",
    definitionStatus: node.definitionStatus || "",
    populationOrSystem: node.populationOrSystem || "",
    jurisdiction: node.jurisdiction || "",
    validFrom: node.validFrom || "",
    validTo: node.validTo || "",
    metricId: node.metricId || "",
    methodId: node.methodId || "",
    baselineValue: node.baselineValue ?? "",
    scenarioValue: node.scenarioValue ?? "",
    probabilityPct: node.probabilityPct ?? "",
    confidenceScore: node.confidenceScore ?? "",
    effectSizePct: node.effectSizePct ?? "",
    valenceScore: node.valenceScore ?? "",
    humanValenceDelta: node.humanValenceDelta ?? "",
    quantificationStatus: node.quantificationStatus || "unquantified",
    supportingNodes: node.supportingNodes || [],
    sourceRepository: node.sourceRepository || defaults.sourceRepository || "",
    sourcePath: node.sourcePath || "",
    sourceHash: node.sourceHash || "",
    sourceId: node.sourceId || "",
    sourceLocator: node.sourceLocator || "",
    authors: node.authors || [],
    publicationYear: node.publicationYear ?? "",
    arxivId: node.arxivId || "",
    doi: node.doi || "",
    studyDesign: node.studyDesign || "",
    unit: node.unit || "",
    estimateValue: node.estimateValue || "",
    evidenceRole: node.evidenceRole || "",
    certaintyStatus: node.certaintyStatus || "",
    externalReferences: node.externalReferences || [],
    sourceCommit: node.sourceCommit || defaults.sourceCommit || "",
    observedAt: node.observedAt || defaults.observedAt || "",
    evidenceType: node.evidenceType || "",
    maturity: node.maturity || "",
    ownerRole: node.ownerRole || "",
    targetDate: node.targetDate || "",
    responseStatus: node.responseStatus || "",
    closureCriteria: node.closureCriteria || "",
    testObjective: node.testObjective || "",
    methodSummary: node.methodSummary || "",
    metricIds: node.metricIds || [],
    failureCondition: node.failureCondition || "",
    minimumSample: node.minimumSample || "",
    workStatus: node.workStatus || "",
    priority: node.priority ?? "",
    autonomyMode: node.autonomyMode || "",
    acceptanceCriteria: node.acceptanceCriteria || [],
    verificationCommand: node.verificationCommand || "",
    // Les tâches autonomes doivent conserver dans FalkorDB la preuve du dernier
    // contact humain et le blocage concret. Sinon `sense()` relit une tâche
    // amnésique et peut renotifier sans savoir ce qui a déjà été livré.
    depositPath: node.depositPath || "",
    blockerCause: node.blockerCause || "",
    needsFromCitizen: node.needsFromCitizen || "",
    lastNotificationAt: node.lastNotificationAt || "",
    lastNotificationChannel: node.lastNotificationChannel || "",
    lastNotificationMessageId: node.lastNotificationMessageId || "",
    notificationDeliveryStatus: node.notificationDeliveryStatus || "",
    probeIntervalSeconds: node.probeIntervalSeconds ?? "",
    probeFreshnessSeconds: node.probeFreshnessSeconds ?? "",
    probeTargetIds: node.probeTargetIds || [],
    healthProofKind: node.healthProofKind || "",
    healthProofDimension: node.healthProofDimension || "",
    healthProofAutomation: node.healthProofAutomation || "",
    healthProofSemanticTypes: node.healthProofSemanticTypes || [],
    healthDefaultVerificationCommand: node.healthDefaultVerificationCommand || "",
    healthProofContractId: node.healthProofContractId || "",
    content: node.content || "",
    channel: node.channel || "",
    sourceMessageId: node.sourceMessageId || "",
    occurredAt: node.occurredAt || "",
    correspondsTo: node.correspondsTo || "",
    identityRef: node.identityRef || "",
    citizenId: node.citizenId || "",
    citizen: node.citizen === true,
    externalThreadId: node.externalThreadId || "",
    updatedAt: node.updatedAt || "",
    completedAt: node.completedAt || "",
    changeKind: node.changeKind || "",
    changedPaths: node.changedPaths || [],
    // `blueprintContract` : l'axiome de prohibition nomme les catégories qu'un L1
    // ne peut pas recevoir à sa naissance. Non persistée, la liste deviendrait un
    // paragraphe de prose et le validateur contrôlerait un pointeur vers rien.
    prohibitedPrefills: node.prohibitedPrefills || [],
    // `importContract` : la catégorie de source rattache une méthode d'import à
    // l'échelle déclarée par le schéma. Non persistée, l'échelle ne serait plus
    // vérifiable qu'au validateur et l'API ne pourrait pas dire d'où vient un atome.
    importSourceKind: node.importSourceKind || "",
    // `predictionContract` : les domaines à prédiction restreinte sont une promesse
    // faite à la personne modélisée. Non persistée, elle ne serait vérifiable qu'au
    // validateur, et l'API ne pourrait pas dire qu'une prédiction relève d'un
    // domaine qu'elle n'a pas le droit d'afficher.
    restrictedPredictionDomains: node.restrictedPredictionDomains || []
  };
}

const scenarioProfile = {
  MAKES_PLAUSIBLE: { effect: "rend plausible", strength: 3, polarity: "mixte" },
  SCENARIO_LEADS_TO: { effect: "accélère", strength: 4, polarity: "mixte" },
  PRESSURES: { effect: "intensifie", strength: 4, polarity: "risque" },
  MITIGATES: { effect: "atténue", strength: 3, polarity: "protectrice" }
};

// Chaque jeu de données porte une présentation propre : d'où vient la phrase, à
// quelle région et période elle appartient, et quelle réserve accompagne ses
// relations. Ces profils restent du code — ils dépendent du nœud ou du lien — mais
// leur clé est désormais l'identifiant déclaré dans `graphs.json`.
const DATASET_PROFILES = {
  "temporal-membrane": {
    node: node => ({
      phraseStatus: node.semanticType === "decision" ? "décision de design approuvée"
        : node.semanticType === "change" ? "changement livré et vérifiable"
        : node.semanticType === "axiom" ? "invariant de design"
        : "composant de design de la membrane temporelle",
      region: "Mind Protocol · membrane temporelle",
      period: "première implémentation · 2026",
      status: node.epistemicStatus === "documented" ? "documenté" : "proposition de design"
    }),
    link: () => ({
      quality: "relation de design temporel",
      note: "Relation justifiée de la chaîne L1 → L2 → L4 ; elle décrit perception, autorisation, dormance ou livraison sans constituer une preuve causale empirique."
    })
  },
  "l3-ecosystem-bootstrap": {
    node: () => ({
      phraseStatus: "trace externe observée",
      region: "L3 · écosystème vécu",
      period: "conversation datée · 2026",
      status: "trace observée"
    }),
    link: () => ({
      quality: "relation événementielle observée",
      note: "Relation L3 datée et attribuée ; elle décrit le stimulus externe sans inférer un état interne ni une action du citoyen."
    })
  },
  "mind-root": {
    node: () => ({
      phraseStatus: "hypothèse centrale du projet",
      region: "Mind Protocol · projet NLR",
      period: "protocole expérimental · 2026",
      status: "hypothèse de projet"
    })
  },
  "mind-protocol-concepts": {
    node: () => ({ phraseStatus: "extrait ou adaptation du manifeste Mind Protocol" }),
    link: () => ({
      quality: "relation prospective",
      note: "Relation prospective extraite du manifeste ; à valider par le design et la gouvernance.",
      contextId: "mind-manifesto-design-trajectory", populationOrSystem: "architecture cible Mind Protocol",
      methodId: "method-structured-causal-review"
    })
  },
  "mind-economic-causality": {
    node: () => ({
      phraseStatus: "hypothèse de design économique à débattre",
      region: "Mind Protocol · économie expérimentale",
      period: "modèle causal de projet · 2026"
    }),
    link: () => ({
      quality: "hypothèse causale de design",
      note: "Lien causal de design à tester ; ce n’est pas une causalité empirique établie."
    })
  },
  "code-parameter-decisions": {
    node: node => ({
      phraseStatus: node.nodeType === "decision_option" ? "option comparée, non approuvée"
        : node.nodeType === "design_rationale" ? "raison de justification du code explicitée"
        : "arbitrage de paramètre à trancher",
      region: "Mind Protocol · paramètres du code",
      period: "gouvernance des paramètres · 2026",
      clusterId: "code-parameters"
    }),
    link: () => ({
      quality: "arbitrage de paramètre",
      note: "Relation de gouvernance : elle décrit un paramètre à trancher, pas une causalité."
    })
  },
  "economy-price-formation": {
    node: node => ({
      phraseStatus: node.nodeType === "axiom" ? "contrainte de design à respecter"
        : node.nodeType === "design_effect" ? "effet recherché, non observé"
        : node.nodeType === "decision_option" ? "option comparée, non approuvée"
        : "proposition de design économique à débattre",
      region: "Mind Protocol · économie expérimentale",
      period: "formation des prix · 2026",
      clusterId: "price-formation"
    }),
    link: () => ({
      quality: "conséquence envisagée",
      note: "Conséquence argumentée d’une option non approuvée ; aucune n’est mesurée ni simulée.",
    })
  },
  "mind-validation-roadmap": {
    node: node => ({
      phraseStatus: node.nodeType === "working_hypothesis" ? "hypothèse de travail à vérifier"
        : node.nodeType === "open_question" ? "question ouverte du programme" : "état testable du système",
      region: "Mind Protocol · programme de validation",
      period: "backlog vivant · 2026",
      dateLabel: "travail en cours 2026"
    }),
    link: () => ({
      quality: "programme de validation",
      note: "Lien de programme à tester ou décider ; il ne constitue pas une preuve causale."
    })
  },
  "forecast-events": {
    node: node => ({
      phraseStatus: "phrase prospective de travail",
      region: "Scénario global · Mind Protocol",
      period: `fenêtre prospective ${node.dateLabel}`,
      status: `scénario · confiance ${node.confidence}`
    }),
    link: link => {
      const profile = scenarioProfile[link.type];
      const eventToEvent = link.source.startsWith("forecast-") && link.target.startsWith("forecast-");
      return {
        quality: "relation prospective et conditionnelle", note: "Lien de scénario, non prédiction causale.",
        forecastEffect: profile.effect,
        forecastStrength: profile.strength,
        forecastPolarity: profile.polarity,
        forecastDelay: eventToEvent ? "selon les fenêtres des deux scénarios" : "selon la fenêtre du scénario cible",
        forecastFeedback: "influence à sens principal",
        contextId: "global-transition-scenario-2026-2045", populationOrSystem: "scénario sociotechnique mondial",
        validFrom: "2026", validTo: "2045", methodId: "method-scenario-ordinal-assessment",
        metricId: "metric-scenario-influence-score",
        quantificationStatus: "ordinal_scenario_score"
      };
    }
  },
  "forecast-influences": {
    link: link => ({
      quality: `intensité ${link.strength}/5 · polarité ${link.polarity}`,
      note: "Influence relative de scénario ; intensité comparative, non probabilité statistique.",
      forecastFeedback: link.feedback ? "boucle de rétroaction" : "influence à sens principal",
      contextId: "global-transition-scenario-2026-2045", populationOrSystem: "scénario sociotechnique mondial",
      validFrom: "2026", validTo: "2045", methodId: "method-scenario-ordinal-assessment",
      metricId: "metric-scenario-influence-score", quantificationStatus: "ordinal_scenario_score"
    })
  },
  "civilization-endgame": {
    node: node => ({
      phraseStatus: node.nodeType === "source_document" ? "document stratégique daté" : "proposition extraite du document",
      region: "Mind Protocol · Civilization Endgame",
      period: "document stratégique · 2026",
      dateLabel: node.dateLabel || "draft 2026"
    }),
    link: link => ({
      quality: link.type === "DERIVED_FROM" ? "provenance documentaire" : "proposition stratégique extraite",
      note: "Relation extraite ou interprétée depuis Civilization Endgame ; elle décrit la doctrine du document, pas un effet empirique établi."
    })
  },
  "endgame-domains": {
    node: node => ({
      phraseStatus: node.nodeType === "source_document" ? "document stratégique daté" : "proposition extraite du document",
      region: "Mind Protocol · Endgames spécialisés",
      period: "documents stratégiques · 2026",
      dateLabel: "draft 2026"
    }),
    link: link => ({
      quality: link.type === "DERIVED_FROM" ? "provenance documentaire" : "proposition stratégique extraite",
      note: "Relation extraite ou interprétée depuis un document Endgame spécialisé ; ce n'est pas une causalité empirique établie.",
      contextId: "endgame-strategic-doctrine-2026", populationOrSystem: "architecture cible Mind Protocol",
      methodId: "method-structured-causal-review"
    })
  },
  "causal-science-implementation": {
    node: node => ({
      phraseStatus: node.nodeType === "source_document" ? "spécification technique datée" : "contrat extrait de la spécification",
      region: "Mind Protocol · Causal Science Graph",
      period: "spécification v0.2 · 12 juillet 2026",
      dateLabel: "12 juillet 2026"
    }),
    link: link => ({
      quality: link.type === "DERIVED_FROM" ? "provenance documentaire" : "contrat d'architecture extrait",
      note: "Relation issue de la spécification CSG v0.2 ; elle décrit une architecture cible et non l'état déjà livré du logiciel.",
      contextId: "csg-v0.2-target-architecture", populationOrSystem: "implémentation cible CSG",
      methodId: "method-structured-causal-review"
    })
  },
  "human-prediction-engine-endgame": {
    node: node => ({
      phraseStatus: node.nodeType === "axiom" ? "doctrine de prédiction décidée"
        : node.nodeType === "metric" ? "grandeur définie, mesure encore à produire"
        : node.nodeType === "open_question" ? "verrou ouvert avant branchement du moteur"
        : "boucle de prédiction proposée",
      region: "Mind Protocol · Endgame du moteur de prédiction",
      period: "modélisation continue de la personne · 2026",
      clusterId: "human-prediction-engine"
    }),
    link: () => ({
      quality: "relation de design à tester",
      note: "La boucle prédire-observer-scorer-corriger est décidée ; la frontière entre prédire et influencer, l attribution de la dérive et l autorité sur les domaines restreints restent ouvertes.",
      contextId: "context-continuous-local-prediction",
      populationOrSystem: "personne modélisée en continu par son IA personnelle, en local",
      methodId: "mech-skill-scoring-against-routine-baseline"
    })
  },
  "l1-seed-import-endgame": {
    node: node => ({
      phraseStatus: node.nodeType === "axiom" ? "doctrine d import décidée"
        : node.nodeType === "method" ? "source d import proposée à calibrer"
        : node.nodeType === "metric" ? "grandeur définie, mesure encore à produire"
        : node.nodeType === "open_question" ? "verrou ouvert avant tout import réel"
        : "chaîne d import proposée",
      region: "Mind Protocol · Endgame du seed et de l import",
      period: "reconstitution du corpus personnel · 2026",
      clusterId: "l1-seed-import"
    }),
    link: () => ({
      quality: "relation de design à tester",
      note: "L atomisation, la provenance et l oubli propagé sont décidés ; le consentement des tiers, la révocation des atomes dérivés et la mesure de fidélité restent ouverts.",
      contextId: "context-l1-consented-personal-corpus",
      populationOrSystem: "personne important son propre corpus, source par source",
      methodId: "mech-l1-seed-import-pipeline"
    })
  },
  "l1-blueprint": {
    node: node => ({
      phraseStatus: node.nodeType === "axiom" ? "invariant constitutionnel décidé"
        : node.nodeType === "mechanism" ? "pièce de structure proposée"
        : node.nodeType === "metric" ? "grandeur définie, mesure encore à produire"
        : node.nodeType === "open_question" ? "verrou ouvert avant diffusion du blueprint"
        : "contrat de naissance proposé",
      region: "Mind Protocol · Blueprint L1",
      period: "contrat de naissance du graphe citoyen · 2026",
      clusterId: "l1-blueprint"
    }),
    link: () => ({
      quality: "relation de design à tester",
      note: "Le blueprint décrit la structure commune ; le seed concret, la procédure de migration et l autorité d amendement restent des questions ouvertes.",
      contextId: "context-l1-birth",
      populationOrSystem: "instance L1 naissante, avant toute donnée personnelle"
    })
  },
  "human-valence-endgame": {
    node: node => ({
      phraseStatus: node.nodeType === "axiom" ? "finalité normative décidée"
        : node.nodeType === "method" ? "capteur proposé à calibrer"
        : node.nodeType === "metric" ? "grandeur définie, mesure encore à produire"
        : node.nodeType === "open_question" ? "verrou ouvert avant effet sur les prix"
        : "architecture de valeur proposée",
      region: "Mind Protocol · Endgame de la valence humaine",
      period: "doctrine et protocole progressif · 2026",
      clusterId: "human-valence-endgame"
    }),
    link: () => ({
      quality: "relation de design à tester",
      note: "La finalité est normative ; les capteurs, l attribution causale et la traduction en prix restent à calibrer et à gouverner.",
      contextId: "context-local-consensual-valence",
      populationOrSystem: "personne utilisant Mind dans un contexte consenti",
      methodId: "protocol-progressive-human-valence-estimation"
    })
  },
  "question-endgame": {
    node: node => ({
      phraseStatus: node.nodeType === "decision" || node.nodeType === "open_question" ? "arbitrage ouvert" : "architecture de runtime proposée",
      region: "Mind Protocol · Endgame de la question",
      period: "design en débat · 22 juillet 2026",
      dateLabel: "22 juillet 2026"
    }),
    link: link => ({
      quality: link.type === "DERIVED_FROM" ? "provenance documentaire" : "relation de design argumentée",
      note: "Architecture proposée issue du débat ; les mécanismes restent à arbitrer et à tester.",
      contextId: "question-runtime-target-architecture",
      populationOrSystem: "runtime de question Mind multi-graphe",
      methodId: "method-structured-causal-review"
    })
  },
  "l4-ontology-mapping": {
    node: node => ({
      phraseStatus: node.nodeType === "open_question" ? "gap de représentation ouvert"
        : node.nodeType === "working_hypothesis" ? "signature proposée à calibrer"
        : "contrat de traduction proposé",
      region: "Architecture Mind · migration vers L4",
      period: "mapping 2026",
      dateLabel: "22 juillet 2026",
      clusterId: "l4-ontology-mapping"
    }),
    link: () => ({
      quality: "relation de mapping proposée",
      note: "Le mapping distingue traduction structurelle, prototype physique et perte sémantique ; il ne prouve pas encore la suffisance des axes."
    })
  },
  "mind-protocol-repository": {
    mapNode: (node, { data }) => ({
      ...node,
      sourceUrl: node.sourcePath
        ? `https://github.com/${data.provenance.repository}/blob/${data.provenance.commit}/${node.sourcePath}`
        : data.provenance.commitUrl,
      sourceTitle: node.sourcePath || data.provenance.repository
    }),
    node: (node, { data }) => ({
      phraseStatus: node.nodeType === "source_document" ? "source GitHub figée au commit" : "proposition extraite du dépôt GitHub",
      region: "Mind Protocol · dépôt L4",
      period: `état observé le ${data.provenance.observedAt}`,
      dateLabel: data.provenance.observedAt,
      sourceRepository: data.provenance.repository,
      sourceCommit: data.provenance.commit,
      observedAt: data.provenance.observedAt,
      clusterId: "mind-protocol-github-l4"
    }),
    link: (link, { data }) => ({
      quality: link.type === "DERIVED_FROM" ? "provenance GitHub immuable" : "relation documentée ou divergence de version",
      note: `Relation issue de ${data.provenance.repository}@${data.provenance.commit.slice(0, 7)} ; son statut dépend de la maturité des nœuds reliés.`,
      sourceRepository: data.provenance.repository,
      sourceCommit: data.provenance.commit,
      observedAt: data.provenance.observedAt
    })
  },
  "mind-strategic-feedback": {
    node: node => ({
      phraseStatus: node.nodeType === "source_document" ? "feedback stratégique daté" : "constat ou recommandation à arbitrer",
      region: "Mind Protocol · revue stratégique",
      period: "feedback intégré · juillet 2026",
      dateLabel: "21 juillet 2026",
      clusterId: "strategic-feedback-decisions"
    }),
    link: link => ({
      quality: link.type === "DERIVED_FROM" ? "provenance du feedback" : "recommandation stratégique à arbitrer",
      note: "Relation issue d’un feedback critique ou de sa synthèse décisionnelle ; aucune recommandation n’est réputée approuvée."
    })
  },
  "analysis-remediation": {
    node: node => ({
      phraseStatus: node.nodeType === "source_document" ? "rapport d’analyse daté" : "réponse candidate à discuter",
      region: "Mind Protocol · remédiation de l’analyse",
      period: "lot de remédiation · juillet 2026",
      dateLabel: "21 juillet 2026",
      clusterId: "analysis-remediation-2026-07"
    }),
    link: link => ({
      quality: link.type === "DERIVED_FROM" ? "provenance du rapport d’analyse" : "réponse candidate non validée",
      note: link.type === "DERIVED_FROM"
        ? "Cette proposition provient du rapport d’analyse copié par l’utilisateur le 21 juillet 2026."
        : "Réponse candidate créée pour traiter une recommandation ; elle reste à arbitrer et à valider."
    })
  },
  "analysis-validation-contracts": {
    node: node => ({
      phraseStatus: node.nodeType === "experiment" ? "protocole falsifiable non exécuté" : "composant de protocole proposé",
      region: "Mind Protocol · validation des remédiations",
      period: "programme de validation · 2026",
      dateLabel: "planifié le 21 juillet 2026",
      clusterId: "analysis-validation-contracts"
    }),
    link: link => ({
      quality: link.type === "DERIVED_FROM" ? "provenance du besoin de validation" : "contrat de test proposé",
      note: link.type === "DERIVED_FROM"
        ? "Le besoin de ce protocole découle du rapport de remédiation ; aucun résultat empirique n’est revendiqué."
        : "Relation de protocole planifiée ; elle décrit comment tester, pas ce que le test conclura."
    })
  },
  "evidence-leverage-programs": {
    node: node => ({
      phraseStatus: node.nodeType === "experiment" ? "programme de recherche non exécuté" : "composant de mesure proposé",
      region: "Mind Protocol · programme de preuve",
      period: "priorités empiriques · 2026–2027",
      dateLabel: "planifié le 21 juillet 2026",
      clusterId: "evidence-leverage-programs"
    }),
    link: () => ({
      quality: "programme empirique proposé",
      note: "Relation d’un programme de recherche planifié ; aucun résultat ni effet causal n’est encore revendiqué."
    })
  },
  consultations: {
    node: node => ({
      phraseStatus: node.nodeType === "consultation" ? "sollicitation externe, sans réponse acquise"
        : node.nodeType === "actor" ? "acteur public cité comme répondant" : "réponse externe rapportée",
      region: `Consultation · ${node.consultationChannel || "audience externe"}`,
      period: `consultation · ${node.askedAt || node.dateLabel || "2026"}`,
      dateLabel: node.dateLabel || node.askedAt || "2026",
      status: node.nodeType === "consultation" ? `consultation ${node.consultationStatus || "draft"}`
        : "position rapportée, non validée",
      clusterId: "consultations"
    }),
    link: link => ({
      quality: link.type === "CONSULTS" ? "point soumis à une audience externe"
        : link.type === "ANSWERS" ? "provenance de consultation"
        : link.type === "AUTHORED_BY" ? "attribution d'auteur" : "signal externe à discuter",
      note: "Relation issue d'une consultation externe ; elle documente ce qui a été demandé ou répondu, jamais une preuve. Aucune valeur chiffrée du modèle n'en dépend."
    })
  },
  "reddit-ai-democracy": {
    node: node => ({
      phraseStatus: node.nodeType === "actor" ? "acteur public cité comme auteur ou contributeur"
        : node.nodeType === "source_document" ? "source Reddit datée" : "signal externe issu d'une discussion publique",
      region: "Reddit · r/artificial",
      period: "discussion publique · 22 juillet 2026",
      dateLabel: node.dateLabel || "22 juillet 2026",
      status: node.nodeType === "observation" ? "auto-observation non indépendante"
        : node.nodeType === "actor" ? "acteur source" : "signal externe documenté",
      clusterId: "reddit-ai-democracy-2026-07-22"
    }),
    link: link => ({
      quality: link.type === "DERIVED_FROM" ? "provenance Reddit"
        : link.type === "AUTHORED_BY" ? "attribution d'auteur Reddit" : "signal externe à discuter",
      note: "Relation issue d'un thread Reddit public ; elle documente une idée ou objection, pas une preuve empirique établie."
    })
  },
  "evidence-appraisal-method": {
    node: node => ({
      phraseStatus: node.nodeType === "source_document" ? "méthode datée et versionnée"
        : node.nodeType === "terme" ? "terme défini par la méthode"
        : node.nodeType === "method" ? "instrument d'évaluation documenté"
        : node.nodeType === "open_question" ? "articulation non tranchée"
        : "règle d'évaluation extraite",
      region: "SciSense · évaluation des preuves",
      period: "méthode v2.1 · 22 juillet 2026",
      dateLabel: "22 juillet 2026",
      clusterId: "evidence-appraisal-method"
    }),
    link: link => ({
      quality: link.type === "DERIVED_FROM" ? "provenance de la méthode" : "règle méthodologique extraite",
      note: "Relation issue d'une méthode d'évaluation des preuves ; elle décrit comment juger une preuve, elle ne constitue pas elle-même une preuve empirique."
    })
  },
  "graph-architecture-decisions": {
    node: node => ({
      phraseStatus: node.nodeType === "decision" ? "arbitrage d’architecture tracé"
        : node.nodeType === "decision_option" ? "option d’architecture comparée" : "raison d’architecture explicitée",
      region: "Mind Causal Graph · architecture de l’outil",
      period: "arbitrages d’architecture · 2026",
      dateLabel: "22 juillet 2026",
      clusterId: "graph-architecture"
    }),
    link: () => ({
      quality: "arbitrage d’architecture versionné",
      note: "Relation d’architecture de l’outil ; elle documente une décision de conception du graphe, pas une causalité empirique."
    })
  },
  "project-work": {
    node: node => ({
      phraseStatus: node.nodeType === "change" ? "changement livré et vérifié" : "objet opérationnel du projet",
      region: "Mind Protocol · pilotage du projet",
      period: "backlog et journal vivants · 2026",
      dateLabel: node.updatedAt || "travail en cours",
      clusterId: "project-work"
    }),
    link: () => ({
      quality: "relation opérationnelle versionnée",
      note: "Relation de pilotage du projet ; elle décrit le travail prévu ou livré, pas une preuve causale."
    })
  },
  "satopaa-information-diversity": {
    node: node => ({
      phraseStatus: node.nodeType === "source_document" ? "artefact scientifique figé"
        : node.nodeType === "claim" ? "claim attribué aux auteurs"
        : "représentation scientifique sourcée",
      region: "Graphe scientifique · Satopää",
      period: "publication 2014-2016 · ingestion 2026",
      dateLabel: "22 juillet 2026",
      clusterId: node.clusterId
    }),
    link: link => ({
      quality: link.type === "LOCATED_IN" || link.type === "DESCRIBES" ? "provenance vérifiable" : "relation scientifique attribuée",
      note: "Relation du cluster Satopää ; elle conserve le contexte et ne transfère aucune certitude vers le graphe de design."
    })
  }
};

// Un profil manquant n'est pas fatal : il ne coûte que la présentation (région,
// période, statut de phrase), jamais la donnée elle-même. Faire échouer le seed
// entier bloquerait tout le monde dès qu'un jeu de données est déclaré dans
// `graphs.json` avant que son profil soit écrit — ce qui arrive dès que deux
// chantiers avancent en parallèle. On charge avec les valeurs génériques et on
// le dit fort.
const EMPTY_PROFILE = {};
for (const entry of datasets) {
  if (!DATASET_PROFILES[entry.id]) {
    console.warn(`Avertissement : le jeu de données "${entry.id}" n'a pas de profil de seed. Chargé avec la présentation générique ; ajoute son entrée dans DATASET_PROFILES.`);
  }
}

const allNodes = [];
for (const entry of datasets) {
  const profile = DATASET_PROFILES[entry.id] || EMPTY_PROFILE;
  for (const rawNode of datasetNodes(entry)) {
    const node = profile.mapNode ? profile.mapNode(rawNode, entry) : rawNode;
    allNodes.push(normalizeNode(node, profile.node ? profile.node(node, entry) : {}));
  }
}
const nodeById = new Map(allNodes.map(node => [node.id, node]));

const relationLabels = {
  GROUNDS: "fonde", SAFEGUARDS: "protège", UNLOCKS: "débloque", IMPLEMENTS: "met en œuvre",
  LEADS_TO: "conduit potentiellement à", CONVERGES_IN: "converge dans", MOTIVATES: "motive ce choix",
  CAUSES: "produit ou contribue à produire", FEEDS: "alimente", ASSUMES: "suppose",
  BLOCKS: "conditionne ou bloque", TESTS: "met à l’épreuve", ADDRESSES: "répond à", COMMUNICATES: "met en récit",
  MAKES_PLAUSIBLE: "rend plausible", SCENARIO_LEADS_TO: "peut conduire au scénario",
  PRESSURES: "met sous pression", MITIGATES: "atténue", AFFECTS_SCENARIO: "affecte le scénario",
  OPTION_FOR: "est une option pour", RECOMMENDS: "recommande",
  DERIVED_FROM: "dérive du document", AUTHORED_BY: "attribué à"
};

function normalizeLink(link, defaults = {}) {
  const relationType = ontologyRelationTypes.get(defaults.type || link.type);
  return {
    ...link,
    type: defaults.type || link.type,
    note: link.note || defaults.note || "Relation de travail à vérifier.",
    justification: buildRelationJustification(
      link,
      nodeById.get(link.source)?.name || link.source,
      nodeById.get(link.target)?.name || link.target,
      relationType
    ),
    relationLabel: relationLabels[defaults.type || link.type] || ontologyRelationTypes.get(defaults.type || link.type)?.label || defaults.type || link.type,
    relationStory: link.story || "",
    relationQuality: defaults.quality || "relation de travail",
    causalLogic: link.logic || "",
    causalCondition: link.condition || "",
    causalRisk: link.risk || "",
    contextId: link.contextId || defaults.contextId || "",
    populationOrSystem: link.populationOrSystem || defaults.populationOrSystem || "",
    validFrom: link.validFrom || defaults.validFrom || "",
    validTo: link.validTo || defaults.validTo || "",
    methodId: link.methodId || defaults.methodId || "",
    metricId: link.metricId || defaults.metricId || "",
    quantificationStatus: link.quantificationStatus || defaults.quantificationStatus || "unquantified",
    // Quantification portée par l'arête (ontologie 1.9.0, `linkQuantification`) :
    // absente par défaut, jamais inventée. Une arête causale nue reste nue.
    effectSizePct: link.effectSizePct ?? "",
    confidenceScore: link.confidenceScore ?? "",
    evidenceBasis: link.evidenceBasis || "",
    forecastEffect: defaults.forecastEffect || link.effect || "",
    forecastStrength: defaults.forecastStrength ?? link.strength ?? 0,
    forecastPolarity: defaults.forecastPolarity || link.polarity || "",
    forecastDelay: link.delay || defaults.forecastDelay || "",
    forecastDimensions: link.dimensions || defaults.forecastDimensions || "",
    forecastFeedback: link.feedback ? "boucle de rétroaction" : defaults.forecastFeedback || "",
    sourceRepository: link.sourceRepository || defaults.sourceRepository || "",
    sourceCommit: link.sourceCommit || defaults.sourceCommit || "",
    observedAt: link.observedAt || defaults.observedAt || "",
    weight: link.weight ?? link.physics?.W ?? ""
  };
}

const allLinks = [];
for (const entry of datasets) {
  const profile = DATASET_PROFILES[entry.id] || EMPTY_PROFILE;
  for (const rawLink of datasetLinks(entry)) {
    allLinks.push(normalizeLink(rawLink, profile.link ? profile.link(rawLink, entry) : {}));
  }
}

// `--dry-run=<fichier>` écrit le corpus normalisé sans toucher à FalkorDB. Sert à
// comparer deux versions du chargeur et à vérifier le seed sans Docker.
const dryRunTarget = process.argv.find(arg => arg.startsWith("--dry-run="))?.split("=")[1];
if (dryRunTarget) {
  const dryRunPath = path.resolve(dryRunTarget);
  await fs.mkdir(path.dirname(dryRunPath), { recursive: true });
  await fs.writeFile(dryRunPath, JSON.stringify({ nodes: allNodes, links: allLinks }, null, 2), "utf8");
  console.log(`Dry run: ${allNodes.length} nodes and ${allLinks.length} relations written to ${dryRunTarget}.`);
  process.exit(0);
}

// Garde-fou : le seed efface la base avant de la recharger. On refuse d'écrire si
// la base connectée n'est pas celle que le manifeste déclare pour ce graphe.
if (graphConfig.falkorGraph !== graphName) {
  throw new Error(`Refusing to seed: graph "${graphId}" declares ${graphConfig.falkorGraph} but the connection targets ${graphName}. Set FALKORDB_GRAPH accordingly.`);
}

const graph = await getGraph();
// Le seed reconstruit le design canonique sans effacer l'overlay runtime. Les
// HealthStatus et VerificationRun sont des observations vivantes, pas des MindNode.
try { await graph.query("MATCH (n:MindNode) WHERE coalesce(n.runtimeManaged, false) = false DETACH DELETE n"); } catch { /* graph may not exist */ }
await graph.query("CREATE INDEX FOR (n:MindNode) ON (n.id)").catch(() => {});

for (const node of allNodes) {
  const ontologyType = ontologyNodeTypes.get(node.nodeType) || ontologyNodeTypes.get(node.semanticType) || { label: node.nodeType, family: "physical_role", epistemicStatus: "documented" };
  const semanticType = node.semanticType || node.nodeType;
  const semanticOntologyType = ontologyNodeTypes.get(semanticType) || ontologyType;
  const epistemicStatus = node.epistemicStatus || semanticOntologyType.epistemicStatus || ontologyType.epistemicStatus || "documented";
  await graph.query(`CREATE (:MindNode {
    id:$id, name:$name, phrase:$phrase, phraseStatus:$phraseStatus, family:$family,
    region:$region, period:$period, startYear:$startYear, dateLabel:$dateLabel,
    nodeType:$nodeType, semanticType:$semanticType, status:$status, summary:$summary, sourceUrl:$sourceUrl,
    sourceTitle:$sourceTitle, forecastWindow:$forecastWindow,
    forecastConfidence:$forecastConfidence, forecastSignals:$forecastSignals,
    forecastAssumptions:$forecastAssumptions, forecastImpact:$forecastImpact,
    forecastResponse:$forecastResponse, hypothesisBasis:$hypothesisBasis,
    verificationNeeded:$verificationNeeded, questionCategory:$questionCategory,
    decisionNeeded:$decisionNeeded, decisionStatus:$decisionStatus,
    responsibleRole:$responsibleRole, decisionDue:$decisionDue,
    chosenOptionId:$chosenOptionId, decisionRationale:$decisionRationale,
    reviewDate:$reviewDate, closureEvidence:$closureEvidence,
    optionCriteria:$optionCriteria, optionCode:$optionCode,
    codeParameters:$codeParameters, evidenceRung:$evidenceRung, evidenceRungNote:$evidenceRungNote,
    optionBenefits:$optionBenefits, optionRisks:$optionRisks,
    optionConditions:$optionConditions, stateOrientation:$stateOrientation,
    stateDimension:$stateDimension, stateIndicator:$stateIndicator,
    clusterId:$clusterId, sourcePage:$sourcePage, documentSection:$documentSection,
    nodeTypeLabel:$nodeTypeLabel, semanticTypeLabel:$semanticTypeLabel, ontologyFamily:$ontologyFamily,
    epistemicStatus:$epistemicStatus, epistemicLabel:$epistemicLabel,
    contextId:$contextId, context:$context, definition:$definition,
    definitionStatus:$definitionStatus,
    populationOrSystem:$populationOrSystem,
    jurisdiction:$jurisdiction, validFrom:$validFrom, validTo:$validTo,
    metricId:$metricId, methodId:$methodId, baselineValue:$baselineValue,
    scenarioValue:$scenarioValue, probabilityPct:$probabilityPct,
    confidenceScore:$confidenceScore, effectSizePct:$effectSizePct,
    valenceScore:$valenceScore, humanValenceDelta:$humanValenceDelta,
    quantificationStatus:$quantificationStatus, supportingNodes:$supportingNodes,
    sourceRepository:$sourceRepository, sourcePath:$sourcePath, sourceHash:$sourceHash,
    sourceId:$sourceId, sourceLocator:$sourceLocator, authors:$authors,
    publicationYear:$publicationYear, arxivId:$arxivId, doi:$doi,
    studyDesign:$studyDesign, unit:$unit, estimateValue:$estimateValue,
    evidenceRole:$evidenceRole, certaintyStatus:$certaintyStatus,
    externalReferences:$externalReferences,
    sourceCommit:$sourceCommit, observedAt:$observedAt,
    evidenceType:$evidenceType, maturity:$maturity,
    ownerRole:$ownerRole, targetDate:$targetDate, responseStatus:$responseStatus,
    closureCriteria:$closureCriteria,
    testObjective:$testObjective, methodSummary:$methodSummary,
    metricIds:$metricIds, failureCondition:$failureCondition,
    minimumSample:$minimumSample,
    workStatus:$workStatus, priority:$priority, autonomyMode:$autonomyMode,
    acceptanceCriteria:$acceptanceCriteria, verificationCommand:$verificationCommand,
    probeIntervalSeconds:$probeIntervalSeconds,
    probeFreshnessSeconds:$probeFreshnessSeconds, probeTargetIds:$probeTargetIds,
    healthProofKind:$healthProofKind, healthProofDimension:$healthProofDimension,
    healthProofAutomation:$healthProofAutomation,
    healthProofSemanticTypes:$healthProofSemanticTypes,
	    healthDefaultVerificationCommand:$healthDefaultVerificationCommand,
	    healthProofContractId:$healthProofContractId,
	    content:$content, channel:$channel, sourceMessageId:$sourceMessageId,
	    occurredAt:$occurredAt, correspondsTo:$correspondsTo,
	    identityRef:$identityRef, citizenId:$citizenId, citizen:$citizen,
	    externalThreadId:$externalThreadId,
	    updatedAt:$updatedAt, completedAt:$completedAt, changeKind:$changeKind,
    changedPaths:$changedPaths,
    prohibitedPrefills:$prohibitedPrefills,
    importSourceKind:$importSourceKind,
    restrictedPredictionDomains:$restrictedPredictionDomains,
    schemaVersion:$schemaVersion
  })`, { params: {
    ...node,
    semanticType,
    nodeTypeLabel: ontologyType.label || node.nodeType,
    semanticTypeLabel: semanticOntologyType.label || semanticType,
    ontologyFamily: semanticOntologyType.family || ontologyType.family || "general",
    epistemicStatus,
    epistemicLabel: graphOntology.epistemicStatuses.find(status => status.id === epistemicStatus)?.label || epistemicStatus,
    schemaVersion: graphOntology.schemaVersion || "1.0.0"
  } });
}

for (const link of allLinks) {
  if (!activeRelationTypes.has(link.type)) throw new Error(`Unsupported relation: ${link.type}`);
  if (!nodeById.has(link.source) || !nodeById.has(link.target)) throw new Error(`Unknown endpoint: ${link.source} -> ${link.target}`);
  const ontologyRelation = ontologyRelationTypes.get(link.type);
  const hierarchyKind = link.hierarchyKind || (link.type === "CONVERGES_IN" ? "part_of"
    : nodeById.get(link.source)?.nodeType === "open_question" && link.type === "BLOCKS" ? "subcase_of" : "none");
  const hierarchyWeight = link.hierarchyWeight ?? (hierarchyKind === "part_of" ? 0.9 : hierarchyKind === "subcase_of" ? 0.82 : 0);
  const traversalWeight = link.traversalWeight ?? graphOntology.traversal.familyDefaults[ontologyRelation.family] ?? 0.5;
  await graph.query(`MATCH (a:MindNode {id:$source}), (b:MindNode {id:$target})
    MERGE (a)-[r:${link.type}]->(b)
    SET r = {
      relationQuality:$relationQuality, relationStory:$relationStory,
      relationLabel:$relationLabel, note:$note, justification:$justification,
      forecastEffect:$forecastEffect, forecastStrength:$forecastStrength,
      forecastPolarity:$forecastPolarity, forecastDelay:$forecastDelay,
      forecastDimensions:$forecastDimensions, forecastFeedback:$forecastFeedback,
      causalLogic:$causalLogic, causalCondition:$causalCondition, causalRisk:$causalRisk,
      contextId:$contextId, populationOrSystem:$populationOrSystem,
      validFrom:$validFrom, validTo:$validTo, methodId:$methodId, metricId:$metricId,
      relationFamily:$relationFamily, relationScope:$relationScope,
      causalClaim:$causalClaim, canonicalPredicate:$canonicalPredicate,
      quantificationStatus:$quantificationStatus, schemaVersion:$schemaVersion,
      effectSizePct:$effectSizePct, confidenceScore:$confidenceScore,
      evidenceBasis:$evidenceBasis,
      traversalWeight:$traversalWeight, hierarchyWeight:$hierarchyWeight,
      hierarchyKind:$hierarchyKind, sourceRepository:$sourceRepository,
      sourceCommit:$sourceCommit, observedAt:$observedAt, weight:$weight
    }`, { params: {
      ...link,
      relationFamily: ontologyRelation.family,
      relationScope: ontologyRelation.scope,
      causalClaim: ontologyRelation.causalClaim,
      canonicalPredicate: ontologyRelation.canonicalPredicate || link.type,
      quantificationStatus: link.quantificationStatus || "unquantified",
      schemaVersion: graphOntology.schemaVersion,
      traversalWeight, hierarchyWeight, hierarchyKind
    } });
}

console.log(`Seeded ${allNodes.length} Mind nodes and ${allLinks.length} causal relations into ${graphName}.`);
const client = await getClient();
client.close();
