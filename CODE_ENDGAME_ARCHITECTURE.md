# Architecture cible — Endgame du code

## Statut

Ce document est la déclinaison architecturale du cluster [`data/code-endgame-design.json`](data/code-endgame-design.json) (`clusterId: code-endgame-design`). Il hérite de son statut : **design-only, différé**. Il ne déclenche aucune migration, aucun chantier, aucune dépendance nouvelle. Le dégel est gouverné par `axiom-decision-unfreeze-criteria` : rien ne devient graph-authoritative sans round-trip fidèle, rollback démontré et revue sémantique praticable sur une zone pilote — chaque preuve étant un Moment daté, jamais une déclaration.

Chaque composant référence les nœuds du cluster qu'il incarne, pour que l'architecture et le graphe de design ne divergent pas.

## Vue d'ensemble en couches

```text
A6  Surfaces               Graph IDE · vues synchronisées · bris de glace
A5  Strate d'intention     schéma d'intention · routeur de régime · interpréteur
                           · compilateur JIT · cristalliseur · boucle conversationnelle
A4  Boucle de réalité      telemetry ingestor · bug clusterer · error-to-task router
A3  Pipeline transactionnel build runner · test runner · promotion · rollback · artifact store
A2  Services de projection  materializer · resolver · planner · import/export
                           · source maps · diff sémantique · impact · validateur de contrats
A1  Program Graph          atomes · contrats · révisions · ChangeSets · Moments
                           · intentions · capacités          ← SOURCE D'AUTORITÉ
A0  Trusted Kernel         stockage · transactions · permissions · signatures
                           · idempotence · leases · outbox · sandbox
                           · interpréteur minimal · vérificateurs · pilotes
```

Deux principes traversent toutes les couches :

1. **Le graphe est la source de vérité ; le code est un cache exécutable dérivé** (`axiom-decision-code-as-derived-cache`). Tout ce qui est au-dessus de A1 lit et écrit le graphe ; tout fichier est une projection régénérable.
2. **Un substrat déterministe demeure sous le graphe** (`axiom-decision-deterministic-substrate`). A0 est le seul étage qui reste du code au sens classique : petit, versionné hors graphe, extrêmement audité.

## A0 · Trusted Kernel

Nœuds : `mechanism-trusted-kernel`, `hypothesis-bootstrap-trusted-kernel`, `axiom-decision-deterministic-substrate`.

Le noyau est ce qui doit survivre à une panne du graphe et pouvoir le reconstruire. Il vit **hors du Program Graph**, dans un dépôt versionné classique, avec sa propre chaîne de build reproductible.

| Composant | Responsabilité | Invariant |
|---|---|---|
| Graph Store | stockage du graphe, index, snapshots | durabilité, restauration point-in-time |
| Transaction Manager | écritures atomiques multi-nœuds | tout ou rien, jamais d'état intermédiaire visible |
| Permission Engine | qui peut lire/écrire/promouvoir quoi | dény par défaut, délégations explicites |
| Signature Service | signer révisions, promotions, exports | toute écriture d'autorité est attribuable |
| Idempotence / Leases / Outbox | effets externes exactement-une-fois | un effet ambigu est vérifié avant retry |
| Sandbox | exécution isolée des candidats et du code généré | aucun accès aux artefacts actifs |
| Loader/Interpreter minimal | lire le format canonique, valider le schéma, matérialiser | fonctionne sans le graphe qu'il charge |
| Verifiers | intégrité (hashes), contrats, invariants | une révision incohérente ne se charge pas |
| Drivers | matériel, réseau, horloge | seul point de contact avec le monde physique |

Substrat pressenti (non engageant) : FalkorDB pour le Graph Store, Node.js pour le noyau v0, containers pour la sandbox (le `docker-compose.yml` du dépôt en est l'embryon). Le périmètre minimal exact reste l'inconnue résiduelle de `hypothesis-bootstrap-trusted-kernel` ; le test qui le borne est le **rebuild indépendant** (`institution-guardrail-independent-rebuild`).

## A1 · Program Graph

Nœuds : `mechanism-program-graph`, `mechanism-semantic-atom-schema`, `mechanism-program-revision`, `mechanism-change-set`, `mechanism-verifiable-intent-schema`.

### Modèle de données

```text
Atome      := { logicalId stable, kind (Function|Class|Method|Interface|Schema|
                Constant|StateMachine|Endpoint|TestCase), source canonique,
                contrat, hash, provenance }
Contrat    := { entrées, sorties, erreurs, effets, préconditions,
                postconditions, permissions }
Révision   := snapshot immuable du graphe (DAG de parenté) — jamais réécrite
ChangeSet  := { intention, ensemble de deltas d'atomes, justification,
                preuves de validation, signature } — l'unité de fusion
Moment     := événement daté { type, révision ciblée, environnement, hashes,
                résultat } — jamais une propriété figée
Intention  := { Goal, CurrentState, Constraints, ForbiddenEffects, Delegation,
                SuccessCriteria, FailurePolicy, Budget, Reversibility }
Capability := exécuteur permanent né de la cristallisation, avec contrat
                et tests accumulés
```

Règles structurantes :

- **Identité indépendante du chemin** (`axiom-decision-stable-logical-id`) : le `logicalId` survit aux renommages, déplacements et changements de langage.
- **Granularité sémantique** (`axiom-decision-bounded-granularity`, `hypothesis-atom-independent-contract-change`) : un atome = la plus petite unité avec identité stable, contrat testable et raison de changer indépendante. Jamais un nœud par ligne.
- **Canonicité progressive** (`hypothesis-canonical-progressive-representation`) : la source textuelle atomique est canonique au départ ; AST et IR sont des dérivations régénérables stockées dans l'Artifact Store, promues seulement sur preuve de round-trip.
- **Statut = vue calculée** (`hypothesis-status-from-revision-moments`) : l'état affiché d'une unité est une réduction déterministe des derniers Moments applicables (révision × environnement), exposant succès, échec, conflit, absence et obsolescence comme états distincts.

## A2 · Services de projection

Services **stateless et déterministes** : même révision en entrée ⇒ mêmes artefacts en sortie, hash pour hash. C'est la condition du rebuild indépendant.

| Service | Nœud | Entrée → Sortie |
|---|---|---|
| Program Materializer | `mechanism-program-materializer` | révision → artefacts standards du langage |
| Dependency Resolver | `mechanism-dependency-resolver` | relations du graphe → ordre d'init, cycles, imports |
| Compilation Unit Planner | `mechanism-compilation-unit-planner` | atomes → regroupement en fichiers (sans porter de sens) |
| Import/Export Generator | `mechanism-import-export-generator` | dépendances déclarées → plomberie de modules |
| Source Map Emitter | `mechanism-graph-source-map-emitter` | matérialisation → triplet (Function ID, révision, hash) par unité + table instruction→atome (`hypothesis-source-map-atom-triplet`) |
| Semantic Diff Engine | `mechanism-semantic-diff-engine` | deux révisions → diff de contrats, comportements, dépendances, tests, risques |
| Impact Analyzer | `mechanism-impact-analyzer` | ChangeSet → appelants, dépendants, contrats affectés, tests pertinents |
| Contract Validator | `mechanism-contract-validator` | révision candidate → conforme / rejetée (schemas, invariants, permissions) |

Deux obligations du matérialiseur :

- **Artefacts standards** (`institution-guardrail-standard-artifacts`) : les fichiers projetés restent des sources idiomatiques, lisibles par l'outillage fichiers existant pendant toute la transition.
- **Provenance embarquée** : chaque unité matérialisée porte son triplet de provenance, condition pour que le debugging survive à l'abstraction (`risk-debugging-opacity`).

## A3 · Pipeline transactionnel

Nœuds : `mechanism-build-runner`, `mechanism-test-runner`, `mechanism-promotion-pipeline`, `mechanism-rollback-engine`, `mechanism-artifact-store`.

```text
ChangeSet candidat
  → révision candidate (fork)
  → matérialisation en sandbox          (jamais les artefacts actifs)
  → build réel                          → Moment · Build Run
  → tests sélectionnés par impact       → Moment · Test Run
  → validation des contrats             → conforme / rejet
  → audit + signature                   → Moment · Promotion Run
  → promotion (bascule atomique)  ou  abandon
  → rollback disponible à tout moment   → Moment · Rollback Run
```

Garanties portées par cette couche :

- `institution-guardrail-isolated-candidates` — aucun candidat ne touche les artefacts actifs ;
- `institution-guardrail-immutable-revisions` — toute modification produit une nouvelle révision ;
- `institution-guardrail-signed-promotions` — initiateur, validations, hashes et décision conservés ;
- l'Artifact Store conserve sources atomiques, AST, IR, builds et hashes **sans jamais faire autorité**.

Le merge opère au niveau des ChangeSets (`hypothesis-merge-semantic-changesets`) : conflit = postconditions incompatibles sur un même contrat, détecté par le Semantic Diff Engine et le Contract Validator — jamais un chevauchement textuel.

## A4 · Boucle de réalité

Nœuds : `mechanism-runtime-telemetry-ingestor`, `mechanism-bug-clusterer`, `mechanism-error-to-task-router`, `mechanism-compilation-error-flow`.

```text
runtime / toolchain
  → Moments (erreurs, perfs, builds, tests)     [ingestion, source maps]
  → clustering par signature × atome × révision  [déduplication]
  → seuil d'actionnabilité                       [hypothesis-error-task-actionability-threshold]
       nouvelle ou au-dessus du seuil ?
       imputable à un atome + une révision ?
       non couverte par une tâche ouverte ?
  → oui : Task de réparation (gabarit borné)  /  non : renforcement du cluster
  → Repair Agent → ChangeSet candidat → pipeline A3
```

Les erreurs sont des **Moments, pas des Actors** (`axiom-decision-errors-are-moments-not-actors`) : elles déclenchent du travail sans acquérir de finalité propre. Les réparations autonomes restent bornées — budgets, permissions, portée, rollback, confirmations sur zones critiques (`institution-guardrail-bounded-repair`).

## A5 · Strate d'intention

Nœuds : `axiom-decision-intent-as-program-unit`, `mechanism-verifiable-intent-schema`, `axiom-decision-three-execution-regimes`, `mechanism-graph-interpreter`, `mechanism-jit-capability-compiler`, `mechanism-capability-crystallizer`, `mechanism-conversational-programming-loop`.

### Routage entre les trois régimes

```text
Intention complète (9 champs validés)
  → plan graph-native
  → toutes les capacités requises existent ?
      oui → RÉGIME 1 · interprétation directe du sous-graphe
      non → RÉGIME 2 · compilation à la volée
             spécification graphée → génération → tests synthétiques
             → sandbox → vérification → exécution
             (code jetable si tâche unique)
  → le même plan revient régulièrement ?
      oui → RÉGIME 3 · cristallisation
             structure stable + tests accumulés → Capability permanente
```

Critères de cristallisation (à calibrer au dégel) : N exécutions réussies du même plan structurel, tests accumulés couvrant les SuccessCriteria, aucune violation de contrat sur la fenêtre, signature d'une autorité de promotion.

### Les deux garde-fous non négociables de la strate

- **Aucun effet sans intention compilée et prouvable** (`institution-guardrail-compiled-intention-only`) : plan déterminé + contraintes satisfaites + tests + permissions + budget + preuve de résultat. Une intention brute n'est pas exécutable — c'est une ambiguïté que la boucle conversationnelle doit d'abord résoudre.
- **Tout comportement répond à « pourquoi »** (`institution-guardrail-why-traceability`) : la traversée `effet ← code ← capacité ← tests ← décision ← intention ← autorité` doit toujours exister. Un comportement sans chaîne de provenance est un défaut.

C'est la parade architecturale au risque central de la strate : remplacer du code lisible par un nuage d'intentions vagues et de génération probabiliste (`risk-vague-intention-cloud`). Le système est **plus** strict que la programmation classique, pas moins.

## A6 · Surfaces

Nœuds : `mechanism-graph-ide`, `mechanism-filesystem-abstraction-layer`, `hypothesis-ide-dialogue-with-synced-views`, `hypothesis-low-level-break-glass-access`.

- **Graph IDE** : mode nominal = dialogue agentique (la même boucle que la programmation par intention), adossé à des vues synchronisées — code atomique, contrat, tests, sous-graphe — toutes éditables ; le texte de l'atome reste une édition de première classe tant que la canonicité est textuelle.
- **Vue humaine complète** (`institution-guardrail-human-readable-view`) : toute unité, erreur, révision et décision reste inspectable ; le Graph IDE est le mécanisme qui l'applique.
- **Bris de glace** : en panne de toolchain, une voie de diagnostic bornée et auditée donne accès aux artefacts immuables, logs, source maps, reconstruction et rollback — autorité explicite requise, Moment d'audit émis, jamais d'écriture canonique par cette voie.

## Autorité et transition

Nœuds : `axiom-decision-explicit-authority`, `risk-dual-authority`, `risk-premature-migration`, `axiom-decision-unfreeze-criteria`.

Un **registre d'autorité** déclare pour chaque zone du système une source unique : `graph` | `file` | `external` | `generated`. Aucune unité n'a deux sources de vérité ; le rebuild indépendant détecte toute divergence dès qu'elle apparaît.

### Phasage (chaque flèche exige ses preuves, chaque phase est réversible)

```text
Phase 0 · Miroir observationnel
  Le graphe est construit DEPUIS les fichiers (parse), en lecture seule.
  Autorité : file partout. Preuve attendue : le graphe reflète le dépôt
  sans perte sur la zone pilote.

Phase 1 · Round-trip prouvé
  fichiers → graphe → matérialisation → build identique (hash pour hash)
  sur une zone pilote non critique. Autorité : file, matérialisation à blanc.
  Preuve : Moment · Materialization Run + Build Run identiques.

Phase 2 · Zone pilote graph-authoritative
  L'autorité de la zone pilote bascule : graph. Les fichiers de la zone
  deviennent generated. Rollback réel démontré au moins une fois.
  Preuve : Moment · Promotion Run + Rollback Run + revue sémantique
  praticable sur un ChangeSet réel.

Phase 3 · Strate d'intention sur la zone pilote
  Premières intentions compilées (régime 1 puis 2), cristallisation
  observée au moins une fois. Preuve : traversée « pourquoi » complète
  sur un effet produit par intention.

Extension zone par zone ensuite — jamais de bascule globale.
```

Le kernel (A0) reste `external` à toutes les phases. Le passage de chaque phase est un choix gouverné, signé, daté et réversible (`axiom-design-now-implement-later`).

## Sécurité

Nœud : `risk-security`. Le graphe et le matérialiseur concentrent le pouvoir d'écrire tout le programme — c'est la cible la plus rentable du système. Réponses architecturales : permissions dény-par-défaut et signatures dans le kernel (A0), promotions signées et auditables (A3), candidats isolés (A3), export ouvert comme borne de perte maximale (`institution-guardrail-exportability`), traversée « pourquoi » comme détection d'effets sans autorité (A5).

## Ce qui reste ouvert

| Question | État |
|---|---|
| Représentation canonique | hypothèse : canonicité progressive texte → IR, à éprouver au round-trip |
| Frontière de l'atome | hypothèse : identité + contrat + raison de changer ; calibration langages dynamiques |
| Modèle de fusion | hypothèse : conflit au niveau des contrats ; ergonomie de résolution inconnue |
| Source maps | hypothèse : triplet garanti ; code inliné/optimisé et runtimes tiers non résolus |
| Édition IDE | hypothèse : dialogue + vues synchronisées ; réconciliation concurrente inconnue |
| Seuil erreur→tâche | hypothèse : actionnabilité budgétée ; calibration inconnue |
| **Rétention des Moments** | **aucune hypothèse** — `question-moment-retention` bloque le dimensionnement de l'Artifact Store ; `risk-graph-bloat` reste sans parade tant qu'elle n'est pas tranchée |
| Périmètre exact du kernel | hypothèse : noyau minimal ; ensemble minimal, mise à jour et racine de confiance à trancher |

## Ce que ce document n'autorise pas

Aucune implémentation, aucun scaffolding, aucune dépendance, aucune migration de zone — tant que les critères de dégel ne sont pas prouvés par des Moments datés et que les priorités courantes (boucle autonome, onboarding, ingestion, observabilité, UX) ne sont pas stabilisées. Ce document sert à ce que, le jour du dégel, l'architecture soit déjà arbitrée et que le premier chantier soit la Phase 0 sur une zone pilote — rien d'autre.
