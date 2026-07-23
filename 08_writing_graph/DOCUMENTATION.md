# Documentation technique — Mind Causal Graph

## Objet

Cette application sert à explorer et auditer le modèle causal de Mind Protocol. Le graphe interactif, la présentation de l’ontologie et le tableau de santé algorithmique disposent de pages séparées. Le tableau de santé expose les numérateurs, dénominateurs, pondérations et limites de chaque indicateur, puis contextualise les recommandations produites par l’audit.

## Corpus

Valeurs live (résolues à l'affichage depuis le graphe et l'ontologie ; les jetons `{{…}}` restent littéraux dans le fichier brut) :

| Élément | Nombre |
|---|---:|
| Nœuds actifs | {{stats.nodes}} |
| Relations actives | {{stats.links}} |
| Types de nœuds | {{stats.nodeTypes}} |
| Familles de relations | {{stats.relationFamilies}} |
| Prédicats actifs | {{stats.activePredicates}} |
| Prédicats réservés | {{stats.reservedPredicates}} |

Le nœud racine `protocol` représente Mind Protocol. Les types sémantiques (champ libre d'étiquettes métier : axiomes, capacités, mécanismes, institutions, horizons, événements prospectifs, raisons de design, mécanismes économiques, effets, hypothèses, questions, états, etc.) se projettent dans la couche physique sous-jacente **L4** sur **5 rôles physiques fondamentaux** (`actor`, `moment`, `narrative`, `space`, `thing`).

Le type `terme` formalise le vocabulaire du graphe. Chaque nœud de ce type doit renseigner `context` et `definition`. Dans l’interface, toute occurrence exacte du nom d’un terme est rendue en gras et expose ces deux informations au survol ou à la prise de focus clavier. Le nœud correspondant présente la même fiche lorsqu’il est survolé dans le canvas.

## Architecture

```text
graphs.json ──► JSON causal ──► validation ──► seed ──► FalkorDB
 (composition)                                            │
                                                          ▼
                                                   API /api/graph
                                                          │
                                          ┌───────────────┴───────────────┐
                                          ▼                               ▼
                                   visualiseur canvas            algorithmes locaux
                                   zoom, pan, filtres             audit + dialogue
```

Le graphe utilise le label FalkorDB `MindNode` et le nom logique `mind_causal_graph`.

## Composition des graphes

[`graphs.json`](graphs.json) est la source de vérité unique de la composition. Chaque graphe y déclare sa base FalkorDB, son ontologie et ses jeux de données ordonnés ; le seed, le validateur et le calcul des statistiques lisent ce manifeste au lieu de maintenir chacun leur liste. Les particularités d'un jeu de données — forme racine, type de nœud par défaut, prédicat forcé, exigence de provenance — y sont déclarées, jamais déduites d'un nom de fichier.

Deux graphes sont déclarés :

| Graphe | Base | Statut | Contenu |
|---|---|---|---|
| `design` | `mind_causal_graph` | actif | ce que Mind Protocol propose et décide : axiomes, mécanismes, institutions, questions, décisions, prospective, pilotage |
| `science` | `mind_science_graph` | déclaré | la matière scientifique elle-même — études, claims, estimations, preuves — sous une ontologie propre |

Le graphe scientifique est **déclaré sans être peuplé** : sa base est nommée et sa frontière posée, mais il n'a encore ni ontologie ni donnée. Le validateur l'ignore et le signale explicitement comme non actif.

La frontière est nette dans les deux sens. Les nœuds `sci-*` et `csg-*` restent dans le graphe de design : ils **décrivent** le graphe scientifique, ils n'en sont pas le contenu, et les déplacer produirait un second graphe de design tout en coupant leurs liens vers les autres endgames et l'économie du projet. Réciproquement, aucune arête ne traverse les deux bases : une référence inter-graphes se fera par identifiant déclaré, dont la forme reste une question ouverte.

Ces arbitrages, leurs options rejetées et leurs raisons sont conservés dans le cluster `graph-architecture` ([`data/graph-architecture-decisions.json`](data/graph-architecture-decisions.json)).

Le sélecteur **Cluster documentaire** ouvre une vue dédiée et inclut automatiquement les nœuds externes directement reliés. L'URL `/?cluster=<identifiant>` restaure la vue. Les identifiants disponibles sont `civilization-endgame`, `democracy-endgame`, `education-endgame`, `mental-health-endgame`, `financial-realignment`, `science-endgame`, `causal-science-implementation`, `question-endgame`, `graph-architecture` et `evidence-appraisal-method`.

## Évaluer une preuve : les trois échelles

Le cluster `evidence-appraisal-method` porte la méthode d'évaluation critique d'une étude ([`data/sources/scisense-appraisal-method-v2.1.md`](data/sources/scisense-appraisal-method-v2.1.md)). Elle décrit comment juger une preuve ; elle n'est pas elle-même une preuve.

### On n'encode pas une discipline dans le schéma

Le graphe possède une **certitude native** : chaque claim porte un degré de certitude *dérivé de ses nœuds de justification* et des attributs qu'ils portent. Elle est continue, se recalcule dès qu'une justification est ajoutée, corrigée ou contredite, et reste indépendante du domaine.

GRADE n'est donc pas la machinerie du graphe : c'est un **instrument de domaine**, valable pour les études qu'il sait évaluer et remplacé par un autre ailleurs. Une évaluation GRADE produit un cluster de justification dont les attributs alimentent la certitude native. Les échelles sont emboîtées : « ce claim tient parce que son évaluation donne tel score » — le score est la justification, la certitude est la résultante.

L'alternative — adopter GRADE comme notion de certitude du graphe — a été écartée : elle aurait contraint le graphe à une discipline et à ses types d'études, laissant hors schéma le préclinique, le qualitatif, l'ingénierie, les sciences sociales et le paramètre de code.

### Trois échelles, jamais confondues

| Échelle | Répond à | Ne dit pas |
|---|---|---|
| Barreau de preuve (`evidenceLadder`) | sur quoi tient cette affirmation aujourd'hui | à quel point elle est sûre |
| Certitude native (dérivée des justifications) | à quel point elle tient | ce qu'on a le droit d'en faire |
| Seuils d'action | ce qu'on a le droit de faire | sur quoi l'affirmation tient |

Trois règles en découlent :

- **La télémétrie écrit la justification, jamais le claim.** Une source ajoute ou modifie un nœud de preuve à son propre poids probant ; la certitude bouge parce qu'elle en dérive, le claim reste intact. Ce n'est pas un mur entre le réel et la connaissance, c'est un bras de levier.
- **Aucun seuil sur ce qu'on sait, des seuils sur ce qu'on fait.** Il n'existe pas de promotion ni de palier à franchir. Le découpage n'apparaît qu'au point de décision, parce qu'agir est binaire — et il appartient à celui qui agit, qui choisit selon son cadre de ne se fonder que sur les connaissances au-dessus d'un certain niveau. Le même graphe se lit à plusieurs seuils sans être modifié.
- **Une vulgarisation n'affirme pas plus que son claim source.** La communication est une dérivation plafonnée, pas un domaine autonome avec sa propre matrice.

La méthode fournit par ailleurs la table design → instrument de risque de biais (RoB 2, ROBINS-I, ROBINS-E, AMSTAR-2, QUADAS-2, QUIPS, PROBAST, SYRCLE) et sépare ce qui s'automatise — statut de rétractation, concordance au registre, *outcome switching*, attrition, cohérence statistique, conflits d'intérêts, disponibilité des données — de ce qui reste un jugement humain. La formule retenue : **la machine assemble le dossier, l'humain signe le jugement.**

Reste ouvert, et bloquant : la fonction de calcul elle-même (`question-native-certainty-computation`). Quels attributs comptent, comment se composent des justifications concordantes ou contradictoires, ce que devient la certitude quand une justification est contestée. Tant qu'elle n'est pas écrite, la certitude native est une intention, pas une valeur.

Les nœuds extraits portent `clusterId`, `sourcePage` et `documentSection`; `DERIVED_FROM` conserve leur provenance vers le PDF source. Une provenance documentaire prouve que le document formule la proposition, pas que la proposition est vraie. Les liens de design des documents restent donc explicitement qualifiés comme propositions, hypothèses ou cibles.

Le cluster CSG v0.2 est aussi un audit d'écart : il décrit une architecture cible plus stricte que l'application actuelle. En particulier, l'application n'a pas encore les labels scientifiques canoniques, la séparation `canonical/staging/runtime`, les spans immuables, les snapshots ni la chaîne `Study → Estimate → Claim → Evidence` complète.

## Modèle des relations

Chaque relation possède un prédicat directionnel, une famille, une portée épistémique et un indicateur précisant si elle affirme une causalité. Trois champs organisent la traversée :

- `traversalWeight` : force structurelle entre 0 et 1 ;
- `hierarchyWeight` : intensité hiérarchique entre 0 et 1 ;
- `hierarchyKind` : `none`, `part_of`, `subcase_of`, `instance_of` ou `specializes`.

Ces valeurs ne sont ni des probabilités ni des niveaux de confiance. `PART_OF` va de la partie vers l’ensemble et `SUBCASE_OF` du cas spécifique vers le cas général.

## Audit algorithmique

Le rapport latéral détecte et classe :

1. les questions non résolues avec impact aval ;
2. les solutions sous-spécifiées ;
3. les affirmations causales sans preuve ;
4. les contradictions ou tensions ;
5. les candidats à la consolidation ;
6. les goulots structurels présents sur de nombreux chemins courts ;
7. les boucles de rétroaction formées par des composantes fortement connexes ;
8. les campagnes de preuve à fort levier, capables d'éclairer plusieurs affirmations et conséquences.

Le score de priorité ordonne le travail mais ne mesure pas la vérité. Une tension ne devient pas automatiquement une contradiction et une consolidation n’est jamais appliquée automatiquement.

Les questions reliées à une réponse explicite par `ADDRESSES` sortent de la liste « non résolue ». Le lien signifie qu'une proposition traite désormais la question ; il ne signifie pas que la proposition est validée.

La centralité d'intermédiarité est calculée sur les relations directionnelles de causalité et de design. Les boucles sont détectées par composantes fortement connexes, puis accompagnées d'un cycle témoin. Le levier de preuve combine le nombre d'affirmations entrantes non justifiées et l'impact aval pondéré de leur cible. Ces trois mesures sont des heuristiques de navigation : elles ne remplacent ni une revue causale, ni un protocole falsifiable, ni des données.

## Dialogue avec le graphe

Le moteur local de `public/graph-query.js` indexe les textes du corpus avec TF-IDF, mots, bigrammes et n-grammes de caractères projetés dans un vecteur de hachage. Il retient quelques ancrages sémantiques, propage leur score le long des arêtes en le faisant décroître à chaque saut, puis mélange score sémantique et score propagé pour le classement final.

Ses réglages exacts ne sont pas recopiés ici : ils étaient auparavant énumérés dans cette section et y dérivaient sans que rien ne le signale. Le moteur déclare désormais lui-même les valeurs qu'il exécute, et [`ALGORITHM_PARAMETERS.md`](ALGORITHM_PARAMETERS.md) les rend avec l'état de leur justification. Ce fichier est généré par `npm run docs:parameters` ; `npm run validate` échoue s'il est périmé.

Le résultat contient les nœuds, relations, scores et chemins explicatifs. Il s’agit d’un cluster pertinent, pas d’une réponse générée.

```js
import { buildGraphQueryEngine } from "./public/graph-query.js";

const engine = buildGraphQueryEngine(nodes, links);
const cluster = engine.query("Quelles questions bloquent la simulation ?", {
  limit: 12,
  seedCount: 5,
  maxDepth: 3
});
```

## Procédure de modification

1. Modifier un fichier JSON dans `data/`.
2. Exécuter `npm run validate`.
3. Exécuter `npm run seed`.
4. Exécuter `npm run analyze` et des questions de référence.
5. Vérifier le canvas, les cartes et la console du navigateur.

## Backlog et avancement natifs

`data/project-work.json` conserve les idées, tâches et changements dans le même graphe que les recommandations et les objets causaux. Les relations de workflow sont :

- `PROMOTES_TO` : une idée devient une tâche bornée ;
- `TARGETS` : une tâche désigne le nœud du projet qu’elle modifie ou étudie ;
- `DEPENDS_ON` : une tâche attend un prérequis ;
- `DOCUMENTS_PROGRESS` : un changement livré journalise l’achèvement d’une tâche.

Une tâche autonome exploitable possède `workStatus: "ready"`, `autonomyMode: "autonomous"`, une priorité, des `acceptanceCriteria` et une `verificationCommand`. Les sujets nécessitant un arbitrage restent `proposed` et `review_required`. Le journal est append-only : terminer une tâche ajoute un nœud `change` au lieu de réécrire l’histoire.

Le premier protocole pré-enregistré est décrit dans [`P0_SIMULATION_CHARTER.md`](P0_SIMULATION_CHARTER.md). Il traite les six lacunes initiales de la simulation urbaine sans leur attribuer de résultat anticipé.

Sa première implémentation est décrite dans [`P1_AGENT_MODEL.md`](P1_AGENT_MODEL.md). Le moteur compare trois bras sur une population synthétique commune et marque toutes ses sorties comme exploratoires tant que données, comportements et paramètres ne sont pas calibrés.

## Consultation externe

Certaines lacunes ne se résorbent ni par relecture ni par simulation : il leur faut un angle mort qu'un auteur seul ne produit pas. La boucle de consultation soumet un point précis du graphe à une audience extérieure, puis rapporte ce qui en revient. Le contrat vit dans `consultationContract` de l'ontologie ; la donnée vit dans `data/consultations.json`.

La passerelle vers le forum est manuelle et le restera tant qu'elle n'aura pas fait ses preuves : aucun script n'appelle le réseau, ne publie ni ne récupère un fil.

```powershell
npm run consult:draft
npm run consult:draft -- --apply --limit=4
npm run consult:ingest -- --consultation=<id> --thread=data/sources/<fichier>.txt --url=<lien>
```

`consult:draft` classe les findings de l'audit et retient les quatre catégories qu'une audience peut réellement traiter : question non résolue, arête causale non chiffrée, contradiction, solution sous-spécifiée. Deux filtres évitent de dépenser l'attention d'autrui : une contradiction dont l'un des côtés est une `observation` ou un `dataset` est écartée, parce que le graphe contient déjà sa réponse ; et la sélection alterne les catégories, sinon les contradictions — les mieux notées — rempliraient chaque lot.

La commande écrit un nœud `consultation` en statut `draft`, ses arêtes `CONSULTS` vers les nœuds interrogés, et un brouillon de post dans `artifacts/consultations/`. Le brouillon ne contient aucun prédicat, aucun score de priorité ni aucun nom d'indicateur interne : un lecteur à qui l'on annonce qu'« aucune solution n'est reliée par `ADDRESSES` » s'en va. Le texte reste en français et extractif ; l'adapter au ton et à la langue du forum est une étape humaine.

`consult:ingest` enregistre qu'une consultation a été publiée — l'URL est obligatoire, une réponse sans fil identifiable n'étant pas traçable — puis découpe le fil collé en un squelette typé dans `artifacts/consultations/<id>-harvest.json`. Le format du fil est volontairement pauvre : un bloc par intervention, introduit par une ligne `## u/pseudo`. Le squelette ne type rien : décider qu'une intervention est une hypothèse plutôt qu'une objection est un jugement, laissé en marqueurs `TODO` comme l'échafaudage d'observables de `scripts/propose-work.js`.

### Ce qu'une réponse ne peut pas faire

Un nœud relié à une consultation par `ANSWERS` documente qu'une personne l'a dit, dans un fil identifiable, à une date donnée. Le validateur refuse qu'il porte `probabilityPct`, `confidenceScore` ou `effectSizePct`, et refuse qu'il soit source d'un `SUPPORTS_ESTIMATE` ou d'une arête causale chiffrée. Sans cette règle, la boucle deviendrait une fabrique de confiance : l'accord d'une audience se lirait comme une preuve, et le nombre d'approbations finirait par peser sur un `confidenceScore`. Une réponse convaincante produit une tâche, une expérience ou une question mieux posée — jamais un chiffre.

Une consultation qui n'a rien ramené reste visible en l'état. Le silence d'une audience est une information sur la question posée ; l'effacer fabriquerait un taux de réponse qui n'existe pas.

La matière non sollicitée garde son encodage antérieur : un document trouvé reste un `source_document` relié par `DERIVED_FROM`, comme le cluster `reddit-ai-democracy-2026-07-22`. Une consultation est l'équivalent sollicité, et les deux encodent une provenance, jamais une preuve.

## Limites et suite

- Les relations causales restent des hypothèses tant qu’aucun nœud de preuve ne les soutient.
- Les pourcentages de probabilité, confiance et effet ne doivent pas être ajoutés sans méthode, contexte et justificatifs.
- Le moteur lexical reconnaît mal certains synonymes absents du corpus.
- Un encodeur multilingue ONNX local pourra être comparé au moteur actuel sur un benchmark de questions.
- Les travaux linguistiques et corporels évoluent indépendamment dans `../tattoo-language-atlas/`.
