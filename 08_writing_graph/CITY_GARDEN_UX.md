# Cité-jardin — spec de l'UX spatiale du graphe

## Objet

Le graphe typé est le **moteur** ; il n'est pas une UX de compréhension pour un
humain. Cette vue propose une alternative : ne plus **lire** un diagramme de
carrés et de flèches, mais **habiter** un monde où le sens d'une relation est
porté par une **affordance** (un mur qu'on ne traverse pas, un flux qui coule)
plutôt que par une étiquette qu'il faut déchiffrer.

Deux métaphores complémentaires, choisies après arbitrage :

- **Ville** — la *structure*. Districts, murs, routes, ponts, chantiers,
  ruines. Répond à « comment cet argument est-il bâti ? qui porte quoi ? ».
- **Jardin** — l'*état*. Vitalité, germination, floraison, dépérissement.
  Répond à « cet argument est-il vivant et sain, ou en train de pourrir ? ».

La cellule a été écartée : trop spécifique, moins lisible qu'une ville pour un
public large.

## Principe directeur : l'affordance *est* la sémantique

Dans un graphe, le sens est dans l'étiquette (il faut lire `BLOCKS`). Dans
la cité-jardin, le sens est perçu : un `BLOCKS` est un **mur / une faille**,
pas une flèche. Chaque prédicat de `graph-ontology.json` devient une **matière**.

## Garde-fou anti-mensonge : échafaudage, pas cathédrale

Une belle pierre taillée suggère la solidité et la permanence. Or la plupart des
nœuds sont des **propositions**, pas des faits. Rendre une proposition en granit
serait un mensonge visuel — l'inverse exact de la discipline de la nomenclature.

Donc **le statut épistémique gouverne la matière et la vitalité** :

Un objet paraît tangible quand il a une **masse**, une **lumière** et une
**ombre**. C'est donc la *solidité* — pas un pointillé — qui porte le statut :

| `epistemicStatus`           | Ville / Jardin              | Matière perçue |
|-----------------------------|-----------------------------|----------------|
| `documented`, `observed`    | bâtiment achevé             | pleine, éclairée du haut, **porte une ombre au sol** |
| `working_hypothesis`        | pousse                      | la matière monte du bas ; ombre faible |
| `design_proposal`           | **chantier · échafaudage**  | montants et traverses, **aucune ombre : rien n'est posé** |
| `target`, `test_target`     | fondation balisée           | une dalle au sol, sans volume au-dessus |
| `scenario`, `speculative_horizon` | **mirage**            | s'évapore vers le bas, ne touche jamais le sol |
| `unresolved` (question)     | **faille · gouffre**        | creux plus sombre que le sol ; la lumière n'accroche que la lèvre basse |
| `refuted`, `superseded`     | **ruine**                   | la crête a chuté, il reste des pans et des gravats |

La table couvre **exactement** les statuts de `epistemicStatuses` : un statut non
traduit retomberait en silence sur « chantier » et ferait passer un énoncé
réfuté pour un ouvrage en cours. Un test verrouille cette correspondance.

### Le pointillé ne veut dire qu'une chose

Le hachurage était employé pour quatre sens à la fois — bord de district,
proposition, `TESTS`, `SUBCASE_OF`, racines — au point de ne plus rien signifier
lorsque la majorité des nœuds sont des propositions. Il est désormais réservé à
**un ouvrage non achevé** : l'échafaudage d'un `TESTS` et l'effilochage d'un pont
de corde. Les districts sont des plaques de sol pleines, les racines des traits
continus estompés, et un chantier se reconnaît à sa structure interne.

Corollaire : là où un `CAUSES` n'a pas de `SUPPORTS_ESTIMATE`, le lien est un
**pont de corde**, jamais un pont de pierre.

### Matière d'un franchissement causal

`linkQuantification` (ontologie 1.9.0) place la force d'une affirmation causale
sur **l'arête**, pas sur le statut épistémique des nœuds qu'elle relie. La
matière du franchissement traduit donc exactement ce que l'arête ose affirmer :

| Arête `CAUSES` / `LEADS_TO`              | Matière                | Géométrie |
|------------------------------------------|------------------------|-----------|
| sans `effectSizePct`                      | **pont de corde**      | s'affaisse au maximum, effiloché |
| chiffrée · `evidenceBasis: assertion`     | corde tendue           | s'affaisse peu |
| chiffrée · `evidenceBasis: simulation`    | passerelle de planches | traverses visibles |
| chiffrée · `evidenceBasis: real_world`    | **pont de pierre**     | s'arque, culées visibles |

Deux règles anti-mensonge gouvernent l'échelle :

1. **Aucune promotion gratuite.** Une arête qui revendique `evidenceBasis` sans
   `effectSizePct` reste une corde : il n'y a rien sur quoi marcher. Le
   validateur refuse d'ailleurs cette combinaison dans les données.
2. **La corroboration n'est pas une matière.** Un `SUPPORTS_ESTIMATE` ou un
   `OBSERVES` touchant une extrémité pose un **ancrage** visible au milieu du
   franchissement, sans changer sa matière — sinon la preuve d'un voisin
   déteindrait sur le lien.

Le compteur `n/m causal chiffré` de la barre supérieure donne le même déficit en
chiffres ; il rejoint l'indicateur de saturation causale de `analysis.html`.

## Traduction prédicat → affordance

| Famille / prédicat        | Aujourd'hui | Affordance perçue |
|---------------------------|-------------|-------------------|
| `BLOCKS`, `CONTRADICTS` | flèche | **mur / faille** — on ne passe pas ; pas de tête de flèche |
| `SAFEGUARDS`              | flèche | **rempart crénelé** protégeant l'objet |
| `GROUNDS`                 | flèche | **fondation** — lueur porteuse sous la cible |
| `FEEDS` (flow)            | flèche | **flux animé** — eau / énergie qui coule (Canvas) |
| `CAUSES`, `LEADS_TO`      | flèche | **franchissement** — corde qui pend ↔ pierre qui porte |
| `IMPLEMENTS`, `CONVERGES_IN` | flèche | **route** convergeant vers le principe cible |
| `TESTS`                   | flèche | **échafaudage** (route pointillée en construction) |
| `ADDRESSES`               | flèche | **pont** jeté au-dessus de la faille (question) |
| `PART_OF`, `SUBCASE_OF`   | flèche | **imbrication** — parcelle dans un enclos |
| `DERIVED_FROM` (provenance) | flèche | **racines** souterraines, estompées, masquables |

Deux métriques d'audit ont déjà une intuition spatiale : la centralité
d'intermédiarité = **carrefour engorgé** ; une boucle (composante fortement
connexe) = **rond-point / circuit**. (Hors périmètre v1, prévues.)

## Le récit : direction, chemin, obstacles, point d'entrée

Une carte sans quête ne se lit pas. `public/garden-narrative.js` (module pur,
testé) calcule le récit d'un district et répond, dans l'ordre où un lecteur se
les pose, à quatre questions :

0. **Le jardin-endgame.** La destination d'un district est son **point de
   convergence** — ce sur quoi plusieurs ouvrages mettent leur poids — quel que
   soit son type. Dans le district Science, cinq ouvrages `IMPLEMENTS` la thèse
   « Connaissance scientifique calculable » pendant que le seul état observable
   n'en reçoit qu'un : désigner l'état comme but affichait un jardin vide à côté
   du vrai centre de gravité. L'état observable devient le **fruit**, posé à la
   sortie du jardin. À convergence égale, l'observable l'emporte — c'est lui qui
   est falsifiable.

   Le jardin n'est pas une carte : c'est une **clairière**, avec son nom écrit en
   entier et **les ouvrages qui le définissent plantés en arc sur son pourtour**.
   Il se lit par ce qui le compose. Le briefing, l'avenue et le compte des
   parcelles sans destination visent tous le jardin : le texte ne peut pas
   annoncer un but que le dessin contredit.

1. **Où ça va ?** À défaut de jardin, la *cible* est l'état observable que le
   district cherche à déplacer. Deux règles de choix comptent autant que le choix lui-même : un
   état `indésirable` est un **danger, pas une destination** (il ne prend la tête
   que si le district ne vise rien d'autre) ; et à type égal, la cible est celle
   vers laquelle le district **argumente réellement**, donc celle qui reçoit le
   plus d'arêtes avançantes.
2. **Par où passe-t-on ?** L'*avenue principale* remonte depuis la cible par
   l'arête la plus porteuse, sans jamais revenir en arrière. Une arête chiffrée
   pèse plus qu'une arête nue : le chemin passe par ce qui est défendu.
3. **Qu'est-ce qui barre ?** Une question ouverte n'est un *verrou* que si elle
   bloque quelque chose. Elle se dresse **en travers de la route, devant ce
   qu'elle bloque** — plus au milieu d'un lien invisible.
4. **Par où commencer ?** Le premier jalon de l'avenue, numéroté ① sur la ville
   et proposé en bouton dans le briefing.

## Le vocabulaire d'objets : un objet montre sa fonction *et* s'il la remplit

`public/garden-objects.js` (module pur, testé) donne **un objet à chacun des 30
types de nœuds et un raccord à chacun des 41 prédicats**. Deux tests verrouillent
la correspondance exacte avec l'ontologie : ni type sans objet, ni objet inventé.

Le principe dont tout découle : l'ontologie dit qu'un `mechanism` est un *« moyen
technique ou organisationnel »*. C'est donc une **machine**, avec une bouche
d'entrée et une buse de sortie. Et une machine qui n'admet rien et ne produit
rien se dessine d'elle-même comme un **caisson scellé**.

### Les ports, et ce qu'un port bouché révèle

Quatre faces plus un capteur : `intake` (ce qui alimente), `outlet` (l'effet
produit), `footing` (ce qui fonde), `cap` (ce qui protège ou éprouve), `sensor`
(ce qui mesure). Chaque type déclare les siens ; **un port déclaré mais non
raccordé se dessine bouché**. Le rendu est factuel, jamais alarmiste : on
constate en regardant, le quartier ne vire pas au rouge.

Une machine a quatre régimes, et non deux — « avale sans rien produire » n'est
pas un caisson scellé, et c'est le cas le plus parlant :

| Régime | Entrée | Sortie | Corpus |
|--------|--------|--------|-------:|
| `running` | raccordée | raccordée | 4 |
| `swallows` | raccordée | **bouchée** | 16 |
| `vents` | bouchée | raccordée | 5 |
| `sealed` | bouchée | bouchée | **103** |

### « A bloque B », en quatre temps

C'est là que les ports paient. Une barrière posée à côté d'un lien invisible
n'apprend rien ; branchée sur un port, elle raconte :

1. La barrière est plantée **dans l'entrée de B**, pas à côté.
2. Le flux qui y arrive **s'accumule contre elle** — une pression qui ne passe
   pas. S'il n'arrive aucun flux, la barrière reste sèche : on ne feint pas une
   pression qui n'existe pas.
3. Une **amorce remonte jusqu'à A**, pour qu'on sache qui bloque.
4. Un `ADDRESSES` pose une **planche en matière d'échafaudage** : franchissable
   provisoirement, jamais prouvé — exactement ce que le prédicat signifie.

Trois choses distinctes qui se confondaient : `BLOCKS` est une **barrière** dans
l'entrée, `CONTRADICTS` un **choc** entre deux sorties, `SAFEGUARDS` un
**bouclier** boulonné sur le chapeau, qui n'interrompt aucun flux.

### Deux pièges à mensonge tenus par des tests

`design_effect` est *« l'effet désiré, à ne pas confondre avec un effet
observé »* : c'est un **hologramme de cible**, translucide et sans aucun port —
jamais le phare d'un `system_state`. Et `design_rationale` est *« la tension
expliquant pourquoi un mécanisme est proposé »* : c'est une **fissure dans le
sol**, pas un socle. Un test interdit à ces silhouettes de se ressembler.

### Deux canaux qui ne se marchent pas dessus

La **matière** dit le statut épistémique (bâti, chantier, ruine…), la
**silhouette** dit le rôle dans le récit. Tout était carré parce que 30 types
partageaient une seule forme.

| Rôle | Silhouette |
|------|------------|
| cible (`system_state`, `metric`, `horizon`) | **phare** — mât, lanterne, socle |
| verrou (`open_question`, `decision`) | **grille** — barreaux verticaux, c'est fermé |
| machinerie (`mechanism`, `institution`…) | **bâtiment** — ligne de toit |
| socle (`axiom`, `source_document`…) | **assise** épaisse au sol |

La lanterne d'un phare est **allumée en proportion des affirmations causales
chiffrées qui visent la cible**. Un phare éteint est un objectif que personne n'a
encore défendu par un nombre. C'est le seul remplissage partiel de la vue, et il
mesure une vraie quantité — un demi-rectangle rempli se lit comme « à 50 % », ce
qui serait un chiffre inventé s'il ne codait qu'une catégorie.

### Ce que le briefing n'a pas le droit de dire

Le briefing tient en tête de la colonne d'inspection, **jamais en surimpression
sur la carte** : posé sur le terrain, ce panneau opaque masquait jusqu'à quatre
parcelles, dont l'étape ① vers laquelle son propre bouton renvoie.

Le dessin ne peut pas davantage contredire le texte. Une zone **« aucune
cible »** plantée à côté d'une clairière qui vient de nommer une destination
énonce le contraire de ce que le briefing annonce : quand un jardin existe, ce
qui manque n'est pas le but mais le **fruit**, et cela se dit dans la clairière
(« aucun état observable n'en sort »). La zone du vide est réservée aux
districts qui ne visent réellement rien. De même, une voie que le jardin a
entièrement vidée n'est plus dessinée : il ne resterait qu'une plaque de sol et
un titre, souvent sous la clairière elle-même.

Un `ADDRESSES` signifie qu'une proposition **traite** la question, jamais qu'elle
est validée. Annoncer « aucun verrou ne barre la route » parce que tout est
adressé serait le mensonge exact que cette vue combat. Le briefing sépare donc
« verrous ouverts » et « verrous traités par une réponse, mais aucune n'est
validée », et il compte les parcelles qui ne mènent à aucune cible.

## Layout — deux étages, sans recouvrement

Une ville illisible n'est pas une ville. **La ville a un axe, pas un anneau** :
un anneau de districts ne donnait aucun ordre de lecture — on ne savait ni par où
commencer, ni où ça menait.

1. **Cinq voies de gauche à droite** : socle, machinerie, affirmations, approche,
   cible observable. La position dit la **distance à la cible**, mesurée en sauts
   sur les prédicats qui avancent (`FORWARD_PREDICATES` — un `DERIVED_FROM` ou un
   `PART_OF` ne progresse pas : ce sont de la provenance et de l'imbrication). Le
   sol s'éclaircit à mesure qu'on avance. Le cluster n'est plus qu'une teinte.
2. **Ordre vertical par barycentre** : un nœud se rapproche de ses voisins de la
   voie précédente, ce qui réduit les croisements sans layout stochastique. Une
   voie se replie en colonnes **à la hauteur qui donne au quartier la forme du
   volet** : un pli fixe produisait un quartier deux fois plus haut que large là
   où le volet est deux fois plus large que haut, et la moitié de l'échelle de
   lecture partait dans les marges latérales.

L'axe est **strictement monotone** : toute parcelle d'une voie est à gauche de
toute parcelle de la voie suivante, et aucune ne recouvre une autre.

La taille d'une parcelle vient de **son texte**, jamais l'inverse : le libellé
est mesuré puis replié sur deux lignes au plus, et la carte s'ajuste. Les noms
ne sont plus tronqués à l'aveugle au même nombre de caractères.

### Un jardin est dense, pas un échangeur

Puisque la carte est dimensionnée **par** son texte, grossir la police ne rend
rien lisible : tout grandit ensemble. Les deux seules quantités qui décident de
la lisibilité sont le **vide entre les parcelles** et le **chrome de chaque
carte** — gouttière, marges, pied de type. Une allée de 96 unités entre deux
voies, soit la moitié d'une carte, n'apporte aucune information et coûte le
tiers de l'échelle de lecture.

Conséquence directe sur la phrase du nœud : elle ne s'écrit que **là où il y a
la place de la lire**, c'est-à-dire dans la clairière et sur le fruit. La poser
sur les cartes de l'avenue et du pourtour les faisait passer de 186×71 à
238×121 — deux fois l'encombrement — pour un texte rendu à 8 px, donc illisible.
On payait la place sans obtenir la lecture. Ailleurs, la phrase est dans
l'inspecteur, en taille réelle.

Mesures sur `causal-science-implementation` (53 parcelles, volet 1196×645) :

| | échangeur | jardin |
|---|---:|---:|
| boîte occupée | 2612 × 1094 | **1671 × 868** |
| carte type | 238 × 121 | **155 × 58** |
| nom rendu, cadré sur la destination | 8,2 px | **12,2 px** |
| nom rendu, « Cadrer tout le district » | 5,3 px | **8,2 px** |

`?debug=1` expose l'état du layout dans `window.__garden` pour vérifier ces
invariants depuis la console.

### Navigation dans la ville

**Le cadrage d'ouverture montre la destination, pas la carte.** Un district de
53 parcelles occupe trois fois l'aire du volet : tout afficher d'un coup réduit
chaque nom à cinq pixels, c'est-à-dire ne montre rien. Cadrer l'avenue entière
ne sauve rien non plus — elle traverse toutes les voies par construction. La
caméra s'ouvre donc sur ce que le briefing annonce en premier : le jardin et les
ouvrages plantés sur son pourtour ; à défaut de jardin, la cible observable et
la fin de l'avenue. Sur un district assez petit pour tenir en entier, le récit
*est* la carte et le cadrage complet s'applique tel quel.

Corollaire : puisque la vue n'est plus complète, **toute sélection amène la
caméra à la parcelle** — « Commencer ici », un clic sur une relation, une flèche
du clavier. Une parcelle déjà lisible ne déplace pas le décor pour rien.

La carte possède une caméra indépendante du layout : la molette zoome autour du
point visé, le glisser sur le terrain déplace la ville, les contrôles `−` et `+`
zooment au centre et **Cadrer tout le district** restaure le cadrage complet. Le SVG et le
Canvas des flux partagent exactement la même caméra, afin qu'un flux ne se
décroche jamais de la route qu'il matérialise. Le zoom est borné entre un tiers
et douze fois le cadrage initial.

Lorsqu'une parcelle est sélectionnée, son voisinage direct constitue le plan
lisible : les autres parcelles, leurs liens et leurs flux restent visibles mais
atténués par défaut. Le contrôle avancé **Garder le district visible après une
sélection** peut être désactivé pour isoler strictement le voisinage. Les voisins
externes au district restent, eux, désactivés à l'ouverture.

## Le marcheur — la loi L4 qui traverse la ville

Une carte qui a un début et une fin appelle quelqu'un qui les parcourt. Mais un
personnage qui se promènerait pour l'ambiance serait la première décoration de
cette vue, donc le premier mensonge. Le marcheur est donc une **expérience** :
il exécute `l4-physical-propagation-rule` — une loi que le graphe déclare
`design_proposal` et dont le nœud dit lui-même « contrat de design, pas encore
une loi calibrée » :

```
I_ab(t) = E(t) · W(t) · P_ab · G(t) · K(t ; delay, duration, recency, stability)
```

Sa lanterne **est** `I(t)` ; elle ne code rien d'autre. Il ne s'arrête jamais —
il s'affaiblit, et son état d'arrivée dit la solidité de la chaîne. Trois états
qui ne se confondent pas : allumée, **éteinte** (la loi a calculé zéro),
**creuse** (la loi n'a pas de valeur). Une loi muette ne dit pas que l'effet est
nul : l'indétermination se propage en aval sans jamais devenir un zéro commode.

### Rien n'est inventé en silence

Trois facteurs sont **stipulés** faute de donnée, et la vue les affiche :

| | ce que la loi demande | ce que l'expérience a fait |
|---|---|---|
| `E` | « injectée puis décroissante », sans taux | aucun taux introduit : E du pas suivant = I du pas précédent |
| `W` | poids appris à long terme | substitution de `traversalWeight`, dont l'ontologie dit qu'il n'est « ni une probabilité ni une confiance » |
| `K` | delay, duration, recency, stability | 1 — le corpus ne porte aucune de ces quantités : le cœur temporel n'est pas exercé |

Un test refuse tout facteur dont l'origine n'est pas déclarée, et toute
justification qui ne correspondrait à aucun facteur de l'équation.

### Ce que la marche a trouvé

**La loi ne distingue pas un pont de pierre d'un pont de corde.**
`effectSizePct`, `confidenceScore` et `evidenceBasis` ne sont dimensions
d'aucun de ses cinq facteurs : deux chaînes de même longueur et de même famille
produisent exactement la même influence, que l'une soit défendue par une preuve
du monde réel et l'autre par rien. La ville rend cette différence visible depuis
la v1 ; la loi ne la voit pas. Cette cécité **n'est pas dans les limites que la
loi énonce elle-même** — elle apparaît en la faisant tourner.

Deuxième trouvaille : deux états du corpus sortent de son domaine de définition
— un verrou `ADDRESSES` (traité, jamais validé), et les 30 arêtes dont la
polarité écrite est « mixte » alors que la loi exige un scalaire dans `[-1,1]`.

L'expérience et ses deux observations vivent dans le graphe
(`l4-walk-experiment`, `TESTS` → la loi), pas seulement dans cette page : un
résultat qui n'existerait que dans une vue ne serait pas un résultat.

## Rendu — hybride SVG + Canvas

- **SVG** (accessible) : districts, parcelles/nœuds, routes, murs, ponts,
  racines. Focusable au clavier, `role`/`aria-label`, texte natif.
- **Canvas** (par-dessus) : particules de **flux** (`FEEDS`), énergie ambiante
  des nœuds vivants. Purement décoratif ; jamais la seule source d'information.
- `prefers-reduced-motion` : le Canvas passe en flux statique pointillé.

## Esthétique

Colorée, accessible, un brin futuriste ; énergie / eau / feu en mouvement.
Palette d'éléments : eau `#38bdf8`, énergie `#fbbf24`, feu / tension `#fb7185`,
croissance `#34d399`, provenance (souterrain) violet estompé. Respecte le thème
clair / sombre partagé (`theme.js`).

## Accessibilité

- Chaque nœud est un élément SVG focusable (`tabindex`), nommé, décrit ;
  navigation fléchée entre districts et nœuds.
- Liste textuelle parallèle des nœuds visibles (lecteurs d'écran).
- L'information n'est jamais portée par la seule couleur : forme + glyphe +
  texte redondants (mur hachuré, faille en zigzag, chantier hachuré…).
- Le mouvement est désactivable et respecte `prefers-reduced-motion`.

## Portée de la v1

Cluster par défaut : `science-endgame` (`/garden.html?cluster=…`). Le **cœur Mind
Protocol** — les 180 nœuds sans `clusterId`, où vivent 21 des 26 affirmations
causales — est un district à part entière, désigné par `?cluster=` (vide).

Implémenté : districts + layout hybride ; parcelles à vitalité épistémique
(échafaudage pour les propositions) ; **`BLOCKS`/`SAFEGUARDS` en mur/faille/
rempart** (cas fondateur) ; **`FEEDS` en flux animé** ; **franchissements
`CAUSES`/`LEADS_TO` en corde ↔ pierre** selon la quantification de l'arête ;
routes structurelles (`IMPLEMENTS`, `GROUNDS`, `SUBCASE_OF`, `TESTS`,
`ADDRESSES`) ; racines de provenance masquables ; inspecteur latéral ; clavier +
`reduced-motion` + thème.

La table de correspondance vit dans `public/garden-affordance.js`, module pur
sans DOM, couvert par `test/garden-affordance.test.js`.

Hors v1 (suite) : carrefours engorgés (betweenness) ; ronds-points (boucles) ;
multi-clusters simultanés ; couche de particules feu pour les tensions
`CONTRADICTS` ; actions depuis une parcelle (commenter, financer un gap, lancer
un test) — prolongement du *microscope de claim* du cluster Science Endgame.

## Provenance de la donnée

La page interroge `/api/graph` (même pipeline que les autres pages), puis filtre
sur `clusterId` + voisins directs. Aucune donnée dupliquée ; la source de vérité
reste `data/*.json` → seed → FalkorDB.
