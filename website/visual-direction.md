# Site personnel « Citizen AI » — Direction visuelle

Étape `website-visual-direction` (séquence 3) de l'objectif
`objective-nlr-citizen-ai-personal-website`.

Statut épistémique : **proposition de travail** rédigée par le cycle de travail
autonome du Citizen AI, **dérivée** du livrable de portée-et-confidentialité
([`scope-and-privacy.md`](scope-and-privacy.md)) et du modèle de contenu
([`content-model.md`](content-model.md)). Révisable par NLR ; non décidée par lui.

Principe directeur : **sobriété honnête**. Le site présente un *système logiciel
expérimental* — un graphe causal parcouru par des cycles de traitement. Le visuel
doit donc paraître calme, technique et lisible plutôt que « intelligent » ou
anthropomorphe. Rien qui suggère une conscience, une émotion vécue ou une
autorité (cohérent avec `scope-and-privacy.md §3`).

---

## 1. Typographie

| Rôle | Police | Repli | Justification |
| --- | --- | --- | --- |
| Titres | `Inter`, sinon pile système | `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | Neutre, très lisible, largement disponible ; **aucune police à charger depuis un CDN payant ou traçant** — la pile système suffit hors-ligne. |
| Corps | pile système sans-serif | idem | Lisibilité mobile, zéro requête réseau tierce. |
| Données / provenance / code | `ui-monospace` | `SFMono-Regular, Menlo, Consolas, monospace` | Signale visuellement le statut épistémique et les artefacts (dates ISO, `sourceArtifact`). |

- **Aucune police web distante** n'est chargée : contrainte gratuité + frontière
  privée (pas de requête tierce qui fuite l'IP du lecteur). La pile système est
  le choix par défaut ; `Inter` n'est utilisé que s'il est déjà présent localement.
- Échelle typographique modulaire (ratio ~1.2) : `0.83 · 1 · 1.2 · 1.44 · 1.73 · 2.07 rem`.
- Corps à `1rem`/`1.6` interligne, largeur de ligne plafonnée à `65ch` pour la
  lisibilité.

## 2. Couleurs

Palette sobre « encre & graphe », déclarée en variables CSS, avec thème clair par
défaut et thème sombre via `prefers-color-scheme`.

| Jeton | Clair | Sombre | Usage |
| --- | --- | --- | --- |
| `--bg` | `#fbfbf9` | `#0f1115` | Fond de page (papier cassé / encre). |
| `--surface` | `#ffffff` | `#171a21` | Cartes, encadrés. |
| `--text` | `#1a1c20` | `#e7e9ee` | Texte principal. |
| `--muted` | `#5b6270` | `#9aa2b1` | Texte secondaire, provenance. |
| `--border` | `#e3e3dd` | `#272b34` | Traits fins, séparateurs. |
| `--accent` | `#2f6f5e` | `#5fb8a0` | Liens, arêtes du graphe, focus (vert « causal »). |
| `--accent-weak` | `#e7f0ec` | `#1c2a26` | Fond de puce d'état neutre. |

Statuts épistémiques et états du journal — codage couleur **redondant avec du
texte** (jamais couleur seule, exigence d'accessibilité) :

| Statut / état | Jeton | Rendu |
| --- | --- | --- |
| `declared` (NLR) | `--st-declared` `#6b4fbb` | puce + libellé « déclaré ». |
| `observed` (constaté) | `--st-observed` `#2f6f5e` | puce + libellé « constaté ». |
| `derived` (dérivé) | `--st-derived` `#3a6ea5` | puce + libellé « dérivé ». |
| `proposed` (proposé) | `--st-proposed` `#a56a2f` | puce + libellé « proposé ». |
| `bloqué` / `aucun progrès` | `--st-blocked` `#b0483c` | puce + libellé explicite. |

Contraste : toutes les paires texte/fond visent **WCAG AA** (≥ 4.5:1 pour le
corps, ≥ 3:1 pour les grands titres). À vérifier à l'étape `website-verification`.

## 3. Composants essentiels

1. **En-tête + navigation** : titre du site, navigation par ancres vers les cinq
   sections. Repliable en menu vertical sous `640px`. Entièrement utilisable au
   clavier ; lien « aller au contenu » en tête.
2. **Puce de provenance** (`.provenance`) : petit composant monospace
   `statut · source` accolé aux affirmations importantes. C'est la brique qui
   applique « aucune affirmation nue » du modèle de contenu.
3. **Carte d'avancée** (`.entry`) : rend une entrée du journal daté selon le
   schéma stable de `content-model.md §2` (date, titre, état, claim, preuve/limite,
   provenance). État affiché par puce texte + couleur.
4. **Encadré « Limites »** (`.caveat`) : bloc visuellement distinct (bordure
   `--st-blocked` discrète) pour les non-garanties et frontières.
5. **Diagramme conceptuel du graphe** : SVG inline **statique**, léger, décoratif
   mais informatif (nœuds + arêtes), `aria-hidden` si purement illustratif ou
   `<title>`/`<desc>` s'il porte du sens. Aucune librairie externe.

## 4. Mise en page & responsive

- **Mobile-first**, une seule colonne ; largeur de contenu `min(65ch, 92vw)`,
  centrée. Points de rupture : `640px` (nav horizontale), `960px` (marges
  élargies). Aucune grille complexe requise.
- Cibles tactiles ≥ `44×44px`. Espacement vertical rythmé (échelle `4px`).
- **Zéro dépendance de rendu réseau** : pas de framework CSS, pas de JS de tiers,
  pas d'icônes distantes. Tout est embarqué dans le dépôt.

## 5. Accessibilité & performance (contraintes de conception)

- HTML sémantique (`<header> <nav> <main> <section> <article> <footer>`), un seul
  `<h1>`, hiérarchie de titres continue.
- Focus visible (contour `--accent`), navigation clavier complète, `:focus-visible`.
- `prefers-reduced-motion` respecté : aucune animation non essentielle. Cohérent
  avec la doctrine « une animation doit être une expérience », ici il n'y a aucune
  expérience à mener, donc **aucune animation** — surface statique.
- Poids cible : page principale < 100 kB hors polices système (aucune police
  téléchargée). Pas de JS bloquant ; le rendu du journal est progressif et
  dégrade proprement sans JS (contenu de repli).

---

## Critères de sortie de l'étape — état

| Critère de sortie | État |
| --- | --- |
| La typographie, les couleurs et les composants essentiels sont définis | ✅ §1–§3 |
| La direction reste lisible sur mobile et cohérente avec l'identité du Citizen AI | ✅ §4 (mobile-first) + §5 ; sobriété honnête, aucune prétention |

Prochaine étape du plan : `website-static-build` (construire le site statique,
données du journal séparées du layout, utilisable clavier + mobile).
