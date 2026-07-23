# P1 — Modèle d'agents exécutable

## Résultat

Le P1 fournit un premier moteur déterministe capable de simuler 100 000 personnes pendant 120 jours dans trois économies comparables : actuelle, hybride et Mind. Il exécute les mêmes tendances d'emploi, pénuries, pannes, attaques Sybil, pressions spéculatives, migrations et captures de gouvernance dans chaque bras.

Ce modèle est un instrument de spécification. Ses paramètres initiaux sont des hypothèses de travail et ses sorties ne sont pas des estimations du monde réel.

## Fichiers

- `simulation/config.schema.json` : contrat de configuration ;
- `simulation/default-config.json` : hypothèses initiales visibles ;
- `src/simulation/model.js` : population, économie, chocs et agrégation ;
- `src/simulation/rng.js` : générateur pseudo-aléatoire reproductible ;
- `src/simulation/metrics.js` : Gini et couverture par décile ;
- `scripts/run-simulation.js` : interface en ligne de commande ;
- `simulation/sensitivity-config.json` : plages exploratoires de l’analyse P2 ;
- `simulation/behavior-profiles.json` : trois scénarios comportementaux explicites ;
- `src/simulation/sensitivity.js` : matrice un-paramètre-à-la-fois et détection des inversions de classement ;
- `src/simulation/behavior-comparison.js` : comparaison des profils et stabilité des classements ;
- `scripts/run-sensitivity.js` : interface en ligne de commande P2 ;
- `test/simulation.test.js` : déterminisme, bornes et rejet des configurations invalides.

## Exécution

```powershell
npm test
npm run simulate:smoke
npm run simulate
npm run simulate:sensitivity:smoke
npm run simulate:sensitivity
npm run simulate:behaviors:smoke
npm run simulate:behaviors
```

Une configuration alternative peut être fournie avec :

```powershell
node scripts/run-simulation.js --config=simulation/default-config.json --population=100000 --days=120 --seed=20260720 --output=artifacts/simulation/alternative.json
```

## Modèle de population

Chaque personne possède un besoin vital quotidien, un revenu, une vulnérabilité, un groupe d'audit et un rang de revenu. Les distributions sont synthétiques et partagées à l'identique entre les trois bras. Les fournisseurs possèdent capacité et trésorerie.

Le moteur n'utilise pas encore de ménages explicites, de géographie, de réseau logistique ni de décisions d'investissement adaptatives. Ces limites empêchent toute interprétation empirique.

## Mécanismes comparés

- **Actuel** : faible transfert ciblé par le modèle, accumulation non limitée et prix fixe.
- **Hybride** : transfert quotidien plus élevé, accumulation non limitée et prix fixe.
- **Mind** : crédit quotidien, plafond de wallet, démurrage, prix contextuel et exposition aux attaques propres au protocole.

L'allocation est proportionnelle à la demande solvable quand l'offre manque. Ce choix est transparent mais simplifie fortement les files, priorités, stratégies et substitutions réelles.

## Sorties

Chaque bras exporte : couverture globale et par décile, besoins non satisfaits, Gini de capacité d'achat, survie des fournisseurs, jours de rupture, exclusion, écart de prix du groupe protégé, capture Sybil, champs de données requis et concentration de gouvernance.

Le run de référence à 100 000 personnes s'exécute en environ deux secondes sur l'environnement actuel. Les résultats se trouvent localement dans `artifacts/simulation/latest.json` et sont explicitement marqués `exploratory_model_output_not_empirical_evidence`.

## Lecture du premier run

Le paramétrage initial donne une couverture moyenne de 83,84 % au bras actuel, 91,16 % à l'hybride et 91,45 % à Mind. Cet écart décrit uniquement les règles choisies : Mind et l'hybride reçoivent ici des transferts supérieurs. Il ne constitue donc pas une preuve en faveur de Mind.

Le résultat utile du P1 est précisément cette mise en évidence : sans calibration, scénarios alternatifs et analyse de sensibilité, le modèle peut réciter ses paramètres. Le prochain verrou scientifique est de mesurer quelles hypothèses changent le classement des bras.

## P2 · Analyse de sensibilité

Le P2 fait varier un paramètre à la fois en conservant population synthétique, seed, horizon et chronologie des chocs. Pour chaque valeur, il recalcule les trois bras, classe leur `coverageRate` et indique les paires de bras dont l’ordre change par rapport à la baseline.

```powershell
npm run simulate:sensitivity
node scripts/run-sensitivity.js --population=5000 --days=120 --seed=20260720 --output=artifacts/simulation/sensitivity-alternative.json
```

La configuration versionnée se trouve dans `simulation/sensitivity-config.json`. Le rapport complet est écrit dans `artifacts/simulation/sensitivity-latest.json` et contient la baseline, les cas individuels, les écarts de métrique, les classements et une synthèse par paramètre.

Sur le run exploratoire de 5 000 personnes pendant 120 jours, cinq paramètres testés peuvent changer l’ordre des bras : l’offre par personne, les transferts hybride et Mind, l’intensité de la pénurie et la part Sybil. Le démurrage et le prix contextuel ne changent pas l’ordre dans les trois valeurs testées. Ce constat signifie uniquement que le classement interne du modèle est sensible aux premières hypothèses ; il ne valide aucune valeur, plage ou politique.

### Limites du P2

- Les plages testées sont des hypothèses exploratoires, pas des intervalles d’incertitude empiriques.
- La méthode un-paramètre-à-la-fois ne mesure pas les interactions entre paramètres.
- Un classement stable sur trois valeurs ne démontre pas la robustesse hors de cette plage.
- Une inversion de classement décrit le moteur actuel et ne constitue pas une estimation causale du monde réel.

## P3 · Profils comportementaux alternatifs

Le P3 exécute trois profils sur la même population synthétique, le même seed, le même horizon et les mêmes chocs :

1. `reference` : demande sans adaptation, dépense disponible complète et aucune substitution additionnelle ;
2. `cautious_households` : conservation d’une part de liquidité, réaction modérée au prix et participation Sybil plus faible ;
3. `adaptive_adversarial` : réaction forte au prix, substitution partielle de l’offre et participation Sybil accrue.

```powershell
npm run simulate:behaviors:smoke
npm run simulate:behaviors
```

Le rapport `artifacts/simulation/behavior-comparison-latest.json` conserve paramètres, hypothèses, métriques, classements et égalités pour chaque profil. Sur 5 000 personnes pendant 120 jours, le classement de couverture est `Mind > hybride > actuel` dans les profils référence et prudent, puis `hybride > Mind > actuel` dans le profil adaptatif/adversarial. Le classement d’exclusion reste `Mind > hybride > actuel`. La survie marchande vaut 1 dans tous les cas et doit donc être lue comme une égalité, pas comme un classement.

Les profils regroupent plusieurs hypothèses : le P3 teste la stabilité face à des scénarios cohérents, mais n’attribue pas une différence à un paramètre isolé. Il ne remplace ni calibration empirique, ni interactions factorielles, ni modèles comportementaux validés sur données.
