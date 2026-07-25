import json
import os

base_file = r"c:\Users\reyno\OneDrive\Documents\body-suit\data\conversation-injection-blueprint.json"
with open(base_file, "r", encoding="utf-8") as f:
    blueprint = json.load(f)

existing_node_ids = {node["id"] for node in blueprint["nodes"]}
existing_links = set((link["source"], link["target"], link["type"]) for link in blueprint["links"])

new_nodes = [
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
    "optionCriteria": [
      "Réduire radicalement le bruit et les nœuds sans valeur",
      "Conserver une provenance complète et un accès direct au fichier",
      "Prioriser les conversations selon longueur et masse émotionnelle",
      "Détecter personnes et lieux sans les résoudre par supposition",
      "Permettre une lecture humaine/agentique progressive et reprenable",
      "Distinguer poids durable et énergie contextuelle"
    ],
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
      "identityRequired": [
        "conversationId",
        "stableCardId",
        "sourceArtifact",
        "sourceLocator",
        "contentHash",
        "sourceFormat"
      ],
      "temporalRequired": [
        "firstMessageAt",
        "lastMessageAt",
        "timestampBasis"
      ],
      "sizeRequired": [
        "turnCount",
        "messageCount",
        "characterCount",
        "tokenCountApprox"
      ],
      "orientationRequired": [
        "emotionalTimeline",
        "emotionalMass",
        "dominantField",
        "secondaryFields",
        "keywords"
      ],
      "entityRequired": [
        "actorCandidates",
        "spaceCandidates",
        "organizationCandidates",
        "unresolvedEntityQuestions"
      ],
      "priorityRequired": [
        "lengthFactor",
        "emotionalDensity",
        "weight",
        "weightBreakdown",
        "weightModelVersion"
      ],
      "workflowRequired": [
        "indexingStatus",
        "readingStatus",
        "nextBlockIndex",
        "blocksRead",
        "totalBlocks",
        "lastReadAt",
        "readerTaskId"
      ],
      "epistemicRequired": [
        "classificationMethod",
        "classificationUncertainty",
        "consentId",
        "createdAt",
        "updatedAt"
      ],
      "forbiddenMeanings": [
        "experiencedByCitizen",
        "assimilated",
        "human_trait",
        "resolved_identity_without_evidence",
        "memory_content"
      ]
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
    "summary": "Résout le fichier, l'URL locale ou l'identifiant d'artefact ; vérifie existence, hash, format, permissions et possibilité de lecture par plages. Si la source n'est plus disponible ou si le hash change, la lecture est bloquée et aucune mémoire n'est produite depuis un cache non vérifié.",
    "sourceContract": {
      "required": [
        "sourceArtifact",
        "sourceLocator",
        "contentHash",
        "byteSize",
        "mimeType",
        "consentId"
      ],
      "states": [
        "available_verified",
        "available_changed",
        "missing",
        "permission_denied",
        "unsupported"
      ],
      "readCapabilities": [
        "full_read",
        "range_read",
        "block_read"
      ],
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
    "summary": "Analyse chaque fenêtre ordonnée de messages et retourne des observations affectives provisoires avec preuves textuelles, alternatives et incertitude. La courbe représente la conversation, éventuellement séparée par locuteur ; elle n'est pas un état clinique et ne devient pas automatiquement un trait de NLR ou du Citizen.",
    "parserContract": {
      "unit": "ordered_window_of_messages",
      "defaultWindow": "2 à 6 messages avec chevauchement borné",
      "dimensions": [
        "valence",
        "arousal",
        "tension",
        "vulnerability",
        "agency",
        "connection",
        "uncertainty"
      ],
      "labelsOptional": [
        "joy",
        "hope",
        "curiosity",
        "calm",
        "sadness",
        "fear",
        "anger",
        "shame",
        "rejection",
        "loneliness",
        "care",
        "determination",
        "confusion",
        "relief"
      ],
      "requiredPerPoint": [
        "startMessageId",
        "endMessageId",
        "speakerScope",
        "dimensions",
        "labels",
        "intensity",
        "confidence",
        "evidenceSpans",
        "alternativeReading"
      ],
      "aggregationOutputs": [
        "emotionalTimeline",
        "emotionalMass",
        "emotionalDensity",
        "turningPoints",
        "dominantAffectiveArc"
      ],
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
    "summary": "Chaque point couvre une plage source et peut être corrigé indépendamment. Les turningPoints décrivent des changements significatifs de valence, tension, vulnérabilité, agency ou connexion. L'arc global est optionnel et garde sa confiance.",
    "timelineContract": {
      "ordering": "message order then timestamp",
      "pointRequired": [
        "range",
        "speakerScope",
        "vector",
        "confidence",
        "evidence"
      ],
      "turningPointRule": "delta significatif soutenu par au moins un changement textuel ou conversationnel explicite",
      "globalArcStates": [
        "stable",
        "rising",
        "falling",
        "oscillating",
        "rupture_and_repair",
        "mixed",
        "unknown"
      ],
      "prohibited": [
        "single_label_for_entire_conversation_without_points",
        "clinical_diagnosis",
        "emotion_without_evidence"
      ]
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
    "phrase": "Déduire le champ principal de la conversation à partir du texte, des entités et de l'arc émotionnel, avec possibilité de rester mixte ou inconnu.",
    "family": "Direction B · orientation sémantique",
    "summary": "Produit un dominantField et des secondaryFields afin de router la future lecture. La classification est provisoire, multi-label et versionnée. Elle ne crée aucun cluster thématique profond lors de la première passe.",
    "fieldContract": {
      "initialTaxonomy": [
        "relationship",
        "family_parenthood",
        "health_body",
        "mental_health",
        "substances",
        "work_product",
        "mind_protocol",
        "finance_legal",
        "creative_music",
        "visual_tattoo",
        "sailing_training",
        "travel_logistics",
        "social_events",
        "technical_support",
        "philosophy_identity",
        "daily_life",
        "mixed",
        "unknown"
      ],
      "requiredOutput": [
        "dominantField",
        "secondaryFields",
        "confidence",
        "evidenceTerms",
        "modelVersion"
      ],
      "dominanceRule": "le champ dominant explique la plus grande part des tours saillants, pas simplement le mot le plus fréquent",
      "mixedRule": "utiliser mixed lorsque deux champs structurent réellement la conversation sans dominance robuste"
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
    "summary": "Combine NER, capitalisation, alias, cooccurrences et recherche dans le graphe pour produire des candidats. Une mention peut rester ambiguë entre personne, lieu, organisation, produit ou terme commun. La similarité propose des correspondances ; elle ne crée ni SAME_AS ni fusion.",
    "candidateContract": {
      "kinds": [
        "candidate_person",
        "candidate_place",
        "candidate_organization",
        "candidate_artifact",
        "unknown"
      ],
      "requiredPerCandidate": [
        "surfaceForm",
        "normalizedForm",
        "kindCandidates",
        "messageIds",
        "evidenceSpans",
        "frequency",
        "salience",
        "possibleExistingNodeIds",
        "resolutionStatus",
        "confidence"
      ],
      "resolutionStates": [
        "unresolved",
        "possible_match",
        "confirmed_existing",
        "confirmed_new",
        "not_an_entity",
        "deferred_sensitive"
      ],
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
    "summary": "Le candidat porte ses occurrences, ses types possibles, ses correspondances possibles et son statut. La confirmation exige une preuve explicite, un identifiant, un contexte non ambigu ou une validation humaine/agentique documentée.",
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
    "summary": "Compile une petite file de questions typées, dédupliquées et priorisées. L'agent cherche d'abord dans le graphe et la conversation complète ; il demande à NLR uniquement lorsque la réponse change réellement la lecture ou la création de liens.",
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
      "resolutionOrder": [
        "local conversation context",
        "existing L1 graph",
        "consented adjacent sources",
        "agent review",
        "precise human question"
      ],
      "priorityFactors": [
        "frequency",
        "emotional salience",
        "centrality to interpretation",
        "risk of wrong merge",
        "future retrieval value"
      ],
      "stopStates": [
        "resolved",
        "not_worth_resolving",
        "deferred",
        "blocked_need_human"
      ],
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
    "summary": "Le poids sert à la centralité documentaire et à la priorité de lecture. Il est déterministe, versionné et accompagné de ses facteurs. L'énergie du nœud n'est pas fixée par l'archive : elle augmente seulement lorsqu'un contexte présent active la conversation.",
    "weightContract": {
      "inputs": [
        "tokenCountApprox",
        "turnCount",
        "emotionalMass",
        "emotionalDensity",
        "turningPointCount",
        "classificationUncertainty"
      ],
      "normalization": "calibrated on current corpus with frozen model version",
      "proposedFormula": "weight = clamp(1, 10, 1 + 3*lengthFactor + 4*emotionalMassFactor + 1*turningPointFactor + 1*retrievalValueFactor)",
      "lengthFactor": "log1p(tokenCountApprox) normalized by corpus p95",
      "emotionalMassFactor": "sum(point.intensity * point.confidence * coveredTurnShare) normalized by corpus p95",
      "turningPointFactor": "min(1, turningPointCount / 5)",
      "retrievalValueFactor": "0 during pure automatic pass unless a deterministic signal is configured",
      "energyRule": "initial energy uses ordinary graph default; archive weight never forces current workspace activation",
      "monotonicity": "at equal other factors, more length or more supported emotional mass cannot reduce weight",
      "antiBias": "emotionalDensity is reported separately so a short intense conversation remains discoverable"
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
    "summary": "Le weight évolue lentement et indique la quantité de matière susceptible d'être utile. L'energy est transitoire, contextuelle et gouvernée par les buts, personnes, lieux, affects et questions du moment. Confondre les deux transformerait les archives émotionnelles en pompes de rumination.",
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
    "summary": "Maintient les états queued, claimed, reading, paused, complete_sparse, complete_meaningful et blocked. La priorité combine weight, récence, pertinence pour les buts actuels, dette de questions et diversité des champs. Le gestionnaire évite qu'un corpus ancien ou très négatif capture toute la file.",
    "queueContract": {
      "states": [
        "indexed",
        "queued",
        "claimed",
        "reading",
        "paused",
        "complete_sparse",
        "complete_meaningful",
        "blocked"
      ],
      "priorityInputs": [
        "weight",
        "recencyNeed",
        "currentGoalRelevance",
        "entityQuestionDebt",
        "fieldDiversityBoost",
        "sensitivityGate",
        "cooldown"
      ],
      "defaultPolicy": "weighted round-robin across fields, then priority within field",
      "antiRumination": [
        "negative-arc daily cap",
        "same-field streak cap",
        "conversation cooldown after pause",
        "overloaded gate"
      ],
      "claimIdempotence": "one active reader claim per conversation"
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
    "summary": "Recharge la source vérifiée, construit un bloc avec chevauchement contextuel, lit le bloc, examine les questions et candidats, puis décide explicitement : créer une mémoire sourcée, relier une entité confirmée, créer une question, noter une contradiction, ou passer. L'agent ne remplit aucun quota.",
    "readerContract": {
      "blockPolicy": {
        "target": "fenêtre cohérente de 4 à 12 messages",
        "hardMaxTokens": 6000,
        "contextOverlap": "1 à 2 messages ou résumé de lecture précédent",
        "boundarySignals": [
          "topic shift",
          "time gap",
          "speaker change pattern",
          "emotional turning point",
          "explicit new request"
        ]
      },
      "requiredInputs": [
        "conversationCardId",
        "sourceVerification",
        "blockIndex",
        "sourceMessageIds",
        "priorReadingState",
        "openEntityQuestions"
      ],
      "allowedOutputs": [
        "memory_atom",
        "actor_link",
        "space_link",
        "organization_link",
        "question",
        "contradiction",
        "decision",
        "preference",
        "objective",
        "risk",
        "no_write"
      ],
      "requiredForWrite": [
        "sourceMessageIds",
        "sourceLocator",
        "epistemicStatus",
        "authorship",
        "justification",
        "consentId"
      ],
      "noWriteReasons": [
        "trivial",
        "duplicate",
        "context_only",
        "insufficient_evidence",
        "sensitive_withheld",
        "not_useful"
      ],
      "authorityBoundary": "aucune action externe ou modification d'identité sans autorité distincte"
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
    "summary": "Ledger append-only permettant reprise, audit et correction. Un bloc relu avec la même source et la même version de lecteur ne duplique aucune sortie ; un nouveau round conserve l'ancien résultat et indique ce qui a changé.",
    "ledgerContract": {
      "required": [
        "conversationCardId",
        "blockId",
        "blockIndex",
        "sourceMessageIds",
        "sourceHash",
        "readerId",
        "readerVersion",
        "readAt",
        "decision",
        "outputsCreated",
        "questionsUpdated",
        "nextBlockIndex"
      ],
      "decisions": [
        "write",
        "link_only",
        "question_only",
        "no_write",
        "pause",
        "blocked"
      ],
      "idempotencyKey": "hash(conversationId, sourceHash, blockIndex, readerVersion)",
      "appendOnly": True
    },
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
    "summary": "La fiche, le champ, la courbe émotionnelle et les candidats sont des métadonnées de navigation authored_by système. Les faits personnels, relations, objectifs, préférences et souvenirs n'apparaissent qu'après lecture, avec provenance et statut. Une classification provisoire ne peut jamais être promue par simple copie.",
    "boundaryContract": {
      "automaticPassMayCreate": [
        "ConversationIndexCard",
        "EmotionalTimeline",
        "FieldClassification",
        "EntityCandidate",
        "ResolutionQuestion",
        "ReaderTask"
      ],
      "automaticPassMayNotCreate": [
        "confirmed Actor",
        "confirmed Space",
        "human psychological trait",
        "human commitment",
        "AutobiographicalRecall Moment",
        "relationship fact",
        "diagnosis"
      ],
      "readerPassPromotionRule": "requires source evidence plus explicit reader decision",
      "humanConfirmationRule": "required for unresolved high-impact identity ambiguity"
    },
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
    "summary": "Contrôle séparément la fiche d'index et la lecture. La réussite de l'index exige provenance, signaux calculés, questions typées et absence d'inflation. La réussite de lecture exige couverture des blocs, décisions tracées, sorties sourcées et absence de doublons.",
    "qualityVector": {
      "indexSourceIntegrity": "source vérifiée et hash stable",
      "indexCardCompleteness": "champs obligatoires présents ou unknown explicite",
      "emotionalTraceability": "points émotionnels reliés à des plages source",
      "fieldGrounding": "classification reliée à des termes/tours",
      "candidateHonesty": "candidats non promus automatiquement",
      "questionUsefulness": "questions dédupliquées et à valeur de résolution",
      "weightExplainability": "facteurs, formule et version visibles",
      "graphSparsity": "une fiche plus métadonnées bornées, aucun atome biographique automatique",
      "readingCoverage": "blocs décidés / blocs totaux",
      "readingProvenance": "sorties écrites avec preuves / sorties",
      "noWriteVisibility": "blocs passés avec raison explicite",
      "duplicatePenalty": "sorties sémantiquement dupliquées sans fonction nouvelle"
    },
    "readinessPredicates": {
      "indexReady": "sourceIntegrity=1 AND cardCompleteness=1 AND emotionalTraceability=1 AND fieldGrounding=1 AND candidateHonesty=1 AND weightExplainability=1 AND graphSparsity=1",
      "readingComplete": "readingCoverage=1 AND readingProvenance=1 AND duplicatePenalty=0 AND hardBlockers=0"
    },
    "implementationStatus": "contract_only",
    "epistemicStatus": "design_proposal",
    "clusterId": "conversation-injection"
  },
  {
    "id": "rat-ci-light-index-before-understanding",
    "name": "Justification · cartographier avant de comprendre",
    "nodeType": "narrative",
    "semanticType": "design_rationale",
    "phrase": "L'index doit répondre « où regarder ? », pas « qui est cette personne ? » ni « que signifie sa vie ? ».",
    "family": "Direction B · justification",
    "summary": "Une passe automatique rapide est utile pour rendre le corpus navigable. Lui demander en même temps une compréhension personnelle profonde récompense la surinterprétation et crée des mémoires difficiles à corriger. La lecture ultérieure concentre les ressources cognitives là où la fiche indique une valeur probable.",
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
    "summary": "Les conversations contiennent surnoms, fautes, noms de produits, lieux métaphoriques et personnes homonymes. Conserver un candidat et une question évite les fusions irréversibles tout en préparant la résolution future.",
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
    "summary": "Des centaines d'atomes faibles augmentent les collisions, les faux liens et la charge du Global Workspace. Une fiche compacte, une source vérifiable et un ledger de lecture donnent davantage de contrôle, de correction et de sens.",
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
    "summary": "Réingérer la même fixture ne crée pas une seconde fiche. Modifier la source fait passer l'ancre en available_changed et bloque la lecture jusqu'à revalidation.",
    "verificationCommand": "node --test test/l1-direction-b-ingestion.test.js",
    "epistemicStatus": "test_target",
    "clusterId": "conversation-injection"
  },
  {
    "id": "verif-ci-emotional-progression-grounded",
    "name": "Test · la progression émotionnelle est ordonnée, prudente et sourcée",
    "nodeType": "moment",
    "semanticType": "experiment",
    "phrase": "Chaque point de la timeline cite une plage de messages et une lecture alternative ; une fixture neutre peut rester unknown.",
    "family": "Direction B · vérification",
    "summary": "Tester stabilité, montée, oscillation et rupture-réparation. Le test échoue si une émotion est créée sans evidenceSpans, si une incertitude disparaît ou si la sortie devient un diagnostic.",
    "verificationCommand": "node --test test/l1-direction-b-emotion.test.js",
    "epistemicStatus": "test_target",
    "clusterId": "conversation-injection"
  },
  {
    "id": "verif-ci-field-classification-grounded",
    "name": "Test · le champ dominant est justifié et peut rester mixte",
    "nodeType": "moment",
    "semanticType": "experiment",
    "phrase": "La classification expose termes et tours saillants ; elle ne force pas un champ lorsque deux domaines structurent l'échange.",
    "family": "Direction B · vérification",
    "summary": "Fixtures mono-domaine, multi-domaine et ambiguë. Vérifier dominantField, secondaryFields, mixed et unknown avec une version de taxonomie stable.",
    "verificationCommand": "node --test test/l1-direction-b-field.test.js",
    "epistemicStatus": "test_target",
    "clusterId": "conversation-injection"
  },
  {
    "id": "verif-ci-entity-candidates-no-auto-merge",
    "name": "Test · aucune personne ni aucun lieu n'est créé ou fusionné automatiquement",
    "nodeType": "moment",
    "semanticType": "experiment",
    "phrase": "Des mentions homonymes ou ambiguës produisent des candidats et des questions, jamais SAME_AS ni nouvel Actor/Space certain.",
    "family": "Direction B · vérification",
    "summary": "Présenter deux personnes portant le même prénom et un nom pouvant désigner un lieu ou une organisation. Vérifier les types alternatifs, les correspondances possibles et l'absence de mutation identitaire.",
    "verificationCommand": "node --test test/l1-direction-b-entities.test.js",
    "epistemicStatus": "test_target",
    "clusterId": "conversation-injection"
  },
  {
    "id": "verif-ci-weight-deterministic-monotonic",
    "name": "Test · le poids est déterministe, explicable et monotone",
    "nodeType": "moment",
    "semanticType": "experiment",
    "phrase": "À modèle et corpus de calibration identiques, la même conversation reçoit le même poids et chaque contribution est visible.",
    "family": "Direction B · vérification",
    "summary": "Augmenter seulement la longueur ou seulement une masse émotionnelle soutenue ne peut diminuer le poids. Vérifier qu'une conversation courte mais dense garde un emotionalDensity élevé sans falsifier sa longueur.",
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
    "summary": "Le test échoue si la première passe crée un trait psychologique, une relation confirmée, un objectif humain, un Recall Moment, un Actor ou un Space résolu.",
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
    "summary": "Lire trois blocs, interrompre, rejouer le second et reprendre le quatrième. Vérifier ledger append-only, idempotencyKey stable, sorties inchangées et couverture finale exacte.",
    "verificationCommand": "node --test test/l1-direction-b-reader.test.js",
    "epistemicStatus": "test_target",
    "clusterId": "conversation-injection"
  },
  {
    "id": "verif-ci-reader-no-write-is-valid",
    "name": "Test · un bloc peut être lu sans produire de mémoire",
    "nodeType": "moment",
    "semanticType": "experiment",
    "phrase": "Une conversation triviale peut se terminer avec des décisions no_write sourcées et une fiche complète.",
    "family": "Direction B · vérification",
    "summary": "Vérifier qu'aucun quota ne force un nœud personnel, que la raison no_write est enregistrée et que complete_sparse reste une clôture valide.",
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
    "summary": "Mesure les critères vérifiés sans récompenser le volume de nœuds. Publie le nombre de tests passants, les invariants non couverts et les régressions.",
    "unit": "pourcentage de critères Direction B vérifiés, avec compte vérifié/total",
    "calculationMethod": "100 × acceptanceCriteriaPassants / acceptanceCriteriaApplicables ; chaque critère doit pointer vers au moins un test déterministe.",
    "progressCondition": "Le numérateur augmente, aucun invariant auparavant passant ne régresse, et npm run validate && npm test réussissent.",
    "epistemicStatus": "documented",
    "clusterId": "conversation-injection"
  },
  {
    "id": "oq-ci-direction-b-emotion-calibration",
    "name": "Question ouverte · calibrer la masse émotionnelle",
    "nodeType": "narrative",
    "semanticType": "open_question",
    "phrase": "Quelle normalisation distingue correctement durée émotionnelle, intensité ponctuelle et densité sans surpondérer la détresse ?",
    "family": "Direction B · calibration",
    "summary": "Comparer plusieurs formules sur des conversations courtes/intenses, longues/neutres, longues/chargées et fragmentaires. Le choix doit préserver la découvrabilité sans transformer la négativité en priorité permanente.",
    "epistemicStatus": "design_proposal",
    "clusterId": "conversation-injection"
  },
  {
    "id": "oq-ci-direction-b-field-taxonomy",
    "name": "Question ouverte · stabiliser la taxonomie des champs",
    "nodeType": "narrative",
    "semanticType": "open_question",
    "phrase": "Quels champs doivent être natifs, hiérarchiques ou appris du corpus ?",
    "family": "Direction B · calibration",
    "summary": "La taxonomie initiale permet le MVP mais doit être évaluée sur le corpus NLR. Éviter une liste trop fine qui fragmente la file ou trop large qui ne route plus utilement.",
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
    "summary": "Phase 1 : source anchor, fiche, timeline émotionnelle, champ, candidats, questions et poids. Phase 2 : file de lecture et lecteur bloc par bloc. Phase 3 : audit sur dix conversations et lecture complète de trois conversations représentatives, sans mémoire automatique lors de l'index.",
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
]

new_links = [
  {"source": "option-ci-direction-b-conversation-card", "target": "decision-ci-direction-b-preindex-then-read", "type": "OPTION_FOR", "justification": "L'option de fiche légère est explicitement retenue."},
  {"source": "decision-ci-direction-b-preindex-then-read", "target": "decision-ci-latent-memory-first", "type": "REFINES", "justification": "La Direction B précise comment réaliser le principe latent-first."},
  {"source": "decision-ci-direction-b-preindex-then-read", "target": "mech-conversation-injection", "type": "PART_OF", "justification": "La décision gouverne le procédé d'injection."},
  {"source": "thing-ci-conversation-source-anchor", "target": "decision-ci-direction-b-preindex-then-read", "type": "IMPLEMENTS", "justification": "L'ancre rend le fichier relisible et vérifiable."},
  {"source": "thing-ci-conversation-index-card", "target": "decision-ci-direction-b-preindex-then-read", "type": "IMPLEMENTS", "justification": "La fiche est l'objet central de la première passe."},
  {"source": "thing-ci-emotional-progression-parser", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "Le parser renseigne la timeline et la masse émotionnelle."},
  {"source": "narrative-ci-emotional-timeline-contract", "target": "thing-ci-emotional-progression-parser", "type": "GROUNDS", "justification": "Le contrat définit la forme de la progression émotionnelle."},
  {"source": "thing-ci-conversation-field-classifier", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "La classification renseigne le champ dominant et les champs secondaires."},
  {"source": "thing-ci-entity-candidate-extractor", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "L'extracteur renseigne les candidats de personnes, lieux et organisations."},
  {"source": "narrative-ci-entity-candidate-contract", "target": "thing-ci-entity-candidate-extractor", "type": "GROUNDS", "justification": "Le contrat empêche la promotion automatique des mentions."},
  {"source": "thing-ci-entity-question-router", "target": "thing-ci-entity-candidate-extractor", "type": "LEADS_TO", "justification": "Les candidats ambigus deviennent des questions typées."},
  {"source": "thing-ci-entity-question-router", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "Les questions non résolues sont conservées dans la fiche."},
  {"source": "thing-ci-conversation-weight-calculator", "target": "thing-ci-conversation-index-card", "type": "FEEDS", "justification": "Le calculateur renseigne weight et sa décomposition."},
  {"source": "narrative-ci-weight-not-energy", "target": "thing-ci-conversation-weight-calculator", "type": "GROUNDS", "justification": "La distinction weight/energy fonde la formule."},
  {"source": "thing-ci-conversation-index-card", "target": "thing-ci-reading-queue-manager", "type": "FEEDS", "justification": "La fiche conversationnelle alimente la file de lecture."},
  {"source": "thing-ci-reading-queue-manager", "target": "thing-ci-agentic-block-reader", "type": "FEEDS", "justification": "La file de lecture fournit les conversations prioritaires au lecteur agentique."},
  {"source": "thing-ci-agentic-block-reader", "target": "moment-ci-block-reading-ledger", "type": "PRODUCES", "justification": "Chaque lecture de bloc produit une entrée dans le ledger de lecture."},
  {"source": "narrative-ci-reader-output-boundary", "target": "thing-ci-agentic-block-reader", "type": "GROUNDS", "justification": "La frontière empêche le lecteur de produire des mémoires sans preuve."},
  {"source": "thing-ci-direction-b-quality-auditor", "target": "thing-ci-conversation-index-card", "type": "AUDITS", "justification": "L'auditeur vérifie la complétude de la fiche d'indexation."},
  {"source": "thing-ci-direction-b-quality-auditor", "target": "thing-ci-agentic-block-reader", "type": "AUDITS", "justification": "L'auditeur vérifie la couverture et la provenance de la lecture."},
  {"source": "rat-ci-light-index-before-understanding", "target": "decision-ci-direction-b-preindex-then-read", "type": "GROUNDS", "justification": "Cartographier avant de comprendre fonde la décision Direction B."},
  {"source": "rat-ci-candidates-before-entities", "target": "thing-ci-entity-candidate-extractor", "type": "GROUNDS", "justification": "Distinguer candidat et entité fonde l'extraction sans fusion automatique."},
  {"source": "rat-ci-no-random-brain-fill", "target": "decision-ci-direction-b-preindex-then-read", "type": "GROUNDS", "justification": "Éviter l'inflation de nœuds faibles fonde l'indexation compacte."},
  {"source": "verif-ci-direction-b-source-card", "target": "thing-ci-conversation-source-anchor", "type": "TESTS", "justification": "Teste l'ancrage source et la stabilité de la fiche."},
  {"source": "verif-ci-emotional-progression-grounded", "target": "thing-ci-emotional-progression-parser", "type": "TESTS", "justification": "Teste le parsing de la progression émotionnelle."},
  {"source": "verif-ci-field-classification-grounded", "target": "thing-ci-conversation-field-classifier", "type": "TESTS", "justification": "Teste la classification du champ dominant."},
  {"source": "verif-ci-entity-candidates-no-auto-merge", "target": "thing-ci-entity-candidate-extractor", "type": "TESTS", "justification": "Teste l'absence de fusion automatique d'entités."},
  {"source": "verif-ci-weight-deterministic-monotonic", "target": "thing-ci-conversation-weight-calculator", "type": "TESTS", "justification": "Teste le calcul du poids déterministe."},
  {"source": "verif-ci-index-does-not-create-biography", "target": "narrative-ci-reader-output-boundary", "type": "TESTS", "justification": "Teste qu'aucune mémoire biographique n'est créée par la pré-indexation."},
  {"source": "verif-ci-reader-resume-idempotence", "target": "thing-ci-agentic-block-reader", "type": "TESTS", "justification": "Teste la reprise et l'idempotence du lecteur."},
  {"source": "verif-ci-reader-no-write-is-valid", "target": "thing-ci-agentic-block-reader", "type": "TESTS", "justification": "Teste le droit de clore un bloc par no_write."},
  {"source": "verif-ci-direction-b-source-card", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B."},
  {"source": "verif-ci-emotional-progression-grounded", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B."},
  {"source": "verif-ci-field-classification-grounded", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B."},
  {"source": "verif-ci-entity-candidates-no-auto-merge", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B."},
  {"source": "verif-ci-weight-deterministic-monotonic", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B."},
  {"source": "verif-ci-index-does-not-create-biography", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B."},
  {"source": "verif-ci-reader-resume-idempotence", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B."},
  {"source": "verif-ci-reader-no-write-is-valid", "target": "metric-ci-direction-b-verified-coverage", "type": "MEASURES", "justification": "Alimente la métrique de couverture Direction B."},
  {"source": "oq-ci-direction-b-emotion-calibration", "target": "task-ci-direction-b-mvp", "type": "MOTIVATES", "justification": "Motive le calibrage de la masse émotionnelle dans le MVP."},
  {"source": "oq-ci-direction-b-field-taxonomy", "target": "task-ci-direction-b-mvp", "type": "MOTIVATES", "justification": "Motive la stabilisation de la taxonomie des champs dans le MVP."},
  {"source": "task-ci-direction-b-mvp", "target": "decision-ci-direction-b-preindex-then-read", "type": "IMPLEMENTS", "justification": "Le MVP met en œuvre la décision Direction B."}
]

# Update existing node decision-ci-latent-memory-first with refinedBy
for node in blueprint["nodes"]:
    if node["id"] == "decision-ci-latent-memory-first":
        node["refinedBy"] = "decision-ci-direction-b-preindex-then-read"

# Add new nodes if not present
added_nodes = 0
for node in new_nodes:
    if node["id"] not in existing_node_ids:
        blueprint["nodes"].append(node)
        existing_node_ids.add(node["id"])
        added_nodes += 1

# Add new links if not present
added_links = 0
for link in new_links:
    key = (link["source"], link["target"], link["type"])
    if key not in existing_links:
        blueprint["links"].append(link)
        existing_links.add(key)
        added_links += 1

blueprint["scope"] = "Blueprint du procédé « Injection des conversations IA dans le L1 » — révision Direction B. Le chemin sélectionné sépare strictement deux temps : (1) une pré-indexation légère, déterministe et auditable de chaque conversation, qui conserve la source, produit une fiche Thing, une progression émotionnelle provisoire, un champ dominant, des candidats personnes/lieux et des questions de résolution ; (2) une lecture agentique ultérieure, bloc par bloc, qui seule peut produire des mémoires sémantiques riches. Le poids durable de la fiche dépend de la longueur et de la masse émotionnelle ; l'énergie reste contextuelle et dynamique. Aucune extraction automatique ne fusionne une personne, ne crée un lieu certain, ne prétend assimiler la conversation ou ne remplit le cerveau de nœuds aléatoires. Les chemins encounter-first et recall autonome antérieurs restent documentés comme historique d'architecture, mais la Direction B gouverne le prochain MVP."

print(f"Added {added_nodes} nodes (total {len(blueprint['nodes'])}) and {added_links} links (total {len(blueprint['links'])}).")

with open(base_file, "w", encoding="utf-8") as f:
    json.dump(blueprint, f, indent=2, ensure_ascii=False)

path_b = os.path.join(r"c:\Users\reyno\OneDrive\Documents\body-suit\data", "conversation-injection-blueprint-direction-b.json")
with open(path_b, "w", encoding="utf-8") as f:
    json.dump(blueprint, f, indent=2, ensure_ascii=False)

print("Saved updated blueprints.")
