# Mind Causal Graph

Graphe local des hypothèses, mécanismes, scénarios, questions et états de **Mind Protocol**.

Ce dépôt est volontairement limité au raisonnement causal et au programme de validation. Les langues, systèmes d’écriture, recherches historiques, modèles Blender et vocabulaires de tatouage vivent désormais dans le sous-repo voisin `../tattoo-language-atlas/`.

Le corpus actif utilise l’ontologie `{{ontology.version}}`, qui distingue {{stats.nodeTypes}} types de nœuds sémantiques (projetés dans la couche physique L4 sur **5 rôles fondamentaux** : `actor`, `moment`, `narrative`, `space`, `thing`), {{stats.relationFamilies}} familles de relations et {{stats.activePredicates}} prédicats actifs. Chaque relation possède une justification textuelle obligatoire. L’ontologie porte un `causalContract` : un mécanisme n’est causalement complet que lorsqu’il affirme, par une arête `CAUSES` chiffrée (effectSizePct, confidenceScore, evidenceBasis), l’effet qu’il produit sur un `system_state` ou une `metric`.

Documentation complète : [`DOCUMENTATION.md`](DOCUMENTATION.md). Nomenclature : [`GRAPH_NOMENCLATURE.md`](GRAPH_NOMENCLATURE.md). Transformation des clusters : [`CLUSTER_PRESENTATION.md`](CLUSTER_PRESENTATION.md). UX spatiale : [`CITY_GARDEN_UX.md`](CITY_GARDEN_UX.md).

P0 expérimental : [`P0_SIMULATION_CHARTER.md`](P0_SIMULATION_CHARTER.md).

P1 exécutable : [`P1_AGENT_MODEL.md`](P1_AGENT_MODEL.md).

## Travail autonome dans le graphe

Le cluster `project-work` est le backlog et le journal du projet. Il contient trois types opérationnels :

- `idea` : piste issue d’une recommandation, d’une question ou du graphe ;
- `task` : travail borné avec statut, priorité, niveau d’autonomie, critères de clôture et vérification ;
- `change` : trace d’un changement effectivement livré, reliée à sa tâche par `DOCUMENTS_PROGRESS`.

La donnée durable se trouve dans `data/project-work.json`. Dans l’application, choisir **Travail & avancement** dans le sélecteur de cluster.

Dire « travaille en autonomie sur le projet » sélectionne la tâche `ready` + `autonomous` de priorité maximale dont les dépendances sont terminées. La clôture met à jour la tâche et ajoute un nœud `change` ; il n’existe pas de journal Markdown concurrent.

La boucle locale `npm run autonomy:watch` matérialise toutes les tâches des graphes actifs dans `artifacts/autonomy/task-queue.json`. Toutes restent visibles, mais seules les tâches `ready` + `autonomous` sont exécutables. Toutes les cinq minutes, la boucle attribue les tâches aux citoyens disponibles, les déplace dans les `Space` concernés, recompose leurs workspaces avec l’état L4 courant et lance `codex exec`. Le tick L4 tourne par défaut toutes les cinq secondes et recharge les workspaces lorsqu’ils changent.

Avant chaque réveil de travail, le runtime construit les couples tâche-citoyen disponibles. Il respecte une attribution explicite (`assignedCitizenId`, `assigneeId` ou `preferredCitizenId`), sinon il note chaque citoyen selon la continuité de sa tâche, son intention de cluster, son énergie et son graphe courant. Un citoyen ne reçoit qu’une tâche par cycle ; l’attribution porte un score explicable et un lease temporaire. Le runtime déplace ensuite chaque citoyen retenu dans le `Space` de sa tâche, compose son workspace individuel et réveille son instance Codex. `actor-nlr` reste le repli quand aucun autre citoyen runtime n’est connu.

Un second réveil `personal` s’exécute toutes les quinze minutes. Il lance `codex --search exec` en sandbox `read-only`, choisit librement une à trois curiosités à partir du global workspace et cherche des actualités récentes pertinentes pour NLR. Il peut observer et synthétiser, mais ne peut modifier ni le projet ni un état externe. Son dernier résultat est conservé dans `artifacts/autonomy/personal-latest.json`. `npm run autonomy:personal` lance uniquement cette boucle de quinze minutes ; ajouter `-- --once` exécute un seul réveil. `--personal-minutes=N` règle sa cadence, `--no-personal` le désactive dans la boucle générale et `--personal-now` permet de le tester après un réveil `--once`.

Sous Windows, chaque réveil affiche une notification avec son statut et un extrait du résultat Codex ; `--no-notification` la désactive. Pour contrôler la boucle sans lancer Codex : `npm run autonomy:once -- --dry-run`. Chaque réveil Codex, y compris `personal`, consomme les crédits correspondant au mode d’authentification actif.

## Consulter une audience externe

Un point du graphe que ni la relecture ni la simulation ne débloquent peut être soumis dehors. `npm run consult:draft -- --apply` retient les questions ouvertes, effets non chiffrés, contradictions et mécanismes non éprouvés qu'une audience peut réellement traiter, puis écrit un brouillon de post dans `artifacts/consultations/`. La publication est manuelle ; aucun script n'appelle le réseau.

Au retour, `npm run consult:ingest` enregistre l'URL du fil et en tire un squelette de nœuds à typer. Une réponse est enregistrée comme une position attribuée à son auteur : elle ne porte jamais de valeur chiffrée et ne soutient aucune estimation. Un argument convaincant produit une tâche, pas un chiffre. Détail dans [`DOCUMENTATION.md`](DOCUMENTATION.md).

## Lancement

Prérequis : Docker Desktop et Node.js 20 ou plus récent.

```powershell
docker compose up -d
npm install
npm run validate
npm run seed
npm start
```

Ouvrir <http://localhost:4173/>.

- Graphe interactif : <http://localhost:4173/>
- Cité-jardin (UX spatiale) : <http://localhost:4173/garden.html>
- Santé, indicateurs et recommandations : <http://localhost:4173/analysis.html>
- Présentation de l’ontologie : <http://localhost:4173/ontology.html>

## Commandes

```powershell
npm run validate
npm run seed
npm run analyze
npm run work:next
npm run work:propose
npm run autonomy:once -- --dry-run
npm run autonomy:watch
    npm run consult:draft
    npm run science:ingest:satopaa -- --check
    npm run science:quality:satopaa
    npm run seed -- --graph=science --dry-run=artifacts/science/satopaa-dry-run.json
npm run query -- "Quelles questions bloquent la simulation ?"
npm test
npm run simulate:smoke
npm run simulate
npm run simulate:sensitivity:smoke
npm run simulate:sensitivity
npm run simulate:behaviors:smoke
npm run simulate:behaviors
```

`npm run work:propose` transforme les lacunes détectées par l’audit en tâches candidates. Il n’écrit rien sans `-- --apply`, et tout ce qu’il écrit reste `proposed` + `review_required` : une lacune décrit un manque, elle ne décide pas comment le combler. Les états et métriques à créer encodent des choix de projet et ne sont donc pas écrits dans `data/` : ils partent en ébauches marquées `TODO` dans `artifacts/proposals/`, à relire et nommer avant promotion.

`npm run analyze` privilégie l’analyse causale complète via `/api/graph`. Si l’API ou FalkorDB est indisponible, la commande bascule explicitement sur un rapport incomplet construit depuis `data/project-work.json` : il liste les tâches autonomes prêtes, bloquées, proposées et en cours, mais ne produit aucun finding causal complet.

Le seed reconstruit le graphe FalkorDB nommé `mind_causal`. Les modifications durables doivent être faites dans les fichiers JSON de `data/`.

## Contenu

- `graphs.json` : composition des graphes — base FalkorDB, ontologie et jeux de données ordonnés de chacun ;
- `data/mind-root.json` : nœud racine Mind Protocol ;
- `data/mind-protocol-concepts.json` : axiomes, capacités, mécanismes, institutions et horizons ;
- `data/mind-economic-causality.json` : raisons, mécanismes économiques et effets recherchés ;
- `data/mind-validation-roadmap.json` : hypothèses, questions ouvertes et états testables ;
- `data/forecast-events.json` et `data/forecast-influences.json` : scénarios prospectifs et effets croisés ;
- `data/civilization-endgame.json` : extraction sourcée du document Civilization Endgame, endgames, wedges, garde-fous et roadmap ;
- `data/endgame-domains.json` : Democracy, Education, Mental Health, Financial Narrative et Science Endgame v2, avec pages, provenance et liens transversaux ;
- `data/causal-science-implementation.json` : architecture, invariants, ingestion, accélération scientifique et runtime de questions de CSG v0.2 ;
- `science/ontology.json` : grammaire propre du graphe scientifique, avec les primitives CSG et la chaîne Study → Estimate → Claim → Evidence ;
- `science/staging/` et `scripts/science-ingest.js` : propositions d'ingestion, invariants de provenance et commit canonique atomique ;
- `science/quality-contract.json` et `scripts/science-quality.js` : vecteur de readiness explicable (texte, concepts, structure, connectivité, provenance, revue IA) ;
- `science/data/` : clusters scientifiques canoniques validés ;
- `governance/evidence-firewall.json` : socle partagé de provenance et de certitude continue, sans seuil d'action dans le graphe ;
- `data/question-endgame.json` : architecture proposée de la question située vers un noyau de réponse auditable, avec profils, membranes, raisons, options et tensions ;
- `data/evidence-appraisal-method.json` : méthode d’évaluation critique d’une étude — instruments par design, contrôles mécanisables, vocabulaire et certitude GRADE ;
- `data/graph-architecture-decisions.json` : arbitrages d’architecture du graphe, avec leurs options rejetées et leurs raisons ;
- `data/consultations.json` : points du graphe soumis à une audience externe, et réponses rapportées ;
- `data/graph-ontology.json` : types, relations, statuts épistémiques et poids ;
- `src/consultation.js` : sélection des points consultables, brouillon de post et squelette de récolte ;
- `src/graph-manifest.js` : lecture du manifeste, partagée par le seed, le validateur et les statistiques ;
- `public/graph-analysis.js` : audit priorisé, goulots structurels, boucles et leviers de preuve ;
- `public/graph-health.js` : indicateurs explicables de santé et enrichissement contextuel des recommandations ;
- `public/graph-query.js` : questionnement local et extraction de clusters ;
- `public/cluster-presentation.js` : classement, patterns et transformation déterministe d’un cluster en présentation textuelle ;
- `scripts/seed.js` : chargement FalkorDB ;
- `scripts/validate-data.js` : validation structurelle et séparation des domaines.

## Outils MCP

Le serveur MCP expose `ask_graph`, qui reçoit une `question` en langage naturel, renvoie le cluster local parcouru et injecte l'énergie L4 correspondante. `query_graph` reste disponible pour les clients existants.

`move` déplace les liens sortants d'un nœud qui ciblent des `Space` vers un nouveau `Space` du même graphe. Le type et les propriétés de chaque lien sont conservés ; `dryRun=true` permet de prévisualiser l'opération. Cette mutation agit sur l'état FalkorDB courant et sera remplacée par un prochain seed si elle n'est pas aussi reportée dans le dataset canonique.

`sync_l1_blueprint` compare le blueprint L1 versionné aux projections structurelles des L1 ; le dry-run est la valeur par défaut et `apply=true` accepte explicitement la migration, sans écraser de contenu personnel. `l4_state` renvoie où le graphe est actuellement chaud.

## Garanties de séparation

Le validateur refuse toute propriété `tattoo` dans les données du graphe causal. Le seed ne lit aucun fichier du sous-repo. Les liens historiques vers Mind sont conservés dans `../tattoo-language-atlas/data/mind-historical-crosslinks.json`, mais ne sont pas chargés ici.

La frontière entre graphe de design et graphe scientifique suit la même logique. `graphs.json` déclare deux graphes actifs : `design` (`mind_causal`) et `science` (`mind_science`), chacun avec sa base, son ontologie et ses datasets. Le seed refuse d’écrire si la base connectée n’est pas celle que le manifeste déclare, et aucune arête ne traverse les deux bases. Une référence externe est conservée comme identifiant stable, jamais comme relation FalkorDB. Les nœuds `sci-*` et `csg-*` restent côté design : ils décrivent le graphe scientifique sans en être le contenu. Le premier cluster canonique, Satopää et al. sur la diversité d'information, est produit par `npm run science:ingest:satopaa`. Voir [`DOCUMENTATION.md`](DOCUMENTATION.md) et le cluster `graph-architecture`.
