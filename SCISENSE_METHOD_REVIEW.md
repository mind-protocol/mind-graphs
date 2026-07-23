# Note de révision — méthode SciSense d'analyse d'une étude

> **Statut : résolue le 22 juillet 2026.** Les huit points et les trois réserves de cette note sont intégrés dans la v2.1, conservée en source datée et hachée : [`data/sources/scisense-appraisal-method-v2.1.md`](data/sources/scisense-appraisal-method-v2.1.md), extraite dans le cluster `evidence-appraisal-method`. Cette note est gardée comme trace du raisonnement de révision, pas comme travail en attente.
>
> Restent hors périmètre, désormais portées par des `open_question` du graphe : le passage de la certitude aux droits d'action (`question-ladder-from-quality-vector`), le grain trop grossier du barreau « monde réel » (`question-real-world-rung-is-too-coarse`) et l'articulation des deux traditions (`question-causal-and-synthesis-traditions`).

Révision du 22 juillet 2026, portant sur la version « Analyser une étude scientifique — méthode pas à pas ».

Cette note ne réécrit pas la méthode : elle liste huit défauts, explique pourquoi chacun compte, et propose un texte prêt à insérer. L'ordre suit l'impact décroissant. Le but est de corriger le document **avant** de le transformer en ontologie du graphe scientifique, pour ne pas graver ses angles morts dans le schéma.

Rappel du point de départ : la méthode est solide. La séparation reporting / risque de biais / certitude du corpus en ouverture, l'ordre de lecture, l'absolu avant le relatif, et le test « la borne défavorable de l'IC franchit-elle le seuil de pertinence ? » sont des choix justes et rarement tenus. Les corrections ci-dessous portent sur ce qui manque, pas sur ce qui est faux.

---

## 1. Le livrable final est sous-dimensionné : GRADE se juge par outcome

**Le défaut.** L'étape 8 énonce correctement que GRADE évalue « la certitude d'un corps de preuves **pour un outcome donné** ». L'étape 9 produit ensuite un verdict unique en quatre phrases. Les deux sont incompatibles.

**Pourquoi ça compte.** Une même étude peut soutenir un bénéfice avec une certitude modérée et un profil de risque avec une certitude très faible. Le verdict unique écrase exactement la distinction sur laquelle se prend la décision. C'est aussi le point où une synthèse honnête se distingue d'un résumé promotionnel : le résumé donne une conclusion, la synthèse donne un tableau.

**Texte proposé** — remplacer l'étape 9 :

> ## Étape 9 — Synthèse : un tableau, pas une phrase
>
> Le livrable d'une évaluation n'est pas une conclusion unique mais un **tableau récapitulatif des résultats** (Summary of Findings) : **une ligne par outcome critique**, bénéfices *et* risques, chacune portant :
>
> | Outcome | Effet absolu (IC 95 %) | Nb de participants / d'études | Certitude (GRADE) | Motif principal de rétrogradation |
> |---|---|---|---|---|
>
> Les outcomes critiques sont choisis **avant** la lecture, à l'étape 0, avec la question PICO. On ne sélectionne pas après coup les outcomes qui donnent une belle ligne.
>
> Pour chaque ligne, formuler ensuite en clair :
>
> 1. **Ce que montre le corpus** — l'effet, en valeur absolue et avec son intervalle.
> 2. **Avec quelle certitude** — le niveau GRADE et le motif dominant de rétrogradation.
> 3. **Pour qui** — la population et le contexte auxquels le résultat s'applique.
> 4. **Ce que ça change** — l'apport réel au corpus existant, et les incertitudes résiduelles.
>
> Une certitude élevée sur le bénéfice n'autorise rien si la certitude sur les risques est très faible. Les deux lignes se lisent ensemble.

---

## 2. Les effets indésirables n'ont aucune étape

**Le défaut.** Aucune section ne traite des harms. Ils apparaissent au mieux implicitement comme un outcome parmi d'autres.

**Pourquoi ça compte.** C'est l'omission la plus coûteuse du document, et elle est structurelle plutôt qu'accidentelle : les effets indésirables obéissent à une logique inverse de celle des bénéfices. Ils sont rarement l'outcome primaire, donc jamais dimensionnés pour être détectés ; ils sont mal définis a priori et collectés de façon non standardisée ; et pour les événements rares, un ECR est **structurellement incapable** d'en dire quoi que ce soit — une grande base observationnelle fait mieux. Appliquer la hiérarchie des preuves aux harms comme aux bénéfices conduit donc systématiquement à conclure « pas de signal de sécurité » là où l'étude était simplement aveugle.

**Texte proposé** — nouvelle étape, à insérer après l'étape 5 :

> ## Étape 5 bis — Les effets indésirables se lisent à l'envers
>
> Les harms ne s'évaluent pas comme les bénéfices. Quatre réflexes distincts :
>
> - **L'absence de signal n'est pas un signal d'absence.** Une étude dimensionnée pour détecter un bénéfice n'a presque jamais la puissance de détecter un risque rare. Vérifier si un calcul de puissance existait pour les harms — il n'existe presque jamais.
> - **Comment ont-ils été collectés ?** Recueil spontané ou questionnaire systématique ? Le recueil spontané sous-estime massivement. La classification est-elle standardisée (MedDRA, CTCAE) ou libre ?
> - **Que rapporte-t-on ?** Le nombre de patients touchés, ou le nombre d'événements ? Les arrêts pour effet indésirable et les sorties d'étude sont souvent l'indicateur le plus honnête, car ils résistent mal à la sous-déclaration.
> - **Pour les risques rares, changer de design.** L'observationnel de grande taille, la pharmacovigilance et les registres ne sont pas ici un pis-aller : ce sont les seules sources capables de les voir.
>
> Une conclusion de sécurité tirée d'un essai d'efficacité est une conclusion sur l'ignorance de cet essai, pas sur la sécurité du produit.

---

## 3. La hiérarchie est relative à l'exécution — elle est aussi relative à la question

**Le défaut.** L'étape 1 corrige bien la hiérarchie par la qualité d'exécution : « un ECR mal conduit vaut moins qu'une grande cohorte bien menée ». Mais elle laisse entendre qu'à qualité égale l'ECR gagne toujours.

**Pourquoi ça compte.** Pour plusieurs classes de questions, l'observationnel est le **bon** design, pas un substitut dégradé : effets indésirables rares, pronostic, usage en vie réelle, effets à très long terme, questions où la randomisation est impossible ou non éthique, recherche d'implémentation. Présenter ces travaux comme intrinsèquement inférieurs conduit à écarter les meilleures preuves disponibles sur ces questions.

**Texte proposé** — ajouter à la fin de l'étape 1 :

> La hiérarchie ne se corrige pas seulement par la qualité d'exécution : elle **dépend de la question posée**. Pour les effets indésirables rares, le pronostic, l'usage en vie réelle, les effets à long terme et les questions non randomisables, un design observationnel bien conduit constitue la meilleure preuve disponible, non un pis-aller. Le bon réflexe n'est pas « quel est le design le plus élevé ? » mais « quel design peut répondre à *cette* question ? ».

---

## 4. Rien sur l'hétérogénéité, alors qu'elle décide de l'applicabilité

**Le défaut.** L'incohérence apparaît comme motif de rétrogradation GRADE à l'étape 8, mais aucune étape n'explique comment la lire. Ni modèle fixe/aléatoire, ni I², ni surtout intervalle de prédiction.

**Pourquoi ça compte.** L'intervalle de confiance d'un effet poolé décrit la précision de la **moyenne** des études incluses. Il ne dit rien de ce qu'on observerait dans un nouveau contexte. C'est l'**intervalle de prédiction** qui répond à cette question — et il est souvent bien plus large, parfois au point de traverser le nul quand l'IC ne le traverse pas. Comme la méthode s'adresse à des lecteurs qui veulent transposer un résultat à leur situation (étape 6), c'est précisément la statistique qui leur manque.

**Texte proposé** — à insérer dans l'étape 5, après « Intervalle de confiance » :

> **Pour une méta-analyse : hétérogénéité et intervalle de prédiction.** Un modèle à effets fixes suppose un effet vrai unique ; un modèle à effets aléatoires suppose une distribution d'effets vrais. Le choix doit être justifié, pas subi.
>
> - **I²** exprime la part de variabilité attribuable à l'hétérogénéité plutôt qu'au hasard. Ce n'est pas une mesure de l'ampleur de l'hétérogénéité, et un I² faible sur peu d'études ne prouve rien.
> - **τ²** mesure la variance entre études, dans l'unité de l'effet.
> - **L'intervalle de prédiction** indique l'intervalle dans lequel se situerait l'effet d'une **nouvelle** étude. C'est lui, et non l'IC du poolé, qu'il faut regarder pour transposer un résultat à un nouveau contexte. Un poolé « significatif » dont l'intervalle de prédiction traverse le nul signale que le résultat n'est pas transportable en l'état.
>
> Chercher ensuite l'explication de l'hétérogénéité (population, dose, durée, risque de base) plutôt que se contenter de la mesurer.

---

## 5. Rien sur la prévalence en précision diagnostique

**Le défaut.** QUADAS-2 et STARD figurent dans la table, mais aucune étape ne rappelle que sensibilité et spécificité ne suffisent pas à décider.

**Pourquoi ça compte.** Sensibilité et spécificité sont des propriétés du test ; VPP et VPN dépendent du **taux de base** dans la population testée. Un test à 95 % de sensibilité et 95 % de spécificité appliqué à une condition présente chez 1 % des personnes produit environ 16 % de vrais positifs parmi les positifs : cinq alertes fausses pour une vraie. C'est le mécanisme exact de la fatigue d'alarme, et c'est aussi ce qui rend dangereux le passage d'un test validé en population clinique à un dépistage en population générale.

**Texte proposé** — nouvelle sous-section dans l'étape 5 :

> **Précision diagnostique : la prévalence commande.** La sensibilité et la spécificité décrivent le test ; elles ne décident rien seules. Les valeurs prédictives — la probabilité qu'un positif soit un vrai positif — dépendent du taux de base dans la population où le test est appliqué. Toujours vérifier :
>
> - la **prévalence dans l'étude** et celle de la population visée ; si elles diffèrent, les valeurs prédictives publiées ne sont pas transposables ;
> - le **spectre des patients** : un test évalué sur des cas typiques contre des témoins sains surestime sa performance (biais de spectre) ;
> - le **standard de référence** et son indépendance vis-à-vis du test évalué ;
> - le **coût asymétrique** des deux erreurs : le seuil optimal d'un test de dépistage n'est pas celui d'un test de confirmation.
>
> Un excellent test appliqué à une condition rare produit surtout des faux positifs. Ce n'est pas un défaut du test, c'est une propriété de la situation.

---

## 6. Le contrôle de rétractation est absent

**Le défaut.** L'étape 7 couvre financement, conflits d'intérêts, biais de publication et disponibilité des données, mais jamais la question la plus simple : cet article est-il toujours valide ?

**Pourquoi ça compte.** C'est le contrôle le moins coûteux du document et l'un des rares entièrement automatisables. Les articles rétractés continuent d'être cités des années après leur rétractation, souvent sans mention. Un corpus qui ne vérifie pas ce statut hérite mécaniquement de résultats invalidés.

**Texte proposé** — à ajouter en tête de l'étape 7 :

> - **Statut de l'article.** Rétracté, corrigé, ou objet d'une expression of concern ? Vérifier avant toute lecture approfondie (base Retraction Watch, notices Crossref, page de l'éditeur). Ce contrôle prend une minute et invalide parfois tout le reste. Pour une revue systématique, il porte aussi sur les **études incluses** : une revue publiée avant la rétractation d'une de ses études sources doit être réévaluée.

---

## 7. La frontière machine / humain est mal tracée

**Le défaut.** Le document affirme que « les deux premières couches sont largement automatisables, la troisième reste un jugement ».

**Pourquoi ça compte.** La première moitié est vraie, la seconde ne l'est pas. La complétude du reporting est bien automatisable : elle se ramène à la présence ou l'absence d'items. Le risque de biais ne l'est pas — les *signalling questions* de RoB 2 demandent de juger, par exemple, si des déviations à l'intervention étaient « cohérentes avec l'intention », ce qu'aucune extraction ne tranche. Revendiquer l'automatisation du risque de biais est un engagement intenable, et il est inutile : la frontière défendable est plus intéressante.

Ce qui est automatisable dans la couche 2, c'est **l'instruction du dossier**, pas le verdict. Et cette instruction a une valeur propre, car elle produit les signaux d'intégrité que la lecture humaine rate le plus souvent.

**Texte proposé** — remplacer la phrase de l'introduction et développer :

> Les trois couches ne s'automatisent pas de la même façon. La complétude du reporting se vérifie mécaniquement : un item est présent ou absent. La certitude d'un corps de preuves reste un jugement que rien ne remplace. **Le risque de biais est entre les deux, et la distinction est décisive : une machine peut instruire le dossier, elle ne peut pas signer le verdict.**
>
> Sont mécanisables, et méritent de l'être parce qu'un lecteur humain les rate systématiquement :
>
> - la **concordance au registre** — l'étude était-elle enregistrée, et avant l'inclusion du premier patient ?
> - l'**outcome switching** — comparaison automatique des outcomes du protocole et de l'article ;
> - les **taux d'attrition** par bras, et leur déséquilibre ;
> - le **statut de rétractation ou de correction** ;
> - la **présence et la nature des déclarations** de financement et de conflits d'intérêts ;
> - la **cohérence statistique interne** — concordance entre statistiques de test, degrés de liberté et p-values rapportées, plausibilité de moyennes au regard des tailles d'échantillon (statcheck, GRIM et outils apparentés) ;
> - la **disponibilité effective** des données et du code annoncés comme disponibles.
>
> Restent humains : juger si une déviation était cohérente avec l'intention, si un facteur de confusion non mesuré est plausible et dans quel sens il pousse, si un comparateur était loyal, si un écart de population suffit à rétrograder pour caractère indirect.

---

## 8. AMSTAR-2 : le second palier manque

**Le défaut.** Le document indique qu'« une seule faille critique fait basculer la confiance dans la revue à faible ». C'est exact mais incomplet.

**Texte proposé** — corriger la puce AMSTAR-2 de l'étape 3 :

> Le verdict global suit quatre niveaux : **élevé** (aucune faille critique, au plus une faiblesse non critique), **modéré** (aucune faille critique, plusieurs faiblesses non critiques), **faible** (**une** faille critique), **critiquement bas** (**plus d'une** faille critique). Une revue critiquement basse ne doit pas servir de base à une synthèse, quel que soit le prestige de la revue qui la publie.

---

## Réserves mineures

- **Estimand.** Le document oppose ITT et per-protocole, ce qui reste la présentation classique mais date. Le cadre des **estimands** (ICH E9(R1)) formule mieux la question : que fait-on des événements intercurrents — arrêt de traitement, traitement de secours, décès ? Une mention suffirait, car ce cadre dissout la plupart des faux débats ITT/PP.
- **MCID.** Le seuil de pertinence clinique est invoqué à juste titre, mais rien ne dit d'où il vient. Un MCID est lui-même estimé, contesté, et dépendant de la population. Préciser qu'il faut citer sa source.
- **Certitude et direction du biais.** L'étape 9 demande « la direction probable » du biais, mais aucune étape n'apprend à l'établir. Ajouter à l'étape 3 : pour chaque domaine à risque, se demander si le biais gonfle ou atténue l'effet observé — un biais qui atténue un effet déjà significatif renforce la conclusion au lieu de l'affaiblir.

---

## Ce que cette révision ne corrige pas

Deux points sortent du périmètre d'une révision du texte et devront être tranchés séparément.

**GRADE produit une certitude, pas une permission.** Le document, même révisé, dit « certitude modérée ». Il ne dit pas quelles actions cette certitude autorise. Le passage certitude → droits d'action reste un choix de gouvernance, propre à chaque organisation et à chaque domaine, et il ne se déduit d'aucun instrument méthodologique.

**Deux traditions cohabitent sans être articulées.** Identifiabilité, facteurs de confusion, médiateurs et transportabilité viennent de l'inférence causale. Risque de biais, réplication et certitude d'un corpus viennent de la synthèse de preuves. Elles se recouvrent partiellement — la transportabilité correspond assez bien au caractère indirect de GRADE — mais l'identifiabilité n'a pas d'équivalent GRADE, et GRADE n'a pas de notion de graphe causal. Toute ontologie qui veut porter les deux doit expliciter leur correspondance plutôt que les juxtaposer.

---

## Péremption de la méthode elle-même

La méthode est une preuve périssable et doit se soumettre à sa propre règle. AMSTAR-2 date de 2017, RoB 2 de 2019 ; ROBINS-E est plus récent et encore en évolution ; les guides de reporting et GRADE reçoivent des mises à jour régulières. Ce document doit donc porter une **date de version et une date de revue**, et être réexaminé à la première des deux échéances : le terme temporel, ou la publication d'une révision de l'un des instruments qu'il cite.
