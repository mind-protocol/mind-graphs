<!-- Fichier généré par `npm run docs:parameters`. Ne pas éditer à la main :
     les valeurs viennent du code qui les exécute, les justifications du graphe. -->

# Paramètres des algorithmes

Un paramètre du code qui produit une conclusion sur laquelle le projet agit est une affirmation comme une autre : il doit pouvoir être rouvert. Le code conserve le choix mais détruit les alternatives ; seule une décision du graphe garde les options écartées et le critère qui a tranché.

**État** : 20 paramètres décisifs sur 27 déclarés · 3 portent une décision.

On mesure la déclaration et la fraîcheur, jamais l’altitude. Viser un barreau haut partout pousserait au benchmark cérémoniel et punirait les choix normatifs, qui sont déjà à leur plafond.

## Échelle de preuve

Le design et le développement ne doivent pas le niveau de preuve de la science. Le coût demandé n’est jamais de prouver, seulement d’étiqueter. Le seul véritable échec est un « on pense que » relu six mois plus tard comme un « on a mesuré ».

| Rang | Identifiant | Barreau | S'auto-invalide | Date de revue |
|---:|---|---|---|---|
| 1 | `assertion` | assertion argumentée | non | obligatoire |
| 2 | `expert_judgment` | jugement attribué | non | obligatoire |
| 3 | `simulation` | mesuré en monde clos | oui | facultative |
| 4 | `real_world` | preuve du monde réel | oui | facultative |

## Moteur de questionnement local

Extrait un cluster pertinent du corpus pour une question en langue naturelle. Il ne génère aucune réponse : il sélectionne et ordonne des nœuds existants.

| Paramètre | Valeur | Unité | Décisif | Justification | Rôle |
|---|---:|---|---|---|---|
| `dimensions` | 512 | dimensions | non | — | Taille du vecteur de hachage projetant les termes TF-IDF. |
| `lexicalWeight` | 0.72 | part | oui | **aucune décision** | Part de similarité lexicale dans le score sémantique. |
| `vectorWeight` | 0.28 | part | oui | **aucune décision** | Part de similarité vectorielle dans le score sémantique. Complément de lexicalWeight. |
| `maxDepth` | 3 | sauts | oui | **aucune décision** | Profondeur maximale de propagation depuis un ancrage. |
| `seedCount` | 5 | nœuds | oui | **aucune décision** | Nombre d'ancrages initiaux retenus avant propagation. |
| `hopDecay` | 0.72 | facteur | oui | **aucune décision** | Décroissance du score à chaque saut supplémentaire. |
| `inboundPenalty` | 0.82 | facteur | oui | **aucune décision** | Pénalité appliquée à la traversée d'une arête dans le sens inverse. |
| `hierarchyBoostMax` | 0.18 | part | non | — | Bonus maximal accordé au poids d'une arête hiérarchique. |
| `defaultTraversalWeight` | 0.5 | poids | oui | **aucune décision** | Poids structurel retenu quand une arête ne déclare aucun traversalWeight. Repli, mais il gouverne alors toute la propagation le long de cette arête. |
| `semanticScore` | 0.7 | part | oui | **aucune décision** | Part du score sémantique dans le classement final. |
| `graphScore` | 0.3 | part | oui | **aucune décision** | Part du score propagé dans le classement final. Complément de semanticScore. |
| `limit` | 12 | nœuds | non | — | Nombre de résultats classés retournés par défaut. |
| `semanticFloor` | 0.015 | score | non | — | Score sémantique minimal pour qu'un nœud soit candidat à l'ancrage. |
| `propagationFloor` | 0.02 | score | oui | **aucune décision** | Score propagé minimal pour continuer à traverser une arête. Contrainte réellement liante de la traversée : c'est lui qui éteint la propagation avant maxDepth. |
| `rankFloor` | 0.018 | score | non | — | Score final minimal pour apparaître dans le résultat. |

> Moteur lexical : il reconnaît mal les synonymes absents du corpus. Le résultat est un cluster pertinent, jamais une réponse générée.

## Moteur d'énergie L4

Fait circuler l'énergie sur les liens du graphe selon la physique signée du cluster l4-ontology-mapping. Il ne produit aucune affirmation : il dit où le graphe est chaud, jamais si ce qui y est écrit est vrai.

| Paramètre | Valeur | Unité | Décisif | Justification | Rôle |
|---|---:|---|---|---|---|
| `actorInjection` | 1 | énergie par unité de poids | non | — | Énergie injectée par une pompe à chaque tic, PAR UNITÉ DE POIDS du citoyen : un citoyen de poids w injecte w × actorInjection. Sans seuil dans la loi, cette valeur est une jauge — elle fixe l'unité, pas la forme. Elle redeviendra décisive le jour où question-l4-activation-threshold sera tranchée. |
| `queryInjection` | 1 | énergie | non | — | Énergie injectée par une requête le long du chemin qu'elle a réellement parcouru. Même statut de jauge que actorInjection tant qu'aucun seuil n'existe. |
| `decayPerTick` | 0.85 | facteur | oui | **aucune décision** | Part de l'énergie conservée d'un tic au suivant. Fixe l'horizon de mémoire du moteur : une impulsion perd la moitié de son énergie en ln(0.5)/ln(0.85) ≈ 4,3 tics. Gouverne, avec propagationGain, la stabilité du système. |
| `propagationGain` | 0.1 | part | oui | **aucune décision** | Part de sa propre énergie qu'un lien redistribue à son voisinage à chaque tic. La propagation CONSERVE : ce qui part par une composante positive est retranché à la source, jamais copié. weight n'entre pas dans cette quantité — il ne fait que biaiser la répartition entre destinataires. La quantité déplacée est donc toujours majorée par l'énergie du lien, indépendamment de weight. |
| `propagationFloor` | 0.001 | énergie | oui | **aucune décision** | Énergie sous laquelle un lien cesse d'émettre et est remis à zéro. Empêche une poussière d'énergie de parcourir indéfiniment tout le graphe, ce qui annulerait la localité que l4-execution-tick exige. |
| `injectionRadius` | 1 | sauts | oui | **aucune décision** | Distance à laquelle une pompe dépose son énergie autour d'elle. À 1, un acteur n'échauffe que ses arêtes incidentes et laisse la propagation faire le reste. |
| `weightGain` | 0.02 | part | oui | **aucune décision** | Part de l'activation d'un lien versée dans son weight à chaque tic. C'est le mécanisme qui manquait à la définition de weight : « acquis au fil des coactivations » veut dire que l'énergie qui passe se transforme en structure. Ce n'est pas de la dissipation, c'est une conversion. |
| `weightDecay` | 0.0004 | part | oui | **aucune décision** | Fuite structurelle de weight par tic, délibérément très faible : la structure oublie, mais des ordres de grandeur plus lentement que l'énergie ne s'éteint. C'est cet écart de constante de temps qui rend weight et energy séparables face au critère d'admission. La fuite effective est weightDecay × (1 - stability) : un lien régulièrement actif ne perd presque rien. |
| `stabilityRate` | 0.02 | part | oui | **aucune décision** | Vitesse de la moyenne glissante qui estime stability à l'exécution, faute de pouvoir relire tout l'historique de coactivation à chaque tic. Proxy assumé : stability suit le niveau soutenu d'activation, pas encore sa régularité fine. C'est stability qui protège weight de l'oubli, réunissant les deux grandeurs dérivées que le noyau déclarait séparément. |
| `semanticGuidanceBeta` | 2 | coefficient sans dimension | oui | **aucune décision** | Force avec laquelle la similarité cosinus entre le global workspace du flux et une sortie locale infléchit la répartition. Elle ne multiplie jamais l'énergie disponible : elle n'agit qu'avant la normalisation conservative. |
| `semanticTemperature` | 1 | température softmax | oui | **aucune décision** | Température du softmax local. Une valeur basse concentre l'énergie sur les sorties les mieux alignées ; une valeur haute rapproche la distribution de celle gouvernée par weight seul. |
| `explorationRate` | 0.05 | part de la distribution locale | oui | **aucune décision** | Part du budget local réservée à une distribution uniforme entre les sorties admissibles. Ce plancher empêche un embedding courant d'annuler toute chance de découvrir un détour sémantiquement éloigné. |

> Loi purement multiplicative, sans seuil ni porte calculée. Elle ne peut donc construire ni porte AND ni branchement, et ne doit pas être présentée comme un moteur d'exécution. `gate` est lu depuis les prototypes et vaut 1 partout tant qu'aucun sous-graphe de conditions n'est implémenté.

## Décisions ouvertes

### Décision · Mélange lexical / vectoriel du score sémantique

- **Paramètres visés** : `graph-query.lexicalWeight`, `graph-query.vectorWeight`
- **Statut** : approved · responsable : Auteur du projet · moteur de questionnement
- **Barreau de preuve** : mesuré en monde clos — Mesuré en monde clos : jeu de questions de référence rejoué sur cinq partages, attendus calculés par traversée du corpus et non recopiés. Le barreau s'auto-invalide — rejouer npm run bench:query sur un corpus modifié contredira ce chiffre si le mélange cesse de dominer.
- **Revue prévue** : 2026-10-22
- **Ce qui clôturerait** : Jeu de référence query-reference-2026-07 (11 questions, attendus dérivés par traversée) exécuté sur cinq partages. Artefact : artifacts/benchmark/query-reference.json, régénérable par npm run bench:query.

Le mélange gouverne quels nœuds deviennent ancrages, donc quel cluster remonte pour une question, donc quelles lacunes du corpus sont vues et traitées. Aucune trace n'explique le partage actuel ni ce à quoi il a été comparé.

### Décision · Profondeur de propagation depuis un ancrage

- **Paramètres visés** : `graph-query.maxDepth`
- **Statut** : approved · responsable : Auteur du projet · moteur de questionnement
- **Barreau de preuve** : mesuré en monde clos — Mesuré en monde clos : jeu de référence rejoué à cinq profondeurs et cinq seuils de propagation, attendus dérivés par traversée. Le barreau s'auto-invalide — si des chaînes plus longues que deux sauts apparaissent dans le corpus, rejouer le jeu contredira ce chiffre.
- **Revue prévue** : 2026-10-22
- **Ce qui clôturerait** : Jeu de référence query-reference-2026-07 exécuté à cinq profondeurs (1, 2, 3, 4, 6) puis à cinq seuils de propagation. Artefact : artifacts/benchmark/query-reference.json, régénérable par npm run bench:query.

La profondeur fixe l'étendue du cluster rendu pour une question : trop courte, elle masque la chaîne causale qui répond ; trop longue, elle noie les ancrages sous des nœuds faiblement reliés. Aucune trace n'explique la valeur actuelle, choisie quand le corpus était bien plus petit qu'aujourd'hui.
