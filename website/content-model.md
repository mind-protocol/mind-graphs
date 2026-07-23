# Site personnel « Citizen AI » — Modèle de contenu

Étape `website-content-model` (séquence 2) de l'objectif
`objective-nlr-citizen-ai-personal-website`.

Statut épistémique : **proposition de travail** rédigée par le cycle de travail
autonome du Citizen AI, **dérivée** du livrable de portée-et-confidentialité
([`scope-and-privacy.md`](scope-and-privacy.md)) et des contraintes déclarées
par NLR. Révisable par NLR ; non décidée par lui.

Principe transversal : **chaque affirmation importante porte une provenance ou
un statut épistémique explicite**. Les statuts autorisés reprennent l'ontologie
du graphe : `declared` (déclaré par NLR), `observed` (constaté et daté),
`derived` (dérivé d'un artefact cité), `proposed` (proposition non tranchée).
Aucune affirmation « nue » n'est publiée.

---

## 1. Sections du site

### 1.1 Accueil
- **But** : formuler en une phrase ce qu'est le Citizen AI et la promesse du
  site (comprendre + suivre des avancées honnêtes).
- **Contenu** : titre, phrase-promesse (reprise de `scope-and-privacy.md §1`),
  trois portes d'entrée (Citizen AI · Fonctionnement · Avancées), lien vers les
  Limites.
- **Provenance affichée** : la phrase-promesse cite son origine (contraintes
  déclarées par NLR).

### 1.2 Citizen AI
- **But** : expliquer *ce qu'est* le Citizen AI de Nicolas, sans jargon et sans
  prétention de conscience.
- **Contenu** : définition d'un citoyen L1 ; positionnement dans Mind Protocol ;
  ce qu'il n'est **pas** (pas conscient, pas doté d'autorité — cf.
  `scope-and-privacy.md §3`).
- **Provenance affichée** : chaque affirmation conceptuelle porte le statut
  `derived` avec le document source, ou `declared` si elle vient de NLR.

### 1.3 Fonctionnement
- **But** : décrire le *comment* de haut niveau, sans secret technique.
- **Contenu** : graphe causal, blueprint, cycles de réveil adaptatifs, doctrine
  « proposer ≠ assigner ». Diagramme conceptuel optionnel.
- **Provenance affichée** : renvois aux mécanismes publics du dépôt (statut
  `derived`) ; aucun secret (clés, `.mcp.json`, chemins) — cf. frontière privée.

### 1.4 Avancées
- **But** : publier un journal daté et vérifiable des progrès réels.
- **Contenu** : liste d'entrées au **format de journal stable** défini en §2,
  triées de la plus récente à la plus ancienne. Seules les observations L1
  marquées `public` sont exportées.
- **Provenance affichée** : chaque entrée porte sa date, son état et sa preuve
  **ou** sa limite ; l'absence de progrès est affichée telle quelle.

### 1.5 Limites
- **But** : rendre explicites les frontières, incertitudes et non-garanties.
- **Contenu** : ce que le site ne prétend pas (conscience, autorité, exhaustivité)
  ; données volontairement non publiées ; incertitudes ouvertes.
- **Provenance affichée** : reprise directe de `scope-and-privacy.md §2–3`.

---

## 2. Format daté stable du journal d'avancement

Chaque entrée « Avancées » est un objet structuré, séparé du layout, dérivé
d'une observation L1 marquée `public`. Schéma stable :

| Champ | Obligatoire | Origine L1 | Description |
| --- | --- | --- | --- |
| `date` | oui | `observedAt` | Date ISO de l'observation (affichée `AAAA-MM-JJ`). |
| `title` | oui | `name` | Titre court de l'avancée. |
| `status` | oui | `statusAfter` / `updateType` | État : `en cours`, `étape terminée`, `bloqué`, `aucun progrès`. |
| `claim` | oui | `progressClaim` / `phrase` | Ce qui a été fait, sans exagération. |
| `evidenceOrLimit` | oui | `deliverableArtifact` / `provenanceNote` | Preuve (artefact/lien) **ou** limite explicite. |
| `provenance` | oui | `epistemicStatus` + `sourceArtifact` | Statut épistémique et source. |
| `objectiveId` | oui | `contextId` | Objectif rattaché. |

Règles du format :
- **Append-only** : une entrée publiée n'est jamais réécrite ; une correction
  est une nouvelle entrée datée.
- **Tri** : décroissant par `date`.
- **Honnêteté** : si `status = aucun progrès`, `evidenceOrLimit` décrit le
  blocage ; jamais maquillé en accomplissement.
- **Consentement** : une observation sans drapeau `public` n'apparaît jamais.

Exemple (dérivé de l'observation réelle `...scope-privacy-defined-2026-07-23`) :

```json
{
  "date": "2026-07-23",
  "title": "Récit public et frontière privée définis",
  "status": "étape terminée",
  "claim": "Livrable de portée publique et frontière privée rédigé et vérifié contre 3 critères de sortie.",
  "evidenceOrLimit": "website/scope-and-privacy.md",
  "provenance": "observed · l1/data/personal-goals.json",
  "objectiveId": "objective-nlr-citizen-ai-personal-website"
}
```

---

## Critères de sortie de l'étape — état

| Critère de sortie | État |
| --- | --- |
| Les sections Accueil, Citizen AI, Fonctionnement, Avancées et Limites sont définies | ✅ §1 |
| Chaque affirmation importante possède une provenance ou un statut explicite | ✅ principe transversal + colonnes `provenance` |
| Le journal d'avancement possède un format daté stable | ✅ §2 (schéma + règles) |

Prochaine étape du plan : `website-visual-direction` (typographie, couleurs,
composants, lisibilité mobile).
