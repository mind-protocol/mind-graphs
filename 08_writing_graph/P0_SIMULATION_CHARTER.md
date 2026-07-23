# P0 — Charte de simulation de la ville 100 000

## Décision recherchée

Déterminer si une économie Mind mérite un prototype de terrain limité. Le P0 ne cherche pas à « prouver Mind », mais à produire des résultats capables de réfuter ses mécanismes, révéler leurs dommages ou justifier une expérimentation plus coûteuse.

## Question expérimentale

À population, ressources et chocs comparables, comment l'économie Mind modifie-t-elle l'accès aux biens de vie, la viabilité de l'offre, la distribution des ressources, la résilience et les libertés par rapport au système actuel et à un système hybride ?

## Trois bras comparables

1. **Actuel** — monnaie et protections sociales modélisées selon la baseline choisie.
2. **Hybride** — protections ou revenu de base sans prix exploratoire Mind.
3. **Mind** — domaine vital, crédit quotidien, non-accumulation et allocation contextuelle.

Les trois bras partagent population, capacités productives, stocks, géographie, chronologie et chocs. Les hypothèses propres à un bras sont listées séparément.

## Population synthétique

- 100 000 personnes organisées en ménages, quartiers, emplois et situations de santé variés ;
- producteurs, marchands, institutions, infrastructures et acteurs adversariaux ;
- distributions documentées plutôt qu'un « agent moyen » ;
- plusieurs modèles comportementaux plausibles avec analyses de sensibilité.

Chaque variable d'entrée possède une provenance, une transformation, une date, une licence et une limite connue. Les données manquantes sont visibles dans le rapport.

## Métriques pré-enregistrées

### Accès et distribution

- jours-personnes de besoins vitaux non satisfaits ;
- couverture du panier vital par décile et profil ;
- concentration des soldes et des capacités d'achat ;
- écarts injustifiés entre groupes et quartiers.

### Offre et résilience

- survie et trésorerie des fournisseurs ;
- ruptures, files, rationnement et temps de récupération ;
- investissement, renouvellement des stocks et capacité productive ;
- continuité pendant les pannes et modes dégradés.

### Libertés et dommages

- données personnelles requises ou quittant l'appareil ;
- exclusions, recours et décisions renversées ;
- capture Sybil, spéculation et concentration cachée ;
- pouvoir de gouvernance et capacité de sortie.

Les seuils de décision seront fixés après une étude pilote destinée uniquement à mesurer la variance. Aucun seuil ne sera choisi après consultation des résultats principaux.

## Stress tests P0

- pénurie alimentaire ou énergétique ;
- attaque Sybil adaptative ;
- panne réseau prolongée ;
- capture ou modification hostile de gouvernance ;
- marché secondaire et spéculation ;
- choc migratoire ou déplacement rapide de population.

Chaque choc garde la même intensité et la même chronologie dans les trois bras.

## Reproductibilité

Chaque exécution exporte la version du code, la configuration, les seeds aléatoires, les données redistribuables, les dépendances et les journaux d'événements. Une affirmation publique exige au moins une réplication hors de l'équipe et un rapport des résultats négatifs.

## Critères d'arrêt

Le P0 est arrêté ou redessiné si les résultats dépendent d'un seul comportement arbitraire, si un bras reçoit un avantage de ressources, si les données ne représentent pas les groupes exposés, si la réplication échoue ou si un dommage grave reste masqué par les moyennes.

## Livrables

1. dictionnaire de données et rapport de représentativité ;
2. spécification des agents et comportements ;
3. configuration des trois bras ;
4. bibliothèque de stress tests ;
5. registre pré-enregistré des métriques et critères d'arrêt ;
6. paquet reproductible et rapport d'incertitude ;
7. revue indépendante avant communication publique.

## Ce que cette charte ne prétend pas

Une simulation de ville ne démontre ni l'acceptabilité politique réelle, ni la conformité réglementaire, ni l'effet macroéconomique national. Elle sert à éliminer tôt les designs fragiles et à préciser les expériences suivantes.
