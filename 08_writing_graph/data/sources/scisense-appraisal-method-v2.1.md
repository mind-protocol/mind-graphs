# Analyser une étude scientifique — méthode pas à pas (v2.1)

*Méthode SciSense d'évaluation critique et de synthèse des preuves*

Version 2.1 — 22 juillet 2026. Révision de la v2 restaurant six éléments concrets perdus lors de l'intégration de la note de révision, corrigeant une incohérence d'ordre, et articulant la méthode avec l'échelle de preuve du projet.

---

Trois choses distinctes se cachent souvent sous le mot « analyser » :

- **La complétude du rapport** — l'étude a-t-elle *dit* ce qu'elle a fait ? (guides de reporting : CONSORT, STROBE, PRISMA…)
- **Le risque de biais** — ce qu'elle a fait est-il *crédible* ? (RoB 2, ROBINS-I, AMSTAR-2…)
- **La certitude d'un corps de preuves** — que sait-on *vraiment* sur cette question, une fois toutes les études rassemblées, et **outcome par outcome** ? (GRADE)

Les trois se confondent constamment, y compris dans des articles publiés. Les tenir séparés est le premier réflexe méthodologique.

C'est aussi la ligne de partage entre la machine et l'humain, mais elle est plus fine qu'il n'y paraît. La complétude du reporting est automatisable (présence/absence d'items). Le risque de biais ne l'est **pas** : les *signalling questions* de RoB 2 demandent de juger, par exemple, si des déviations étaient « cohérentes avec l'intention ». Ce qui est automatisable, c'est **l'instruction du dossier**, pas le verdict. La formule juste est donc : **la machine assemble le dossier, l'humain signe le jugement.**

| La machine instruit | L'humain juge |
|---|---|
| Statut de rétractation ou de correction | Une déviation était-elle cohérente avec l'intention ? |
| Enregistrement au registre, et sa date | Un facteur de confusion non mesuré est-il plausible, et **dans quel sens pousse-t-il** ? |
| Concordance des outcomes protocole ↔ article | Le comparateur était-il loyal ? |
| Taux d'attrition par bras et leur déséquilibre | L'écart de population suffit-il à rétrograder pour caractère indirect ? |
| Présence et nature des déclarations de financement et de conflits d'intérêts | L'hétérogénéité observée a-t-elle une explication clinique ? |
| Cohérence statistique interne (statcheck, GRIM) | La taille d'effet est-elle cliniquement pertinente ? |
| Disponibilité effective des données et du code annoncés | |

Une étude ne « prouve » jamais rien seule. Elle apporte une pièce, avec une solidité variable, à un corpus.

---

## Étape 0 — Avant de lire : cadrer, et vérifier que l'article tient encore

Ne pas ouvrir un article sans savoir *pourquoi* on le lit. La rigueur exigée d'une lecture pour une décision réglementaire n'est pas celle d'une veille de signal.

**Contrôle préalable, en une minute.** Cet article a-t-il été **rétracté, corrigé, ou fait l'objet d'un *expression of concern*** ? (Retraction Watch, notices de l'éditeur, Crossref, PubPeer.) Ce contrôle passe avant tout le reste parce qu'il peut invalider tout le reste. Pour une revue systématique, il porte aussi sur les **études incluses** : une revue publiée avant la rétractation d'une de ses sources doit être réévaluée, même si la revue elle-même n'a jamais été touchée.

**Cadrer la question en PICO** (intervention) ou **PECO** (exposition) : Population, Intervention/Exposition, Comparateur, Outcome. Cela donne d'emblée la grille de lecture — et permet de repérer si l'étude répond à *votre* question ou à une question voisine. L'écart entre le PICO de l'étude et celui de la question, sur l'un des quatre créneaux, est le motif candidat de rétrogradation pour **caractère indirect** (étape 9).

**Fixer maintenant les outcomes critiques.** La liste des outcomes qui comptent — bénéfices **et** risques — se décide ici, avant d'ouvrir l'article, et c'est elle qui structurera le tableau final. Choisir les outcomes après lecture revient à sélectionner ceux qui donnent de belles lignes.

---

## Étape 1 — Identifier le design et le situer

Identifier le type d'étude *avant* toute chose : il détermine l'outil d'évaluation, les biais attendus et la force potentielle de la conclusion.

La hiérarchie des preuves (méta-analyses > ECR > cohortes > cas-témoins > séries de cas > précliniques > avis d'experts) est une **heuristique de départ, pas un verdict**, et elle se corrige de **deux** façons :

- **Par l'exécution.** Un ECR mal conduit, sous-dimensionné, à outcome de substitution, vaut moins qu'une grande cohorte bien menée. Le design fixe le plafond de crédibilité ; l'exécution fixe le niveau réel.
- **Par la question.** Pour un **effet indésirable rare**, un **pronostic**, un **usage en vie réelle** ou une question d'**implémentation**, l'observationnel n'est pas un pis-aller : c'est le bon design. Un ECR n'a ni la taille ni la durée pour capter un harm à 1/10 000, et il exclut souvent la population réellement traitée. La hiérarchie ne se choisit donc pas dans l'absolu — elle dépend de l'outcome visé.

Attention aux faux amis : un « essai » peut être non randomisé ; une « étude prospective » n'est pas nécessairement comparative ; une revue « narrative » n'est pas une revue systématique.

---

## Étape 2 — Lire dans le bon ordre (pas linéairement)

L'ordre de lecture le plus trompeur est celui de l'article. La discussion est la plaidoirie des auteurs ; il faut avoir instruit le dossier avant de l'entendre.

1. **Titre** — design, population, outcome annoncés.
2. **Abstract** — pour l'orientation, avec méfiance : c'est la vitrine, souvent la partie la plus optimiste.
3. **Méthodes — avant les résultats.** C'est là que se joue la validité. Lire les méthodes en se demandant : *si cette étude était biaisée, où le biais se logerait-il ?*
4. **Résultats bruts** — tableaux et figures d'abord, texte ensuite. Les chiffres, pas leur narration.
5. **Discussion — en dernier**, comme une hypothèse d'interprétation à confronter, non comme une conclusion.

---

## Étape 3 — Évaluer la validité interne avec l'outil adapté

Le risque de biais s'évalue avec l'instrument correspondant au design. Utiliser le mauvais outil (par exemple RoB 2 sur une étude observationnelle) est une **erreur de catégorie**, pas une maladresse.

| Design | Outil de risque de biais | Guide de reporting associé |
|---|---|---|
| Essai contrôlé randomisé | **RoB 2** (2019) | CONSORT |
| Étude d'intervention non randomisée | **ROBINS-I** (2016) | TREND / STROBE |
| Observationnelle étiologique (exposition) | **ROBINS-E** ou Newcastle-Ottawa | STROBE |
| Revue systématique / méta-analyse | **AMSTAR-2** (2017) | PRISMA |
| Précision diagnostique | **QUADAS-2** (2011) | STARD |
| Pronostic — facteur pronostique | **QUIPS** | REMARK |
| Pronostic — modèle prédictif | **PROBAST** (2019) | TRIPOD |
| Étude animale préclinique | **SYRCLE** (2014) | ARRIVE |

Repères sur les principaux outils :

- **RoB 2** (ECR) — 5 domaines : processus de randomisation, déviations par rapport aux interventions prévues, données d'outcome manquantes, mesure de l'outcome, sélection du résultat rapporté.
- **ROBINS-I** (non randomisé) — 7 domaines, dont la **confusion** (le domaine décisif : sans randomisation, l'effet observé peut refléter le fait que les groupes différaient déjà) et le biais de sélection des participants.
- **AMSTAR-2** (revues) — 16 items, dont **7 critiques** : protocole enregistré *a priori*, exhaustivité de la recherche, justification des exclusions d'études, évaluation du risque de biais des études incluses, méthodes méta-analytiques appropriées, prise en compte du risque de biais dans l'interprétation, évaluation du biais de publication. Quatre niveaux de confiance : **élevée** (aucune faille critique, au plus une faiblesse non critique), **modérée** (aucune faille critique, plusieurs faiblesses non critiques), **faible** (**une** faille critique), **critiquement basse** (**plus d'une** faille critique). Une revue critiquement basse ne sert pas de base à une synthèse, quel que soit le prestige de la revue qui la publie.

**Juger aussi la direction du biais, pas seulement sa présence.** Pour chaque domaine à risque, se demander si le biais **gonfle ou atténue** l'effet observé. La distinction est décisive : un biais qui atténue un effet déjà significatif **renforce** la conclusion au lieu de l'affaiblir, tandis qu'un biais qui gonfle un effet marginal la détruit. Un risque de biais « élevé » sans direction est une information à moitié inutilisable.

Distinguer toujours **reporting** et **biais** : une étude peut être parfaitement rapportée selon CONSORT et néanmoins profondément biaisée, et inversement. Les guides de reporting mesurent ce qui est *dit*, pas ce qui est *bien fait*.

---

## Étape 4 — Décortiquer les méthodes

**Population.** Critères d'inclusion/exclusion : la population est-elle représentative de celle qui vous intéresse, ou triée pour maximiser l'effet (patients jeunes, mono-pathologiques) ? Suivre le **flow diagram** : combien de sujets recrutés, randomisés, analysés, perdus de vue ? Une attrition élevée ou déséquilibrée entre bras est un signal fort.

**Intervention/exposition et comparateur.** Le comparateur est le point le plus souvent négligé. Placebo là où le standard de soin existe ? Dose ou schéma sous-optimal du comparateur ? Un effet « supérieur » face à un bras affaibli n'est pas un effet.

**Outcomes.** L'outcome primaire est-il **pré-spécifié** et unique ? Cliniquement dur (mortalité, événement) ou **de substitution** (marqueur, imagerie, biomarqueur) ? Un critère de substitution n'est valide que si le lien avec le bénéfice clinique est établi. Méfiance envers les **critères composites** qui mélangent des événements d'importance très inégale. Comparer les outcomes de l'article au **protocole/registre** (ClinicalTrials.gov, PROSPERO) pour détecter l'*outcome switching* — un critère secondaire promu primaire après coup parce qu'il est devenu significatif.

**Taille d'échantillon et puissance.** Un calcul *a priori* fondé sur une taille d'effet réaliste, ou un effet postulé irréaliste pour justifier un petit échantillon ? Un essai « négatif » sous-puissant ne démontre pas l'absence d'effet.

**Analyse statistique.** Analyse en **intention de traiter** (ITT) ou en per-protocole (plus fragile, réintroduit le biais que la randomisation avait neutralisé) ? Gestion des données manquantes (imputation, sensibilité) ? Ajustement sur covariables pré-spécifié ou choisi après coup ? **Multiplicité** : des dizaines de tests sans correction produisent mécaniquement des faux positifs. Analyses de sous-groupes **pré-spécifiées** ou pêche aux résultats (*data dredging*) ?

*Formulation moderne :* le cadre des **estimands** (ICH E9(R1)) pose mieux la question que l'opposition ITT/per-protocole. Il demande explicitement ce que l'on fait des **événements intercurrents** — arrêt de traitement, traitement de secours, décès — et dissout ainsi la plupart des faux débats sur la population d'analyse.

---

## Étape 5 — Lire les résultats correctement

**La taille d'effet avant la significativité.** La première question n'est pas « est-ce significatif ? » mais « de combien ? ».

**Absolu vs relatif.** Une réduction *relative* du risque de 50 % impressionne ; si le risque passe de 2 % à 1 %, la réduction *absolue* est de 1 point (NNT = 100). Toujours ramener au niveau absolu.

| Mesure | Nature | À surveiller |
|---|---|---|
| Différence de moyennes | Continu | Pertinence clinique du delta (MCID) |
| RR (risque relatif) | Binaire | Relatif — masque le risque de base |
| OR (odds ratio) | Binaire | Surestime le RR quand l'événement est fréquent |
| HR (hazard ratio) | Survie | Suppose des risques proportionnels |
| RAR / ARR + **NNT / NNH** | Binaire | La lecture la plus honnête pour décider |

**L'intervalle de confiance à 95 % plutôt que la p-value.** L'IC donne la précision *et* le sens : inclut-il l'effet nul (1 pour un ratio, 0 pour une différence) ? Et surtout, sa borne la plus défavorable franchit-elle le **seuil de pertinence clinique** ? Un résultat « significatif » dont tout l'IC reste sous le seuil de pertinence est statistiquement réel et cliniquement vide.

**p ≠ importance.** La significativité statistique dépend autant de la taille de l'échantillon que de l'effet. Distinguer significativité statistique et pertinence clinique (**MCID**). Le MCID n'est pas une constante de la nature : il est lui-même **estimé, contesté et dépendant de la population**. Citer sa source, ou reconnaître qu'on n'en a pas.

**Cohérence interne.** Les chiffres du texte, des tableaux et des figures concordent-ils ? Les dénominateurs sont-ils stables d'un tableau à l'autre ? Des contrôles automatisables (statcheck sur la cohérence des tests, GRIM sur les moyennes de données entières) signalent l'incohérence — mais détectent l'incohérence, jamais la justesse.

**Sous-groupes.** À traiter comme génératrices d'hypothèses, jamais comme conclusions — sauf interaction pré-spécifiée et testée formellement.

### Cas particulier du diagnostic : la prévalence commande

Sensibilité et spécificité décrivent le **test** ; elles ne décident de rien seules. Ce qui compte en pratique, ce sont la **valeur prédictive positive (VPP)** et la **valeur prédictive négative (VPN)**, qui dépendent du **taux de base** dans la population testée.

*Le chiffre qui doit rester en tête.* Un test à 95 % de sensibilité et 95 % de spécificité, appliqué à une condition présente chez 1 % des personnes : sur 10 000 personnes, 95 vrais positifs et 495 faux positifs. **VPP ≈ 16 % — cinq fausses alertes pour une vraie.** C'est la mécanique exacte de la **fatigue d'alarme**, et la raison pour laquelle un test validé en population clinique s'effondre en dépistage de masse.

Quatre contrôles :

- **Prévalence** dans l'étude *et* dans la population visée. Si elles diffèrent, les valeurs prédictives publiées ne sont pas transposables.
- **Biais de spectre** — un test évalué sur des cas typiques contre des témoins sains surestime sa performance. C'est le mécanisme par lequel la plupart des tests se dégradent en conditions réelles.
- **Standard de référence** — quel est-il, et est-il **indépendant** du test évalué ? Un standard contaminé par le test fabrique de la performance.
- **Coût asymétrique des deux erreurs** — le seuil optimal d'un test de dépistage n'est pas celui d'un test de confirmation. Le seuil est un choix, pas une propriété.

---

## Étape 6 — Les effets indésirables (angle mort par défaut)

Les harms exigent une lecture séparée, car les règles y sont inversées par rapport à l'efficacité :

- **Sous-puissance.** Les essais sont dimensionnés pour l'efficacité, pas pour détecter un événement rare. Une absence de signal de harm dans un ECR ne vaut pas absence de harm. Vérifier si un calcul de puissance existait pour les harms — il n'existe presque jamais.
- **Mode de recueil.** **Actif** (questionnaire systématique à chaque visite) ou **passif** (déclaration spontanée) ? Le recueil passif sous-estime massivement. La classification est-elle standardisée (MedDRA, CTCAE) ou libre et agrégée en catégories vagues (« troubles gastro-intestinaux ») ?
- **Que rapporte-t-on exactement ?** Le nombre de **patients touchés** ou le nombre d'**événements** ? Les deux ne se comparent pas. Les **arrêts pour effet indésirable** et les sorties d'étude sont souvent l'indicateur le plus honnête, car ils résistent mal à la sous-déclaration : un patient qui abandonne laisse une trace même quand l'effet n'est pas codé.
- **Le design juste n'est pas l'ECR.** Pour les événements rares ou à latence longue, l'**observationnel** — grandes cohortes, bases de pharmacovigilance, registres — est souvent *supérieur* à l'ECR. Application directe de l'étape 1 : le design se choisit selon l'outcome.
- **Asymétrie de reporting.** Le même article peut détailler le bénéfice sur trois tableaux et expédier les harms en une ligne. L'asymétrie de traitement entre bénéfice et risque est elle-même un signal.

**Une conclusion de sécurité tirée d'un essai d'efficacité est une conclusion sur l'ignorance de cet essai, pas sur la sécurité du produit.** Pour un système qui doit décider d'alerter un humain, c'est l'omission la plus coûteuse : le harm est précisément ce que la lecture centrée efficacité laisse passer.

---

## Étape 7 — Validité externe, applicabilité et hétérogénéité

Une étude interne­ment valide peut être inapplicable. La population, le contexte de soins, les co-traitements, l'intensité du suivi ressemblent-ils à votre situation cible ? Validité interne et externe sont deux jugements séparés : la première conditionne la seconde, elle ne la garantit pas.

**Pour une méta-analyse, l'applicabilité se joue sur l'hétérogénéité, pas sur l'effet poolé.**

- **I²** quantifie la **part** de variabilité due à l'hétérogénéité entre études plutôt qu'au hasard. C'est un ratio, pas une ampleur : un I² élevé sur des effets tous cliniquement négligeables n'a pas la même portée qu'un I² élevé sur des effets opposés. À interpréter, jamais à seuiller mécaniquement.
- **τ²** mesure la variance entre études **dans l'unité de l'effet**. C'est lui qui dit l'ampleur de la dispersion, là où I² n'en dit que la part.
- **Modèle fixe vs aléatoire** : le fixe suppose un effet vrai unique ; l'aléatoire, une distribution d'effets vrais — plus réaliste dès qu'il y a hétérogénéité clinique. Le choix doit être justifié, pas subi.
- **L'intervalle de prédiction** est plus informatif que l'IC du poolé pour la transportabilité. L'IC décrit l'incertitude autour de l'effet *moyen* des études incluses ; l'intervalle de prédiction décrit la fourchette de l'effet vrai attendu dans un **nouveau** contexte. Un poolé « significatif » dont l'intervalle de prédiction **traverse le nul** est un piège classique : en moyenne un effet existe, mais dans un cadre nouveau il pourrait être nul ou inversé.

**Puis expliquer, pas seulement mesurer.** Chercher la source de l'hétérogénéité — population, dose, durée, risque de base, année, qualité méthodologique — par méta-régression ou analyse en sous-groupes pré-spécifiée. Une hétérogénéité expliquée devient une information sur *pour qui* le traitement marche ; une hétérogénéité seulement quantifiée reste un aveu d'ignorance.

---

## Étape 8 — Biais au-delà de l'étude

- **Financement et conflits d'intérêts.** Qui finance ? Le sponsor a-t-il eu un rôle dans le design, l'analyse, la rédaction, la décision de publier ?
- **Biais de publication et de reporting.** Les résultats négatifs se publient moins, plus tard, dans des revues moins visibles. Le protocole et le plan d'analyse statistique sont-ils publics et antérieurs aux résultats ?
- **Disponibilité des données.** Données ouvertes, code disponible, principes FAIR ? Vérifier que les données annoncées comme disponibles le sont **effectivement**. L'irreproductibilité est un signal en soi.

*(Le contrôle de rétractation, longtemps rangé ici, a été remonté à l'étape 0 : il conditionne l'utilité de tout le reste.)*

---

## Étape 9 — Certitude du corpus, par outcome : GRADE

C'est ici que se situe le jugement proprement humain. **GRADE** n'évalue pas une étude mais la **certitude d'un corps de preuves pour un outcome donné** — et un corpus peut être de certitude élevée sur le bénéfice et très faible sur le risque.

Le niveau de départ dépend du design (élevé pour les ECR, faible pour l'observationnel), puis on ajuste :

**Rétrograder** pour cinq raisons :
1. Risque de biais (limites méthodologiques des études incluses, avec leur direction)
2. Incohérence (hétérogénéité inexpliquée — I², τ² et intervalle de prédiction, étape 7)
3. Caractère indirect (population, intervention, comparateur ou outcome éloignés de la question — l'écart PICO de l'étape 0)
4. Imprécision (IC large, peu d'événements)
5. Biais de publication (suspicion de résultats manquants)

**Rehausser** pour trois raisons (surtout pour l'observationnel — le mécanisme qui fait qu'un corpus observationnel sur un harm rare peut néanmoins emporter la conviction) :
1. Effet de grande ampleur
2. Gradient dose-réponse
3. Facteurs de confusion plausibles qui auraient dû atténuer l'effet observé

On aboutit à quatre niveaux — certitude **élevée, modérée, faible, très faible** — qui qualifient ce que l'on sait, non ce qu'une étude a montré.

**Trois échelles à ne jamais confondre.** Le projet manipule des gradations différentes qui répondent à des questions différentes :

| Échelle | Répond à | Ne dit pas |
|---|---|---|
| Barreau de preuve (assertion, jugement attribué, simulation, monde réel) | **sur quoi tient** cette affirmation aujourd'hui | à quel point elle est sûre |
| Certitude GRADE (élevée → très faible) | **ce qu'on sait** d'un outcome, tout corpus rassemblé | ce qu'on a le droit de faire |
| Matrice de permissions | **ce qu'on a le droit de faire** avec cette affirmation | sur quoi elle tient |

En particulier : le barreau « monde réel » recouvre aussi bien une observation isolée qu'une méta-analyse d'essais randomisés. **C'est précisément ce barreau que la présente méthode raffine** — GRADE est ce qui distingue, à l'intérieur du monde réel, ce qui tient de ce qui ne tient pas. Et **GRADE produit une certitude, pas une permission** : « certitude modérée » ne dit pas quelle action est autorisée. Le passage de la certitude aux droits d'action est un choix de gouvernance, extérieur à la méthode.

---

## Étape 10 — Synthèse : le Summary of Findings

Le livrable n'est **pas** un verdict unique. C'est un **Summary of Findings** : une ligne par outcome critique — ceux fixés à l'étape 0, avant lecture — chacune avec son effet absolu, son intervalle, l'effectif qui le porte et sa certitude propre.

| Outcome | Effet absolu (IC 95 %) | Participants / études | Certitude (GRADE) | Motif dominant de rétrogradation |
|---|---|---|---|---|
| Bénéfice principal | | | | |
| Bénéfice secondaire | | | | |
| Harm principal | | | | recueil actif ou passif ? |
| Harm rare / grave | | | | design adapté à l'événement ? |

La colonne **participants / études** n'est pas décorative : un IC serré sur 40 événements ne se lit pas comme un IC serré sur 4 000, et c'est elle qui rend l'imprécision visible.

Puis, pour chaque outcome, formuler en clair :

1. **Ce que montre le corpus** — l'effet, en valeur absolue et avec son intervalle.
2. **Avec quelle certitude** — le motif dominant de rétrogradation et **la direction probable** du biais.
3. **Pour qui** — la population et le contexte auxquels le résultat s'applique.
4. **Ce que ça change** — l'apport réel au corpus existant, et les incertitudes résiduelles.

Le verdict unique était l'erreur : il écrase la distinction bénéfice/risque, qui est précisément celle qui décide. Une certitude élevée sur le bénéfice n'autorise rien si la certitude sur les risques est très faible.

---

## La méthode est une preuve périssable

Les instruments datent : RoB 2 de 2019, AMSTAR-2 de 2017, PROBAST de 2019, QUADAS-2 de 2011, SYRCLE de 2014 ; ROBINS-E est plus récent et a connu plusieurs versions de travail — vérifier laquelle fait foi avant de l'appliquer. La méthode d'évaluation se soumet à sa propre règle de révision : elle porte une date de version et une date de revue, et se réexamine à la première échéance atteinte — le terme temporel, ou la publication d'une révision de l'un des instruments qu'elle cite.

---

## Aide-mémoire

- Vérifier la **rétractation en premier**, avant toute lecture — y compris sur les études incluses d'une revue.
- Fixer les **outcomes critiques avant** d'ouvrir l'article, bénéfices et risques.
- Séparer *reporting*, *risque de biais*, *certitude du corpus* — trois questions, trois outils.
- La machine assemble le dossier (registre, outcome switching, attrition, rétractation, COI, cohérence stat) ; l'humain signe le jugement.
- Choisir le design selon la **question**, pas seulement selon la hiérarchie (harms rares, pronostic, vie réelle → observationnel).
- Choisir l'outil selon le design. AMSTAR-2 : 1 faille critique → « faible » ; >1 → « critiquement basse ».
- Juger la **direction** du biais, pas seulement sa présence.
- Méthodes avant résultats, discussion en dernier.
- Outcome primaire pré-spécifié ? Comparer au protocole enregistré.
- Taille d'effet et IC95 % avant la p-value ; absolu avant relatif ; NNT/NNH ; MCID sourcé.
- Diagnostic : VPP/VPN dépendent de la prévalence — 95/95 à 1 % donne 16 % de VPP. Biais de spectre, standard de référence, seuil asymétrique.
- Harms : sous-puissance, recueil passif, patients ≠ événements, arrêts pour EI, asymétrie de reporting.
- Méta-analyse : I², τ², fixe/aléatoire, **intervalle de prédiction** pour la transportabilité — puis expliquer l'hétérogénéité.
- Une étude n'est pas une preuve : GRADE juge la certitude d'un corpus, **par outcome**, et livre un Summary of Findings — pas un verdict unique.
- Barreau de preuve ≠ certitude ≠ permission. GRADE raffine le barreau « monde réel » ; il n'autorise aucune action par lui-même.

---

*SciSense — Making Science Make Sense*
