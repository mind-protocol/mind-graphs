# Nomenclature canonique du graphe

La nomenclature est définie par `data/graph-ontology.json`. Ce fichier est la source de vérité pour les types de nœuds, les prédicats de relations, les statuts épistémiques et les futures mesures quantitatives.

## Quatre dimensions séparées

1. **Type de nœud** — ce qu’est l’objet : innovation, mécanisme, hypothèse, question ou état.
2. **Type de relation** — ce que signifie la flèche, dans un seul sens défini.
3. **Statut épistémique** — fait documenté, proposition, hypothèse, scénario, cible ou question non résolue.
4. **Mesure** — probabilité, confiance ou taille d’effet, toujours accompagnée de son contexte et de ses justifications.
5. **Poids de traversée** — pertinence structurelle d’un lien pour une exploration ; ce n’est ni une probabilité ni une confiance.

Une proposition de design peut être très clairement formulée sans devenir un fait. Un événement peut avoir une probabilité élevée mais une confiance faible si les données sont pauvres. Une estimation peut avoir une confiance élevée tout en décrivant un effet presque nul.

## Cinq rôles physiques stockés (L4) vs types sémantiques en champ libre

Le modèle physique sous-jacent **Mind Protocol L4 v1.9.1** réduit la complexité du stockage à **5 types physiques canoniques (rôles L4)** :

1. `actor` : entité agissante ou citoyen (injecte de l'énergie comme une pompe).
2. `moment` : événement de cycle de vie ou repère temporel daté.
3. `narrative` : proposition, claim, idée, vision ou représentation de design.
4. `space` : périmètre, contexte d'application ou conteneur.
5. `thing` : artefact, document, métrique ou composant matériel/exécutable.

Les **types sémantiques** (`semanticType`) constituent un **champ libre d'étiquettes et de spécialisations métier** (`protocol`, `axiom`, `mechanism`, `system_state`, `open_question`, `source_document`, etc.).

Le **Moteur d'ontologie global (Ontology Mapping)** (déclaré dans [data/l4-ontology-mapping.json](file:///c:/Users/reyno/OneDrive/Documents/body-suit/data/l4-ontology-mapping.json)) est universel et s'applique à **tous les niveaux du système** (L1, L2, L3, L4, Design, Science). Dans la couche physique L4, il projette chaque type sémantique sur l'un des **5 rôles physiques fondamentaux** (`actor`, `moment`, `narrative`, `space`, `thing`) et associe à chaque prédicat sémantique ses prototypes physiques (polarité, hiérarchie, permanence).

## Vocabulaire quantitatif

- `probabilityPct` : probabilité qu’un événement défini survienne dans un système, une population et un horizon donnés.
- `confidenceScore` : confiance de 0 à 1 dans la qualité de l’estimation. Ce n’est jamais la probabilité de l’événement.
- `effectSizePct` : variation relative d’une métrique nommée contre une baseline nommée. Un pourcentage sans métrique, baseline et horizon est invalide.
- `quantificationStatus` : origine de la valeur — hypothèse, estimation de modèle, observation, expérience ou estimation contestée.

Une valeur quantitative restera vide tant qu’elle n’est pas reliée à ses justifications par `SUPPORTS_ESTIMATE`.

## Relations à ne plus confondre

Chaque relation possède obligatoirement un champ `justification`. Ce texte explique la nature précise du lien entre les deux nœuds nommés. Il ne doit pas être confondu avec le prédicat, qui classe la relation, ni avec une preuve empirique. Lorsque le corpus fournit déjà un récit (`story`) ou une logique causale (`logic`), ce contenu spécialisé fonde la justification ; sinon la justification explicite au minimum le prédicat, sa direction, sa portée et son caractère causal ou non.

- `UNLOCKS` : condition de possibilité, pas causalité suffisante. Enchaîner deux capacités ou deux horizons relève de ce prédicat, jamais de la famille causale.
- `CAUSES` / `LEADS_TO` / `SCENARIO_LEADS_TO` : affirmation causale ou quasi causale ; elles devront porter effet, horizon, probabilité et confiance.
- `FEEDS` : transfert de ressource ou signal, sans affirmer à lui seul un résultat final.
- `MOTIVATES` : raison normative expliquant un choix, sans effet causal. C’est le prédicat de l’**effet visé** : un `design_effect` motive le mécanisme qui le poursuit, il n’en est jamais la cible d’un `CAUSES`.
- `BLOCKS` : question ouverte ou décision non prise qui conditionne ou bloque actuellement un élément.
- `TESTS` : expérience prévue, distincte d’une preuve obtenue.
- `COMMUNICATES` : traduction narrative, distincte d’une validation.
- `PART_OF` : une partie vers son ensemble.
- `SUBCASE_OF` : un cas spécifique vers le cas général qu’il spécialise.

## Traversée et hiérarchie

- `traversalWeight` est un float entre 0 et 1 contrôlant la pertinence transmise pendant une traversée.
- `hierarchyWeight` est un float entre 0 et 1. Zéro signifie aucune hiérarchie ; une valeur forte indique une relation partie/ensemble ou cas/général étroite.
- `hierarchyKind` vaut `none`, `part_of`, `subcase_of`, `instance_of` ou `specializes`.

La hiérarchie est orthogonale au prédicat : une question peut `BLOCKS` une simulation tout en étant qualifiée comme `subcase_of` son problème général. Le moteur parcourt les liens dans les deux sens, avec une légère pénalité dans le sens inverse et une décroissance à chaque saut.

`LEADS_TO` et `SCENARIO_LEADS_TO` restent acceptés pour compatibilité et possèdent un prédicat canonique indiqué dans l’ontologie. `CONSTRAINS` a été absorbé par `BLOCKS` : maintenir deux prédicats pour un même concept obligeait chaque algorithme à gérer une union, et celui qui l’oubliait ratait la majorité des blocages sans erreur visible. `UNLOCKS` ne déclare plus de prédicat canonique : il pointait vers un `ENABLES` qui n’a jamais existé dans l’ontologie.

Toute valeur de `canonicalPredicate` doit désigner un prédicat déclaré. Un pointeur mort ne provoque aucune erreur d’exécution ; il installe une migration fantôme que personne ne peut effectuer.

## Relations de résolution et de preuve

- `ADDRESSES` est actif : une solution spécifiée traite explicitement une question, sans prouver que la solution fonctionne.
- `DERIVED_FROM` est actif : une proposition extraite pointe vers son document source. Il encode la provenance, jamais une validation empirique.

Relations de preuve et de blocage activées dans le schéma 1.4 :

- `SUPPORTS_ESTIMATE` : une source, un résultat ou une simulation justifie une estimation.
- `CONTRADICTS` : deux affirmations, règles ou états sont incompatibles dans un même contexte.
- `BLOCKS` : unique relation de blocage, acceptant les questions ouvertes comme les décisions non prises.

## Orientation des états et valence humaine

Un `system_state` porte obligatoirement une `stateOrientation` parmi `desirable`, `undesirable` et `mixed`. Cette orientation dit ce que le projet vise ou évite ; elle ne mesure pas le bien-être humain. Les identifiants sont en anglais comme les types et les prédicats ; les libellés français appartiennent à l’interface.

Cet énuméré d orientation est contrôlé par le validateur, contrairement aux mesures qui restent facultatives. La raison est asymétrique : une mesure absente est visible, tandis qu’une seconde graphie d orientation ne provoque aucune erreur — elle rend simplement la détection de contradictions partielle, sans que rien ne le signale.

La valence humaine est au contraire un float continu `valenceScore` borné de `-1` à `+1`. `-1` ancre une souffrance extrême, `0` un état neutre effectivement mesuré et `+1` un bonheur ou bien-être extrême. Une valeur absente signifie inconnue : le système ne remplace jamais l ignorance par zéro. La valeur créée se formule comme `humanValenceDelta = valence_après - valence_avant`, avec méthode, contexte, confiance et justifications.

Un périmètre n’est réfutable que s’il expose aussi ses états indésirables. Un cluster qui ne déclare que des cibles désirables décrit un souhait, pas un système observable.

## Objets de preuve, mesure et contexte

Le schéma 1.4 introduit `claim`, `observation`, `experiment`, `dataset`, `metric`, `estimate`, `method` et `context`. Ils permettent de ne plus confondre une proposition, un résultat observé, les données qui le portent, la méthode employée et l’estimation obtenue.

Les relations `OBSERVES`, `PRODUCES`, `USES_METHOD`, `MEASURES`, `USES_DATASET` et `APPLIES_IN` encodent ce parcours. Chaque prédicat actif possède désormais un contrat de types source et cible dans `relationConstraints`. Le validateur refuse les couples incompatibles avant le seed.

Le statut épistémique par défaut reste fourni par le type, mais chaque nœud peut le surcharger explicitement, notamment avec `observed`, `refuted` ou `superseded`.

## Vocabulaire défini

Un nœud `terme` fixe le sens local d’un mot ou d’une expression. Il possède obligatoirement un `context` qui délimite son emploi et une `definition` qui en donne le sens. Son nom sert de forme canonique : ses occurrences exactes sont mises en gras dans l’interface et leur fiche est disponible au survol et au clavier.

## Contrat des futurs algorithmes

- **Questions importantes non résolues** : partir des `open_question`, suivre les liens de blocage, mesurer le nombre et l’importance des mécanismes, états et hypothèses en aval, puis vérifier l’absence de `ADDRESSES`.
- **Solutions non spécifiées ou fragiles** : repérer les mécanismes sans implémentation, test ou justification, puis pondérer leur centralité causale.
- **Contradictions** : combiner liens `CONTRADICTS`, états désirables/indésirables rendus simultanément probables et règles incompatibles dans le même contexte.
- **Consolidation** : proposer des doublons à partir du nom normalisé, du type, de la famille et de la signature de voisinage ; ne jamais fusionner automatiquement.
- **Goulots structurels** : calculer la centralité d'intermédiarité sur le sous-graphe directionnel causal et de design, puis la confronter à l'impact aval.
- **Boucles de rétroaction** : extraire les composantes fortement connexes, fournir un cycle témoin et demander explicitement le signe, le délai, le gain et les amortisseurs de la boucle.
- **Preuves à fort levier** : regrouper les affirmations causales non justifiées par cible et prioriser les protocoles susceptibles de réduire plusieurs incertitudes en aval.

La nomenclature précède donc les scores. Aucun algorithme ne devra inventer une probabilité ou un effet pour combler une valeur absente.

## Consultation externe

Le schéma 1.11 ajoute le type `consultation` : un point du graphe soumis à une audience extérieure, avec son canal, sa date, son statut (`draft`, `published`, `harvested`, `closed`) et l’URL du fil une fois publié. Deux prédicats l’encadrent :

- `CONSULTS` : la consultation désigne le nœud qu’elle soumet. Elle interroge, elle ne conclut pas.
- `ANSWERS` : un signal externe rapporté désigne la consultation qui l’a sollicité. Sa portée est `provenance`, comme `DERIVED_FROM` : une réponse dit qui a dit quoi et où, jamais que c’est vrai.

La distinction avec `source_document` est celle du sollicité et du trouvé. Un document rencontré reste un `source_document` relié par `DERIVED_FROM` ; une réponse obtenue parce qu’on a posé la question se relie par `ANSWERS`. Aucun des deux n’est une preuve.

Un nœud atteint par `ANSWERS` ne porte ni `probabilityPct`, ni `confidenceScore`, ni `effectSizePct`, et n’est source ni d’un `SUPPORTS_ESTIMATE` ni d’une arête causale chiffrée ; le validateur le refuse. La raison est la même que pour le reste de la nomenclature : sans elle, le nombre d’approbations d’une audience finirait par se lire comme une mesure. Une réponse forte se traduit en `task` ou en `experiment`, jamais en chiffre.

## Contrat de naissance du L1

Le schéma 1.15 ajoute `blueprintContract` : la spécification universelle avec laquelle naît le graphe personnel d’un citoyen. Sa règle centrale est l’universalité de la structure et la souveraineté du contenu. Est universel ce qui est forme — types, capacités, patterns, permissions, invariants ; est souverain ce qui est contenu — faits, valeurs, relations, objectifs, inférences.

Trois couches portent des droits d’écriture différents : `constitution` rassemble les invariants qu’une instance ne peut pas modifier silencieusement, `seed` les capacités et structures initiales modifiables, `citizen_state` la mémoire souveraine qu’aucune migration de structure n’atteint. Fusionner ces couches rendrait toute mise à jour capable de réécrire une vie.

Le blueprint n’est pas un graphe maître. Une instance est un **fork souverain** : les évolutions lui sont proposées, jamais poussées dans son état citoyen. Le savoir partagé y entre par référence versionnée et annotation personnelle, jamais par copie présentée comme vérité locale — recopier une connaissance révisable dans un graphe personnel la transformerait en croyance figée que plus aucune correction ne peut atteindre.

Sept catégories sont interdites à la naissance : faits personnels, psychologie inférée, préférences politiques ou culturelles, biométrie, baseline de bien-être, hiérarchie de valeur entre personnes, croyances présentées comme universellement vraies. Le validateur ne juge ni la complétude d’un blueprint ni le contenu d’une instance ; il vérifie que les deux axiomes constitutionnels existent comme nœuds `axiom` et que chaque catégorie déclarée dans le schéma est portée par l’axiome de prohibition. Une liste qui pourrit d’un seul côté est le seul échec qu’un validateur puisse voir, et c’est le plus grave : une garantie affichée que plus rien ne soutient.

Le blueprint décrit ce qu’un citoyen peut faire. Ce qu’il possède à la première seconde relève du seed, décrit par `importContract`.

## Import du corpus personnel et seed

Le schéma 1.16 ajoute `importContract` : un L1 ne naît pas ignorant. Tout le corpus déjà détenu par la personne est importé pour que son graphe démarre aussi proche que possible de la vie déjà vécue. Le blueprint donne à tous les mêmes capacités ; le seed donne à chacun la sienne.

La frontière avec l’interdit de préremplissage tient en une phrase : l’interdit vise ce que l’éditeur écrirait au nom d’un citoyen, pas ce que le citoyen apporte. Un seed peut donc naître plein tant que sa matière vient de son corpus consenti.

Rien n’entre entier. Un document, une photo, une vidéo, un drive sont **atomisés** : décomposés en éléments de sens séparément adressables. Chaque **atome importé** porte obligatoirement `sourceArtifact`, `sourceLocator`, `extractedAt`, `extractionMethod`, `confidenceScore` et `claimNature`. L’atome est l’unité de correction, de contestation et d’oubli ; un fichier avalé entier ne laisse le choix qu’entre tout garder et tout perdre.

`claimNature` distingue `declared_fact`, `observation`, `inference` et `preference`. La quantité de données ne fait pas franchir cette frontière : ce qu’un modèle conclut reste une inférence, quels que soient sa confiance et le nombre de sources concordantes. Confondre les deux fabrique une biographie que personne n’a signée.

L’échelle des sources va du moins interprétatif au plus dense : `documents`, `photos`, `videos`, `cloud_drive`. Chaque catégorie est portée par exactement une méthode du graphe, via `importSourceKind` — le validateur refuse une catégorie déclarée sans méthode comme une méthode absente de l’échelle, parce que la première annonce une capacité que rien ne décrit et la seconde entre dans le seed sans doctrine.

Trois règles encadrent le reste. Le consentement est donné source par source, borné et retirable. La révocation remonte la chaîne de provenance jusqu’aux atomes dérivés : un oubli qui s’arrête aux fichiers laisse survivre la conclusion en effaçant sa cause. Les atomes concernant un tiers identifiable sont marqués, restent locaux et ne circulent pas — importer une vie ne doit pas importer celle des autres.

Enfin, la fidélité d’un seed se constate auprès de la personne qu’il décrit, jamais auprès du modèle qui l’a produite. Demander à un modèle si son portrait est ressemblant, c’est exactement la mesure qui se laisse optimiser sans que la fidélité augmente.

## Modélisation continue de la personne

Le schéma 1.17 ajoute `predictionContract` : l’IA d’une personne prédit en permanence ce qu’elle va faire, observe ce qui arrive, et apprend de l’écart. L’intérêt méthodologique est direct — la réalité écrit les questions et note les réponses, ce qui supprime d’un coup l’auto-écriture et l’auto-notation qui rendaient un test de fidélité ininterprétable. Cet avantage n’existe que si la prédiction est **scellée avant l’issue** : le journal est append-only, et une prédiction ratée ne peut être ni supprimée ni réécrite.

Le score n’est jamais une exactitude brute. Une prédiction continue porte majoritairement sur du presque certain, où l’exactitude monte sans qu’aucune connaissance progresse. Le contrat impose une règle propre — Brier ou log loss — rapportée à une **baseline de routine** construite sur les régularités passées de la personne. Un écart nul signifie que le moteur a appris un emploi du temps, pas quelqu’un.

Trois dangers sont propres à ce dispositif, et chacun a sa règle.

Une prédiction sur laquelle le système a agi est **contaminée** : son issue mesure aussi l’action. Elle instruit le modèle de l’effet des interventions, jamais le modèle de la personne, et les deux modèles ne partagent pas leur score. Sans cette séparation, le moteur s’améliore en agissant davantage et finit par prédire surtout ses propres suggestions — avec une erreur devenue invisible, puisqu’il a eu raison.

La **prédictibilité n’est jamais une cible**. Un système noté sur sa justesse a intérêt à rendre la vie plus régulière ; c’est l’échec le plus difficile à voir, parce que toutes les métriques s’améliorent en même temps. Le taux de surprise est suivi pour cette raison, et n’est lui-même jamais optimisé : sa décroissance est une alarme.

Une prédiction **ne s’affiche jamais comme un fait**. Elle se montre comme un pari daté et probabilisé, ou ne se montre pas. Six domaines sont restreints — diagnostic clinique, crise de santé mentale, rechute addictive, rupture relationnelle, comportement d’un tiers, péril juridique ou financier : la prédiction n’y est ni affichée spontanément, ni exportée, ni valorisée économiquement. La restriction porte sur l’affichage et la circulation, jamais sur l’escalade humaine en cas d’urgence. Le validateur exige que ces domaines soient énumérés à l’identique dans le schéma et sur le nœud de retenue : une promesse faite à la personne modélisée ne peut pas pourrir d’un seul côté.

Enfin, une baisse de compétence est une hypothèse à deux branches avant d’être un motif de réentraînement — le modèle a vieilli, ou la personne a changé. Réapprendre par réflexe effacerait le signal le plus intéressant qu’une vie puisse produire.

## Objets de travail du projet

Depuis le schéma 1.5, `idea`, `task` et `change` décrivent le pilotage sans les confondre avec une hypothèse scientifique ou une preuve. Le statut opérationnel (`workStatus`) reste séparé du statut épistémique. `DOCUMENTS_PROGRESS` affirme qu’un changement a été livré pour une tâche ; il ne soutient aucune estimation scientifique.
