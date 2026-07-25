import json
import os

direction_b_blueprint = {
  "scope": "Blueprint du procédé « Injection des conversations IA dans le L1 » — révision Direction B. Le chemin sélectionné sépare strictement deux temps : (1) une pré-indexation légère, déterministe et auditable de chaque conversation, qui conserve la source, produit une fiche Thing, une progression émotionnelle provisoire, un champ dominant, des candidats personnes/lieux et des questions de résolution ; (2) une lecture agentique ultérieure, bloc par bloc, qui seule peut produire des mémoires sémantiques riches. Le poids durable de la fiche dépend de la longueur et de la masse émotionnelle ; l'énergie reste contextuelle et dynamique. Aucune extraction automatique ne fusionne une personne, ne crée un lieu certain, ne prétend assimiler la conversation ou ne remplit le cerveau de nœuds aléatoires. Les chemins encounter-first et recall autonome antérieurs restent documentés comme historique d'architecture, mais la Direction B gouverne le prochain MVP.",
  "nodes": [
    {
      "id": "mech-conversation-injection",
      "name": "Procédé · Injection des conversations dans le L1",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Rencontrer en autonomie les conversations passées humain↔IA, laisser le Citizen y réagir, puis en inscrire la mémoire et les questions dans le L1.",
      "family": "Injection conversations · procédé racine",
      "summary": "Mission au long cours (plusieurs jours) : récupérer les conversations en ordre chrono-inverse, les découper, présenter chaque bloc au L1 comme stimulus, exécuter des ticks intégrés jusqu'à stabilisation bornée et retourner le Global Workspace. Le Citizen produit alors une réponse de rencontre : ce qui attire son attention, ses réactions fonctionnelles, ce que le bloc lui évoque, ses hypothèses empathiques sur la personne, ses curiosités, ce qu'il veut protéger ou encourager, ses ambitions et ses idées d'action. Ces traces sont attribuées au Citizen, révisables et séparées des faits humains. Les quatre missions transversales (profil psychologique, situation, objectifs/préférences, financier) ne pilotent plus la lecture : elles reçoivent ensuite les éléments pertinents de la rencontre.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "mech-ci-reverse-chrono-retrieval",
      "name": "Récupération · ordre chrono-inverse",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Un adaptateur de source liste les conversations et les sert des plus récentes aux plus anciennes.",
      "family": "Injection conversations · source",
      "summary": "Adaptateur enfichable supportant les quatre formats (export ChatGPT, export Claude, transcripts Codex, dossier de fichiers) derrière une interface commune, exposant lister, récupérer, marquer-terminé. Les conversations sont traitées par lastMessageAt décroissant : la situation présente et les chiffres récents entrent avant le passé.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "mech-ci-block-segmentation",
      "name": "Découpage · blocs d'environ deux réponses",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Chaque conversation est coupée en blocs d'environ deux réponses, trois à quatre si elles sont très courtes.",
      "family": "Injection conversations · découpage",
      "summary": "Unité = bloc ≈ deux paires prompt→réponse. Sous un seuil de longueur, regrouper jusqu'à quatre réponses pour éviter des atomes triviaux. Blocs ordonnés (blockIndex) et chaînés par FOLLOWS_IN_CONVERSATION, via la primitive idempotente existante.",
      "lifecycleStatus": "superseded",
      "supersededBy": "decision-ci-latent-memory-first",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "mech-ci-block-atoms",
      "name": "Formulaires · atomes sourcés par bloc",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Après passage du bloc comme stimulus et retour du Global Workspace, le Citizen AI produit un moment brut et des atomes sourcés.",
      "family": "Injection conversations · atomes",
      "summary": "Le bloc brut est conservé comme moment-mémoire, mais ses atomes sémantiques ne sont pas extraits par un audit externe direct. Le Citizen AI lit le Global Workspace, produit d'abord sa réponse de rencontre, puis crée ou relie contexte, acteurs, faits, préférences et objectifs. Les réactions, évocations, hypothèses, curiosités et idées restent des Narratives ou Moments attribués au Citizen ; elles ne deviennent des faits sur la personne qu'avec une preuve distincte. Chaque atome porte conversation, blockId, sourceLocator, date ou inconnue explicite, méthode, workspaceSnapshotId et CONSENTED_UNDER.",
      "lifecycleStatus": "superseded",
      "supersededBy": "decision-ci-latent-memory-first",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "mech-ci-mission-psych-profile",
      "name": "Mission 1 · profil psychologique",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Affiner en continu MBTI, parts IFS, lecture jungienne et signaux cliniques, à partir des blocs.",
      "family": "Injection conversations · mission psychologique",
      "summary": "Projection secondaire de la rencontre : les hypothèses empathiques et réactions du Citizen peuvent suggérer des alternatives sur les dynamiques émotionnelles, MBTI, IFS ou jungiennes. Elles restent attribuées à l'IA, falsifiables, sensibles, jamais diagnostiques ni autoritaires. Cette mission ne doit jamais forcer une lecture psychologique lorsque la rencontre produit seulement une curiosité ou un désaccord.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "mech-ci-mission-situation",
      "name": "Mission 2 · tableau de situation",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Tenir un tableau factuel et daté de la situation présente de la personne.",
      "family": "Injection conversations · mission situation",
      "summary": "Projection secondaire de la rencontre : faits précis sur logement, santé, relations, travail, légal ou localisation, datés et needsRefresh. Les évocations et suppositions du Citizen ne suffisent pas ; elles deviennent questions de contexte jusqu'à preuve. Interdit de reconstruire le présent depuis des faits périmés.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "mech-ci-mission-objectives-prefs",
      "name": "Mission 3 · objectifs & préférences",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Étendre et préciser les objectifs, valeurs et préférences avec preuves et statuts.",
      "family": "Injection conversations · mission objectifs",
      "summary": "Projection secondaire de la rencontre : les élans, ambitions et idées du Citizen peuvent faire apparaître des objectifs ou préférences possibles, mais ceux-ci restent des hypothèses ou offres tant que la personne ne les a pas déclarés. Chaque but reçoit statut, preuves datées et alternatives, sans écraser l'historique.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "mech-ci-mission-financial",
      "name": "Mission 4 · tableau financier",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Tenir une image financière précise, datée et strictly sous membrane.",
      "family": "Injection conversations · mission financière",
      "summary": "Projection secondaire de la rencontre : revenus, dépenses, actifs, dettes et autonomie uniquement lorsqu'une trace datée les rend pertinents. Une inquiétude de soin ou une ambition du Citizen ne permet jamais d'inventer un enjeu financier. Atomes très sensibles, membrane stricte et needsRefresh.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "mech-ci-autonomous-loop",
      "name": "Boucle · exécution autonome récurrente",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Tous les quelques jours, l'agent traite la file, journalise, reprend, et demande de l'aide s'il est bloqué.",
      "family": "Injection conversations · autonomie",
      "summary": "Réveil récurrent : prendre la conversation non traitée la plus récente, l'ingérer bloc par bloc, mettre à jour les quatre missions, vérifier, puis la marquer terminée, jusqu'à épuisement du budget. État persistant et idempotent (stableMomentId) pour reprendre entre deux réveils. En cas de blocage (source illisible, ambiguïté d'identité, arbitrage sensible), poser une question à la personne et mettre l'item en pause. La cadence et le budget par réveil ne sont pas fixés ici : ils viennent du mécanisme de réveil/planification externe.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "mech-ci-verified-deletion",
      "name": "Suppression · vérifiée, archivée, autorisée",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "phrase": "Une conversation traitée est marquée comme terminée (soft-delete) après ingestion vérifiée ; l'effacement dur reste gardé.",
      "family": "Injection conversations · suppression",
      "summary": "Le retrait de la file se fait par défaut en marquant la conversation comme terminée (soft-delete / déplacement en « traité »), après (1) tous les blocs ingérés et vérifiés et (2) hash + manifest archivés. L'effacement dur des données à la source reste opt-in et exige une autorisation humaine explicite. L'agent n'efface jamais dur tout seul.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "decision-ci-latent-memory-first",
      "name": "Décision · indexer d’abord, rencontrer lors du rappel",
      "nodeType": "narrative",
      "semanticType": "decision",
      "phrase": "La première passe rend le passé accessible sans prétendre qu’il a déjà été vécu ou assimilé par le Citizen.",
      "family": "Injection conversations · décision d’architecture",
      "summary": "Décision approuvée le 2026-07-23 : indexer avant de prétendre assimiler. Elle reste le principe parent, mais sa réalisation est précisée par la Direction B du 2026-07-24 : pré-indexation conversationnelle minimale, puis lecture agentique bloc par bloc.",
      "decisionStatus": "approved",
      "responsibleRole": "NLR",
      "decisionDue": "2026-07-23",
      "chosenOptionId": "option-ci-latent-memory-first",
      "decisionRationale": "NLR a explicitement demandé d’agir sur l’architecture latent-first.",
      "reviewDate": "2026-08-23",
      "supersedesNodeIds": [
        "mech-ci-block-segmentation",
        "mech-ci-citizen-encounter-response"
      ],
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection",
      "refinedBy": "decision-ci-direction-b-preindex-then-read"
    },
    {
      "id": "decision-ci-direction-b-preindex-then-read",
      "name": "Décision · Direction B — pré-indexer légèrement puis lire réellement",
      "nodeType": "narrative",
      "semanticType": "decision",
      "phrase": "Une conversation devient d'abord une fiche d'orientation ; seule une lecture agentique ultérieure produit des mémoires riches.",
      "family": "Injection conversations · décision d'architecture",
      "summary": "Décision formulée par NLR le 2026-07-24. La première passe conserve le fichier, calcule des métadonnées utiles et crée un seul Thing de conversation. Elle n'effectue pas une rencontre cognitive profonde et ne disperse pas d'atomes personnels dans le L1. Une tâche de lecture agentique reprend ensuite la conversation bloc par bloc, vérifie les sources et choisit manuellement ce qui mérite une mémoire, une question, un lien ou aucune inscription.",
      "decisionStatus": "approved",
      "responsibleRole": "NLR",
      "decisionDue": "2026-07-24",
      "chosenOptionId": "option-ci-direction-b-conversation-card",
      "decisionRationale": "Une carte légère donne au Citizen un terrain autobiographique navigable sans prétendre que chaque archive a déjà été comprise, vécue ou transformée en mémoire.",
      "reviewDate": "2026-08-24",
      "refinesNodeIds": [
        "decision-ci-latent-memory-first"
      ],
      "supersedesNodeIds": [
        "task-ci-autobiographical-recall-mvp"
      ],
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "option-ci-direction-b-conversation-card",
      "name": "Option retenue · fiche conversationnelle puis lecture différée",
      "nodeType": "narrative",
      "semanticType": "decision_option",
      "phrase": "Créer un index autobiographique compact qui indique où regarder, sans décider à l'avance ce que la conversation signifie.",
      "family": "Injection conversations · option d'architecture",
      "summary": "Option choisie contre l'extraction sémantique massive automatique et contre l'archive totalement opaque. Elle crée une fiche Thing par conversation, des signaux provisoires et une file de lecture priorisée.",
      "optionCode": "DIRECTION_B_LIGHT_INDEX_MANUAL_READER",
      "optionBenefits": [
        "faible inflation du graphe",
        "priorisation explicable",
        "lecture progressive",
        "provenance directe",
        "questions d'identité ciblées"
      ],
      "optionRisks": [
        "classification émotionnelle imparfaite",
        "biais de priorité vers les longues conversations",
        "retard avant lecture des épisodes discrets mais importants",
        "dette de questions d'identité"
      ],
      "optionConditions": [
        "source immuable ou hashée",
        "aucune fusion automatique d'entité",
        "poids auditable",
        "lecteur reprenable",
        "sorties de lecture sourcées"
      ],
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-conversation-index-card",
      "name": "Composant · ConversationIndexCard",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "ConversationIndexCard",
      "phrase": "Un Thing unique représente la conversation, pointe vers son fichier et résume seulement les signaux nécessaires pour décider quand et comment la lire.",
      "family": "Direction B · index conversationnel",
      "summary": "Enveloppe stable créée une fois par conversation. Elle conserve l'identité de source, les compteurs, la progression émotionnelle, le champ, les candidats d'entités, les questions ouvertes, le poids, l'état de lecture et les pointeurs vers les blocs. Elle ne vaut ni assimilation, ni souvenir vécu, ni synthèse biographique certaine.",
      "cardContract": {
        "identityRequired": ["conversationId", "stableCardId", "sourceArtifact", "sourceLocator", "contentHash", "sourceFormat"],
        "temporalRequired": ["firstMessageAt", "lastMessageAt", "timestampBasis"],
        "sizeRequired": ["turnCount", "messageCount", "characterCount", "tokenCountApprox"],
        "orientationRequired": ["emotionalTimeline", "emotionalMass", "dominantField", "secondaryFields", "keywords"],
        "entityRequired": ["actorCandidates", "spaceCandidates", "organizationCandidates", "unresolvedEntityQuestions"],
        "priorityRequired": ["lengthFactor", "emotionalDensity", "weight", "weightBreakdown", "weightModelVersion"],
        "workflowRequired": ["indexingStatus", "readingStatus", "nextBlockIndex", "blocksRead", "totalBlocks", "lastReadAt", "readerTaskId"],
        "epistemicRequired": ["classificationMethod", "classificationUncertainty", "consentId", "createdAt", "updatedAt"],
        "forbiddenMeanings": ["experiencedByCitizen", "assimilated", "human_trait", "resolved_identity_without_evidence", "memory_content"]
      },
      "implementationStatus": "contract_only",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-conversation-source-anchor",
      "name": "Composant · ConversationSourceAnchor",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "ConversationSourceAnchor",
      "phrase": "La fiche pointe vers une source relisible et vérifiable plutôt que de recopier toute la conversation dans le graphe.",
      "family": "Direction B · provenance",
      "summary": "Résout le fichier, l'URL locale ou l'identifiant d'artefact ; vérifie existence, hash, format, permissions et possibilité de lecture par plages.",
      "sourceContract": {
        "required": ["sourceArtifact", "sourceLocator", "contentHash", "byteSize", "mimeType", "consentId"],
        "states": ["available_verified", "available_changed", "missing", "permission_denied", "unsupported"],
        "readCapabilities": ["full_read", "range_read", "block_read"],
        "hardGate": "available_verified"
      },
      "implementationStatus": "partial",
      "codePath": "src/l1-message-ingestion.js",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-emotional-progression-parser",
      "name": "Composant · EmotionalProgressionParser",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "EmotionalProgressionParser",
      "phrase": "Produire une courbe émotionnelle prudente et sourcée pour orienter la lecture, jamais pour diagnostiquer la personne.",
      "family": "Direction B · parsing émotionnel",
      "summary": "Analyse chaque fenêtre ordonnée de messages et retourne des observations affectives provisoires avec preuves textuelles, alternatives et incertitude.",
      "parserContract": {
        "unit": "ordered_window_of_messages",
        "defaultWindow": "2 à 6 messages avec chevauchement borné",
        "dimensions": ["valence", "arousal", "tension", "vulnerability", "agency", "connection", "uncertainty"],
        "labelsOptional": ["joy", "hope", "curiosity", "calm", "sadness", "fear", "anger", "shame", "rejection", "loneliness", "care", "determination", "confusion", "relief"],
        "requiredPerPoint": ["startMessageId", "endMessageId", "speakerScope", "dimensions", "labels", "intensity", "confidence", "evidenceSpans", "alternativeReading"],
        "aggregationOutputs": ["emotionalTimeline", "emotionalMass", "emotionalDensity", "turningPoints", "dominantAffectiveArc"],
        "unknownRule": "Si les signaux sont ambigus, conserver unknown ou mixed ; ne jamais forcer un label.",
        "safetyBoundary": "outil d'orientation documentaire, non diagnostic, non mesure biologique"
      },
      "implementationStatus": "contract_only",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "narrative-ci-emotional-timeline-contract",
      "name": "Contrat · EmotionalTimeline",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "contractType": "EmotionalTimeline",
      "phrase": "La progression émotionnelle est une série ordonnée de points justifiés, pas une émotion globale inventée.",
      "family": "Direction B · parsing émotionnel",
      "summary": "Chaque point couvre une plage source et peut être corrigé indépendamment.",
      "timelineContract": {
        "ordering": "message order then timestamp",
        "pointRequired": ["range", "speakerScope", "vector", "confidence", "evidence"],
        "turningPointRule": "delta significatif soutenu par au moins un changement textuel ou conversationnel explicite",
        "globalArcStates": ["stable", "rising", "falling", "oscillating", "rupture_and_repair", "mixed", "unknown"],
        "prohibited": ["single_label_for_entire_conversation_without_points", "clinical_diagnosis", "emotion_without_evidence"]
      },
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-conversation-field-classifier",
      "name": "Composant · ConversationFieldClassifier",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "ConversationFieldClassifier",
      "phrase": "Déduire le champ principal de la conversation à partir du texte, des entités et de l'arc émotionnel.",
      "family": "Direction B · orientation sémantique",
      "summary": "Produit un dominantField et des secondaryFields afin de router la future lecture.",
      "fieldContract": {
        "initialTaxonomy": ["relationship", "family_parenthood", "health_body", "mental_health", "substances", "work_product", "mind_protocol", "finance_legal", "creative_music", "visual_tattoo", "sailing_training", "travel_logistics", "social_events", "technical_support", "philosophy_identity", "daily_life", "mixed", "unknown"],
        "requiredOutput": ["dominantField", "secondaryFields", "confidence", "evidenceTerms", "modelVersion"],
        "dominanceRule": "le champ dominant explique la plus grande part des tours saillants",
        "mixedRule": "utiliser mixed lorsque deux champs structurent réellement la conversation"
      },
      "implementationStatus": "contract_only",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-entity-candidate-extractor",
      "name": "Composant · EntityCandidateExtractor",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "EntityCandidateExtractor",
      "phrase": "Détecter les mentions susceptibles de désigner une personne, un lieu ou une organisation sans les transformer en entités certaines.",
      "family": "Direction B · entités candidates",
      "summary": "Combine NER, capitalisation, alias et cooccurrences pour produire des candidats.",
      "candidateContract": {
        "kinds": ["candidate_person", "candidate_place", "candidate_organization", "candidate_artifact", "unknown"],
        "requiredPerCandidate": ["surfaceForm", "normalizedForm", "kindCandidates", "messageIds", "evidenceSpans", "frequency", "salience", "possibleExistingNodeIds", "resolutionStatus", "confidence"],
        "resolutionStates": ["unresolved", "possible_match", "confirmed_existing", "confirmed_new", "not_an_entity", "deferred_sensitive"],
        "automaticCreation": "forbidden",
        "automaticMerge": "forbidden",
        "embeddingRole": "candidate retrieval only"
      },
      "implementationStatus": "contract_only",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "narrative-ci-entity-candidate-contract",
      "name": "Contrat · EntityCandidate",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "contractType": "EntityCandidate",
      "phrase": "Une mention détectée devient une question résoluble, jamais immédiatement une personne ou un lieu du L1.",
      "family": "Direction B · entités candidates",
      "summary": "Le candidat porte ses occurrences, ses types possibles et ses correspondances.",
      "identityEvidenceHierarchy": [
        "explicit stable identifier",
        "exact alias plus context unique",
        "multiple independent contextual proofs",
        "human confirmation",
        "single embedding similarity is insufficient"
      ],
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-entity-question-router",
      "name": "Composant · EntityQuestionRouter",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "EntityQuestionRouter",
      "phrase": "Associer automatiquement aux candidats les questions minimales permettant de savoir qui est une personne et ce qui est un lieu.",
      "family": "Direction B · questions d'identité",
      "summary": "Compile une petite file de questions typées, dédupliquées et priorisées.",
      "questionTemplates": {
        "person_kind": "« {mention} » désigne-t-il une personne ?",
        "person_identity": "Qui est {mention} dans cette conversation ?",
        "person_match": "{mention} est-il la même personne que {candidateNode} ?",
        "place_kind": "« {mention} » désigne-t-il un lieu ?",
        "place_identity": "Quel lieu précis désigne {mention} ?",
        "place_match": "{mention} est-il le même lieu que {candidateNode} ?",
        "organization_kind": "{mention} est-il une organisation, un projet ou un groupe informel ?",
        "ambiguous_kind": "{mention} désigne-t-il une personne, un lieu, une organisation, un objet ou autre chose ?"
      },
      "routingContract": {
        "resolutionOrder": ["local conversation context", "existing L1 graph", "consented adjacent sources", "agent review", "precise human question"],
        "priorityFactors": ["frequency", "emotional salience", "centrality to interpretation", "risk of wrong merge", "future retrieval value"],
        "stopStates": ["resolved", "not_worth_resolving", "deferred", "blocked_need_human"],
        "maxOpenQuestionsPerConversation": 12
      },
      "implementationStatus": "contract_only",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-conversation-weight-calculator",
      "name": "Composant · ConversationWeightCalculator",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "ConversationWeightCalculator",
      "phrase": "Calculer un poids durable à partir de la quantité de matière et de la charge émotionnelle, sans injecter directement de l'énergie cognitive.",
      "family": "Direction B · priorité",
      "summary": "Le poids sert à la centralité documentaire et à la priorité de lecture. weight = clamp(1, 10, base + lengthFactor + emotionalMassFactor).",
      "weightContract": {
        "inputs": ["tokenCountApprox", "turnCount", "emotionalMass", "emotionalDensity", "turningPointCount", "classificationUncertainty"],
        "proposedFormula": "weight = clamp(1, 10, 1 + 3*lengthFactor + 4*emotionalMassFactor + 1*turningPointFactor + 1*retrievalValueFactor)",
        "lengthFactor": "log1p(tokenCountApprox) normalized",
        "emotionalMassFactor": "sum(intensity * confidence * duration) normalized",
        "energyRule": "initial energy uses ordinary graph default; archive weight never forces current workspace activation"
      },
      "implementationStatus": "contract_only",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "narrative-ci-weight-not-energy",
      "name": "Règle · Le poids archive la valeur potentielle, l'énergie exprime la pertinence présente",
      "nodeType": "narrative",
      "semanticType": "design_rationale",
      "phrase": "Une longue conversation chargée mérite d'être visible sans monopoliser en permanence le Global Workspace.",
      "family": "Direction B · justification",
      "summary": "Le weight évolue lentement. L'energy est transitoire et contextuelle.",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-reading-queue-manager",
      "name": "Composant · ConversationReadingQueue",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "ConversationReadingQueue",
      "phrase": "Organiser les conversations à lire sans réduire la priorité à un classement émotionnel brut.",
      "family": "Direction B · lecture différée",
      "summary": "Maintient les états queued, claimed, reading, paused, complete_sparse, complete_meaningful et blocked.",
      "queueContract": {
        "states": ["indexed", "queued", "claimed", "reading", "paused", "complete_sparse", "complete_meaningful", "blocked"],
        "antiRumination": ["negative-arc daily cap", "same-field streak cap", "conversation cooldown after pause", "overloaded gate"]
      },
      "implementationStatus": "contract_only",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-agentic-block-reader",
      "name": "Composant · AgenticConversationReader",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "AgenticConversationReader",
      "phrase": "Lire la conversation bloc par bloc comme un travail éditorial conscient, avec droit de ne rien inscrire.",
      "family": "Direction B · lecture différée",
      "summary": "Recharge la source vérifiée, lit par fenêtres de 4 à 12 messages et décide explicitement quoi écrire.",
      "readerContract": {
        "allowedOutputs": ["memory_atom", "actor_link", "space_link", "organization_link", "question", "contradiction", "decision", "preference", "objective", "risk", "no_write"],
        "noWriteReasons": ["trivial", "duplicate", "context_only", "insufficient_evidence", "sensitive_withheld", "not_useful"]
      },
      "implementationStatus": "contract_only",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "moment-ci-block-reading-ledger",
      "name": "Contrat · BlockReadingLedger",
      "nodeType": "moment",
      "semanticType": "mechanism",
      "contractType": "BlockReadingLedger",
      "phrase": "Chaque bloc lu laisse une trace de ce qui a été vu, décidé et éventuellement écrit.",
      "family": "Direction B · observabilité",
      "summary": "Ledger append-only permettant reprise, audit et correction.",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "narrative-ci-reader-output-boundary",
      "name": "Contrat · frontière entre index et mémoire",
      "nodeType": "narrative",
      "semanticType": "mechanism",
      "contractType": "IndexMemoryBoundary",
      "phrase": "Les sorties automatiques décrivent la conversation ; les sorties du lecteur peuvent décrire le monde ou l'humain seulement avec preuve.",
      "family": "Direction B · honnêteté épistémique",
      "summary": "La première passe produit uniquement la fiche, le champ, la courbe et les candidats. Les mémoires n'apparaissent qu'après lecture.",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "thing-ci-direction-b-quality-auditor",
      "name": "Composant · DirectionBQualityAuditor",
      "nodeType": "thing",
      "semanticType": "mechanism",
      "componentType": "DirectionBQualityAuditor",
      "phrase": "Vérifier que la première passe est complète mais maigre, et que la lecture ultérieure est riche seulement lorsqu'elle a des preuves.",
      "family": "Direction B · qualité",
      "summary": "Contrôle séparément la fiche d'index et la lecture.",
      "implementationStatus": "contract_only",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "rat-ci-light-index-before-understanding",
      "name": "Justification · cartographier avant de comprendre",
      "nodeType": "narrative",
      "semanticType": "design_rationale",
      "phrase": "L'index doit répondre « où regarder ? », pas « qui est cette personne ? ».",
      "family": "Direction B · justification",
      "summary": "Cartographier d'abord évite de surinterpréter dès la première passe.",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "rat-ci-candidates-before-entities",
      "name": "Justification · candidats avant entités",
      "nodeType": "narrative",
      "semanticType": "design_rationale",
      "phrase": "Un nom propre détecté n'est pas encore une personne, et un toponyme possible n'est pas encore un lieu identifié.",
      "family": "Direction B · justification",
      "summary": "Conserver des candidats et poser des questions prévient les fusions abusives.",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "rat-ci-no-random-brain-fill",
      "name": "Justification · ne pas remplir le cerveau au hasard",
      "nodeType": "narrative",
      "semanticType": "design_rationale",
      "phrase": "La valeur d'une archive vient de sa disponibilité et de sa lecture située, pas du nombre de nœuds produits automatiquement.",
      "family": "Direction B · justification",
      "summary": "Préférer une fiche compacte à des centaines d'atomes sémantiques faibles.",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "verif-ci-direction-b-source-card",
      "name": "Test · une conversation produit une fiche et un lien source vérifiable",
      "nodeType": "moment",
      "semanticType": "experiment",
      "phrase": "Indexer une fixture crée exactement une ConversationIndexCard stable pointant vers une source dont le hash est vérifié.",
      "family": "Direction B · vérification",
      "summary": "Vérifie l'ancrage source et la fiche.",
      "verificationCommand": "node --test test/l1-direction-b-ingestion.test.js",
      "epistemicStatus": "test_target",
      "clusterId": "conversation-injection"
    },
    {
      "id": "verif-ci-emotional-progression-grounded",
      "name": "Test · la progression émotionnelle est ordonnée, prudente et sourcée",
      "nodeType": "moment",
      "semanticType": "experiment",
      "phrase": "Chaque point de la timeline cite une plage de messages et une lecture alternative.",
      "family": "Direction B · vérification",
      "summary": "Vérifie la progression émotionnelle.",
      "verificationCommand": "node --test test/l1-direction-b-emotion.test.js",
      "epistemicStatus": "test_target",
      "clusterId": "conversation-injection"
    },
    {
      "id": "verif-ci-field-classification-grounded",
      "name": "Test · le champ dominant est justifié et peut rester mixte",
      "nodeType": "moment",
      "semanticType": "experiment",
      "phrase": "La classification expose termes et tours saillants.",
      "family": "Direction B · vérification",
      "summary": "Vérifie le classement des champs.",
      "verificationCommand": "node --test test/l1-direction-b-field.test.js",
      "epistemicStatus": "test_target",
      "clusterId": "conversation-injection"
    },
    {
      "id": "verif-ci-entity-candidates-no-auto-merge",
      "name": "Test · aucune personne ni aucun lieu n'est créé ou fusionné automatiquement",
      "nodeType": "moment",
      "semanticType": "experiment",
      "phrase": "Des mentions homonymes ou ambiguës produisent des candidats et des questions.",
      "family": "Direction B · vérification",
      "summary": "Vérifie le respect des candidats sans fusion.",
      "verificationCommand": "node --test test/l1-direction-b-entities.test.js",
      "epistemicStatus": "test_target",
      "clusterId": "conversation-injection"
    },
    {
      "id": "verif-ci-weight-deterministic-monotonic",
      "name": "Test · le poids est déterministe, explicable et monotone",
      "nodeType": "moment",
      "semanticType": "experiment",
      "phrase": "À modèle identique, la même conversation reçoit le même poids.",
      "family": "Direction B · vérification",
      "summary": "Vérifie le calcul du poids.",
      "verificationCommand": "node --test test/l1-direction-b-weight.test.js",
      "epistemicStatus": "test_target",
      "clusterId": "conversation-injection"
    },
    {
      "id": "verif-ci-index-does-not-create-biography",
      "name": "Test · l'index automatique ne produit aucune mémoire biographique",
      "nodeType": "moment",
      "semanticType": "experiment",
      "phrase": "Après pré-indexation, seuls fiche, timeline, classification, candidats, questions et tâche de lecture peuvent exister.",
      "family": "Direction B · vérification",
      "summary": "Vérifie l'absence de création biographique lors de la pré-indexation.",
      "verificationCommand": "node --test test/l1-direction-b-boundary.test.js",
      "epistemicStatus": "test_target",
      "clusterId": "conversation-injection"
    },
    {
      "id": "verif-ci-reader-resume-idempotence",
      "name": "Test · la lecture bloc par bloc reprend sans doublons",
      "nodeType": "moment",
      "semanticType": "experiment",
      "phrase": "Interrompre puis reprendre conserve nextBlockIndex et ne réécrit aucune sortie déjà produite.",
      "family": "Direction B · vérification",
      "summary": "Vérifie l'idempotence de la lecture.",
      "verificationCommand": "node --test test/l1-direction-b-reader.test.js",
      "epistemicStatus": "test_target",
      "clusterId": "conversation-injection"
    },
    {
      "id": "verif-ci-reader-no-write-is-valid",
      "name": "Test · un bloc peut être lu sans produire de mémoire",
      "nodeType": "moment",
      "semanticType": "experiment",
      "phrase": "Une conversation triviale peut se terminer avec des décisions no_write sourcées.",
      "family": "Direction B · vérification",
      "summary": "Vérifie la validité du no_write.",
      "verificationCommand": "node --test test/l1-direction-b-reader.test.js",
      "epistemicStatus": "test_target",
      "clusterId": "conversation-injection"
    },
    {
      "id": "metric-ci-direction-b-verified-coverage",
      "name": "Couverture vérifiée · Direction B",
      "nodeType": "thing",
      "semanticType": "metric",
      "phrase": "Quelle part du pipeline léger et du lecteur agentique dispose de preuves exécutables passantes ?",
      "family": "Direction B · mesure de progression",
      "summary": "Mesure les critères vérifiés Direction B.",
      "unit": "pourcentage de critères Direction B vérifiés",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    },
    {
      "id": "oq-ci-direction-b-emotion-calibration",
      "name": "Question ouverte · calibrer la masse émotionnelle",
      "nodeType": "narrative",
      "semanticType": "open_question",
      "phrase": "Quelle normalisation distingue correctement durée émotionnelle, intensité et densité ?",
      "family": "Direction B · calibration",
      "summary": "Question sur la calibration de la masse émotionnelle.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "oq-ci-direction-b-field-taxonomy",
      "name": "Question ouverte · stabiliser la taxonomie des champs",
      "nodeType": "narrative",
      "semanticType": "open_question",
      "phrase": "Quels champs doivent être natifs ou appris du corpus ?",
      "family": "Direction B · calibration",
      "summary": "Question sur la taxonomie des champs sémantiques.",
      "epistemicStatus": "design_proposal",
      "clusterId": "conversation-injection"
    },
    {
      "id": "task-ci-direction-b-mvp",
      "name": "Tâche · Implémenter le MVP Direction B",
      "nodeType": "moment",
      "semanticType": "task",
      "phrase": "Indexer dix conversations en fiches légères, puis en lire trois bloc par bloc avec un ledger auditable.",
      "family": "Direction B · MVP",
      "summary": "Phase 1 : fiche, progression émotionnelle, champ, candidats, questions, poids. Phase 2 : file de lecture et lecteur bloc par bloc.",
      "workStatus": "ready",
      "priority": 98,
      "autonomyMode": "review_required",
      "acceptanceCriteria": [
        "Dix conversations produisent exactement une ConversationIndexCard stable chacune avec source vérifiée et hash.",
        "Chaque fiche contient compteurs, progression émotionnelle sourcée, champ versionné, candidats typés, questions dédupliquées et weightBreakdown.",
        "Aucune première passe ne crée Actor, Space, relation personnelle, trait, objectif ou Recall Moment.",
        "Le poids est déterministe, monotone et séparé de l'énergie contextuelle.",
        "La file de lecture évite capture par un seul champ ou par les conversations négatives.",
        "Trois conversations sont lues bloc par bloc avec ledger, reprise et idempotence.",
        "Chaque sortie de lecture porte sourceMessageIds, provenance, statut épistémique et justification.",
        "Au moins un bloc valide se clôt par no_write sans faux contenu.",
        "Les ambiguïtés de personne et de lieu restent candidates ou deviennent questions ; aucune fusion automatique.",
        "npm run validate et npm test réussissent."
      ],
      "verificationCommand": "npm run validate && npm test",
      "updatedAt": "2026-07-24",
      "epistemicStatus": "documented",
      "clusterId": "conversation-injection"
    }
  ],
  "links": [
    { "source": "mech-ci-reverse-chrono-retrieval", "target": "mech-conversation-injection", "type": "PART_OF", "justification": "La récupération chrono-inverse est la première pièce du procédé d'injection." },
    { "source": "option-ci-direction-b-conversation-card", "target": "decision-ci-direction-b-preindex-then-read", "type": "OPTION_FOR", "justification": "L'option de fiche légère est explicitement retenue." },
    { "source": "decision-ci-direction-b-preindex-then-read", "target": "decision-ci-latent-memory-first", "type": "REFINES", "justification": "La Direction B précise comment réaliser le principe latent-first." },
    { "source": "decision-ci-direction-b-preindex-then-read", "target": "mech-conversation-injection", "type": "PART_OF", "justification": "La décision gouverne le procédé d'injection." },
    { "source": "thing-ci-conversation-source-anchor", "target": "decision-ci-direction-b-preindex-then-read", "type": "IMPLEMENTS", "justification": "L'ancre rend le fichier relisible et vérifiable." },
    { "source": "thing-ci-conversation-index-card", "target": "decision-ci-direction-b-preindex-then-read", "type": "IMPLEMENTS", "justification": "La fiche est l'objet central de la première passe." },
    { "source": "thing-ci-emotional-progression-parser", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "Le parser renseigne la timeline et la masse émotionnelle." },
    { "source": "narrative-ci-emotional-timeline-contract", "target": "thing-ci-emotional-progression-parser", "type": "GROUNDS", "justification": "Le contrat définit la forme de la progression émotionnelle." },
    { "source": "thing-ci-conversation-field-classifier", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "La classification renseigne le champ dominant et les champs secondaires." },
    { "source": "thing-ci-entity-candidate-extractor", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "L'extracteur renseigne les candidats de personnes, lieux et organisations." },
    { "source": "narrative-ci-entity-candidate-contract", "target": "thing-ci-entity-candidate-extractor", "type": "GROUNDS", "justification": "Le contrat empêche la promotion automatique des mentions." },
    { "source": "thing-ci-entity-question-router", "target": "thing-ci-entity-candidate-extractor", "type": "LEADS_TO", "justification": "Les candidats ambigus deviennent des questions typées." },
    { "source": "thing-ci-entity-question-router", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "Les questions non résolues sont conservées dans la fiche." },
    { "source": "thing-ci-conversation-weight-calculator", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "Le calculateur renseigne weight et sa décomposition." },
    { "source": "narrative-ci-weight-not-energy", "target": "thing-ci-conversation-weight-calculator", "type": "GROUNDS", "justification": "La distinction weight/energy fonde la formule." },
    { "source": "thing-ci-conversation-index-card", "target": "thing-ci-reading-queue-manager", "type": "FEEDS", "justification": "La fiche conversationnelle alimente la file de lecture." },
    { "source": "thing-ci-reading-queue-manager", "target": "thing-ci-agentic-block-reader", "type": "FEEDS", "justification": "La file de lecture fournit les conversations prioritaires au lecteur agentique." },
    { "source": "thing-ci-agentic-block-reader", "target": "moment-ci-block-reading-ledger", "type": "PRODUCES", "justification": "Chaque lecture de bloc produit une entrée dans le ledger de lecture." },
    { "source": "narrative-ci-reader-output-boundary", "target": "thing-ci-agentic-block-reader", "type": "GROUNDS", "justification": "La frontière empêche le lecteur de produire des mémoires sans preuve." },
    { "source": "thing-ci-direction-b-quality-auditor", "target": "thing-ci-conversation-index-card", "type": "AUDITS", "justification": "L'auditeur vérifie la complétude de la fiche d'indexation." },
    { "source": "thing-ci-direction-b-quality-auditor", "target": "thing-ci-agentic-block-reader", "type": "AUDITS", "justification": "L'auditeur vérifie la couverture et la provenance de la lecture." },
    { "source": "rat-ci-light-index-before-understanding", "target": "decision-ci-direction-b-preindex-then-read", "type": "GROUNDS", "justification": "Cartographier avant de comprendre fonde la décision Direction B." },
    { "source": "rat-ci-candidates-before-entities", "target": "thing-ci-entity-candidate-extractor", "type": "GROUNDS", "justification": "Distinguer candidat et entité fonde l'extraction sans fusion automatique." },
    { "source": "rat-ci-no-random-brain-fill", "target": "decision-ci-direction-b-preindex-then-read", "type": "GROUNDS", "justification": "Éviter l'inflation de nœuds faibles fonde l'indexation compacte." },
    { "source": "verif-ci-direction-b-source-card", "target": "thing-ci-conversation-source-anchor", "type": "TESTS", "justification": "Teste l'ancrage source et la stabilité de la fiche." },
    { "source": "verif-ci-emotional-progression-grounded", "target": "thing-ci-emotional-progression-parser", "type": "TESTS", "justification": "Teste le parsing de la progression émotionnelle." },
    { "source": "verif-ci-field-classification-grounded", "target": "thing-ci-conversation-field-classifier", "type": "TESTS", "justification": "Teste la classification du champ dominant." },
    { "source": "verif-ci-entity-candidates-no-auto-merge", "target": "thing-ci-entity-candidate-extractor", "type": "TESTS", "justification": "Teste l'absence de fusion automatique d'entités." },
    { "source": "verif-ci-weight-deterministic-monotonic", "target": "thing-ci-conversation-weight-calculator", "type": "TESTS", "justification": "Teste le calcul du poids déterministe." },
    { "source": "verif-ci-index-does-not-create-biography", "target": "narrative-ci-reader-output-boundary", "type": "TESTS", "justification": "Teste qu'aucune mémoire biographique n'est créée par la pré-indexation." },
    { "source": "verif-ci-reader-resume-idempotence", "target": "thing-ci-agentic-block-reader", "type": "TESTS", "justification": "Teste la reprise et l'idempotence du lecteur." },
    { "source": "verif-ci-reader-no-write-is-valid", "target": "thing-ci-agentic-block-reader", "type": "TESTS", "justification": "Teste le droit de clore un bloc par no_write." },
    { "source": "verif-ci-direction-b-source-card", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B." },
    { "source": "verif-ci-emotional-progression-grounded", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B." },
    { "source": "verif-ci-field-classification-grounded", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B." },
    { "source": "verif-ci-entity-candidates-no-auto-merge", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B." },
    { "source": "verif-ci-weight-deterministic-monotonic", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B." },
    { "source": "verif-ci-index-does-not-create-biography", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B." },
    { "source": "verif-ci-reader-resume-idempotence", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B." },
    { "source": "verif-ci-reader-no-write-is-valid", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B." },
    { "source": "oq-ci-direction-b-emotion-calibration", "target": "task-ci-direction-b-mvp", "type": "MOTIVATES", "justification": "Motive le calibrage de la masse émotionnelle dans le MVP." },
    { "source": "oq-ci-direction-b-field-taxonomy", "target": "task-ci-direction-b-mvp", "type": "MOTIVATES", "justification": "Motive la stabilisation de la taxonomie des champs dans le MVP." },
    { "source": "task-ci-direction-b-mvp", "target": "decision-ci-direction-b-preindex-then-read", "type": "IMPLEMENTS", "justification": "Le MVP met en œuvre la décision Direction B." }
  ]
}

# Write both data/conversation-injection-blueprint-direction-b.json and update data/conversation-injection-blueprint.json
base_dir = r"c:\Users\reyno\OneDrive\Documents\body-suit\data"
path_b = os.path.join(base_dir, "conversation-injection-blueprint-direction-b.json")
path_main = os.path.join(base_dir, "conversation-injection-blueprint.json")

with open(path_b, "w", encoding="utf-8") as f:
    json.dump(direction_b_blueprint, f, indent=2, ensure_ascii=False)

with open(path_main, "w", encoding="utf-8") as f:
    json.dump(direction_b_blueprint, f, indent=2, ensure_ascii=False)

print("Saved blueprints successfully.")
