# Transformateur de cluster en présentation textuelle

## Objet

`public/cluster-presentation.js` transforme un sous-graphe typé en un `PresentationPlan` déterministe, puis en texte Markdown. Il ne mesure ni la vérité, ni une probabilité, ni une confiance scientifique. Il mesure une **proéminence éditoriale** à partir de la structure, de la nomenclature et des attributs du cluster.

Le transformateur est conçu pour la nomenclature canonique `data/graph-ontology.json` en version 1.7.x. Il utilise en priorité `relationFamily`, `canonicalPredicate`, `epistemicStatus`, `nodeType`, `traversalWeight` et `clusterId`.

## Contrat

```js
const plan = transformClusterToPresentation({ nodes, links }, { focusNode });
```

Le résultat contient `title`, `lede`, `patterns`, `rankedNodes`, `relationNarratives`, `orderedNodeIds`, `sections`, `markdown` et `meta`. Ce plan est indépendant du HTML afin que plusieurs rendus puissent réutiliser exactement la même analyse.

## 1. Séparation sémantique et provenance

Les liens `DERIVED_FROM`, ou dont `relationScope` vaut `provenance`, sont retirés du graphe servant aux centralités. Ils restent disponibles dans la section de provenance. Un document source ne devient donc pas artificiellement central parce que toutes les propositions pointent vers lui.

## 2. Poids des relations

Si `traversalWeight` existe, sa valeur bornée entre 0 et 1 est utilisée. Sinon, le poids par défaut de la famille canonique s’applique :

| Famille | Poids |
|---|---:|
| `evidence`, `hierarchy` | 0,95 |
| `causal` | 0,90 |
| `design_reasoning`, `contextual` | 0,85 |
| `normative`, `validation` | 0,80 |
| `enablement`, `flow` | 0,75 |
| `scenario` | 0,70 |
| `communication` | 0,50 |

Ces poids représentent une pertinence de traversée, jamais une probabilité.

## 3. Importance des nœuds

Chaque composante est normalisée entre 0 et 1.

```text
C(v) = 0,40 PageRank(v)
     + 0,35 Betweenness(v)
     + 0,25 WeightedDegree(v)

S(v) = 0,25 C(v)
     + 0,20 Convergence(v)
     + 0,15 DownstreamReach(v)
     + 0,25 TypePrior(v)
     + 0,10 Evidence(v)
     + 0,05 Specificity(v)
```

- `Convergence` mesure le poids des relations sémantiques entrantes.
- `DownstreamReach` mesure la proportion de descendants atteignables.
- `TypePrior` favorise protocoles, claims, cibles, principes et hypothèses structurantes.
- `Evidence` utilise le statut épistémique et les relations de preuve explicites.
- `Specificity` récompense métrique, méthode, contexte, population et indicateur.

Le score des documents sources est réduit puisqu’ils jouent un rôle de provenance. `S(v)` est un score éditorial, pas un score de vérité.

## 4. Rôles narratifs

Les nœuds sont classés dans cet ordre :

```text
contexte → horizon → tensions → objectifs → thèse → principes
         → éléments et mécanismes → effets → interaction humaine
         → gouvernance → validation → ponts → sources
```

Le classement combine type, statut épistémique, préfixe du nom, cluster dominant et relations sortantes. Les objets 1.6 restent distincts : contextes en ouverture, décisions et options dans la gouvernance, tâches et changements dans la validation, effets après les mécanismes qui les produisent.

## 5. Patterns émergents

Les motifs sont détectés par prédicat canonique :

- fondation : `GROUNDS`, `SAFEGUARDS` ;
- convergence : `IMPLEMENTS`, `CONVERGES_IN` ;
- validation : `TESTS`, `PRODUCES`, `OBSERVES`, `SUPPORTS_ESTIMATE` ;
- flux : `FEEDS` ;
- tension : `BLOCKS`, `CONTRADICTS`, `ADDRESSES` ;
- boucle : composante fortement connexe du sous-graphe sémantique ;
- pont : `clusterId` différent du cluster principal ;
- provenance : documents et `DERIVED_FROM`.

```text
I(P) = 0,45 moyenne(S(v))
     + 0,25 moyenne(w(e))
     + 0,20 couverture(P)
     + 0,10 cohérence(P)
```

La confiance d’un pattern exprime la densité de relations typées qui le matérialisent. Ce n’est pas une confiance scientifique.

Le pattern de provenance reçoit une pénalité éditoriale de 65 %. Ses sources restent complètes dans le plan, mais leur grand nombre ne peut pas repousser les motifs sémantiques hors du résumé principal.

## 6. Ordre exact

Les précédences narratives suivent la nomenclature directionnelle :

- `GROUNDS`, `BLOCKS`, `FEEDS`, `CAUSES` : source avant cible ;
- `IMPLEMENTS` : principe ou capacité cible avant son implémentation source ;
- `TESTS` : hypothèse cible avant le test source ;
- `SAFEGUARDS` : objet protégé avant son garde-fou ;
- `SUPPORTS_ESTIMATE`, `OBSERVES` : claim avant ses justifications ;
- `PART_OF`, `SUBCASE_OF` : ensemble ou cas général avant le détail ;
- provenance : à la fin.

Un tri topologique est exécuté. Les égalités sont résolues par phase narrative, importance décroissante puis identifiant stable. Si un cycle bloque le tri, le meilleur nœud selon ces trois critères est choisi. Le résultat reste reproductible.

## 7. Génération textuelle

Le générateur est extractif : il assemble `phrase` et `summary` sans inventer de causalité, résultat ou mesure. Un modèle de langage pourra ultérieurement reformuler le `PresentationPlan`, mais ne devra pas modifier l’ordre, les relations, les statuts ou les sources.

Chaque relation est traduite par un verbe directionnel propre au prédicat : `CAUSES` devient « cause », `IMPLEMENTS` « met en œuvre », `MOTIVATES` « motive », `DEPENDS_ON` « dépend de », etc. Le type choisit uniquement le verbe ; il ne crée jamais une section éditoriale.

```text
L(e) = 0,55 poidsRelation(e)
     + 0,225 importance(source)
     + 0,225 importance(cible)
```

`L(e)` est normalisé dans le cluster. Les liens sont insérés dans la progression causale au moment où le dernier de leurs deux nœuds vient d’être présenté, puis triés par importance décroissante. La provenance reste à la fin. Le Markdown utilise des listes, les noms de nœuds en **gras**, les verbes et métadonnées en *italique* ; le rendu HTML conserve cette hiérarchie sémantique.

## 8. Interaction

Un double-clic sur un nœud récupère le cluster actif qui le contient, ou son cluster documentaire, calcule le plan et affiche le texte au-dessus du canvas. Fermer le panneau ne modifie ni la sélection, ni les filtres.

## 9. Audit de nomenclature

`auditPresentationNomenclature(ontology)` contrôle la nomenclature courante, la couverture des familles, la famille de chaque prédicat actif et son contrat source/cible. Les tests comparent dynamiquement leur couverture au schéma afin de rester valides lors d’une extension versionnée.
