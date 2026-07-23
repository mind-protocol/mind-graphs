// Transformation déterministe d'une lacune du graphe en consultation externe.
//
// Doctrine (consultationContract de l'ontologie) : une consultation soumet un point précis du
// graphe à une audience qu'on ne contrôle pas, puis rapporte ce qui en revient sans lui donner un
// statut qu'il n'a pas. Le générateur est extractif comme cluster-presentation.js : il assemble
// `phrase`, `summary`, `diagnosis` et `action` du corpus, il n'invente ni chiffre, ni causalité,
// ni argument. Ce qu'il ajoute est un cadrage — pourquoi la question est posée, quelle réponse
// serait utile, quelle réponse ne le serait pas.
//
// Il ne publie rien. La passerelle vers le forum reste manuelle : le module écrit un brouillon,
// un humain décide de le publier, de le reformuler ou de l'abandonner.

const idOf = value => typeof value === "object" && value !== null ? value.id : value;

/**
 * Cadrage éditorial par catégorie de finding.
 *
 * `ask` formule la demande, `useful` dit ce qui ferait avancer le graphe, `useless` dit ce qui
 * n'a pas sa place — ce dernier champ n'est pas décoratif : sans lui une audience répond
 * spontanément par des chiffres nus, que la doctrine interdit d'incorporer.
 */
export const CONSULTATION_FRAMES = {
  unanswered_question: {
    order: 1,
    code: "question",
    label: "Question non résolue",
    intent: "ouvrir une question que le corpus laisse structurellement ouverte",
    heading: "Question ouverte",
    problem: (finding, context) => {
      const question = context[0];
      const stake = question?.decisionNeeded || finding.action;
      return [
        `Je bute sur cette question depuis un moment : **${question?.name || finding.title}**`,
        question?.summary || question?.phrase || "",
        stake ? `Ce qu'il faut en tirer : ${stake}` : "",
        "Je n'ai pour l'instant aucune réponse qui tienne, et plusieurs autres décisions attendent celle-ci."
      ];
    },
    ask: () => "Qu'est-ce qui vous ferait pencher d'un côté ou de l'autre, et pourquoi ?",
    useful: [
      "Un critère de décision auquel je n'ai pas pensé.",
      "Un cas réel où la question s'est déjà tranchée, dans un sens ou dans l'autre.",
      "Une raison de considérer que la question est mal posée."
    ],
    useless: [
      "Un vote pour une option sans le raisonnement qui le porte : je ne compte pas les voix, je cherche les arguments."
    ],
    priorityBonus: 6
  },
  unquantified_causal: {
    order: 2,
    code: "causal",
    label: "Arête causale non chiffrée",
    intent: "chercher un ordre de grandeur ou un contre-exemple pour un effet affirmé mais non mesuré",
    heading: "Effet affirmé, jamais mesuré",
    problem: (finding, context) => {
      const [cause, effect] = context;
      return [
        `J'affirme dans mon modèle que **${cause?.name || finding.path?.[0]}** déplace **${effect?.name || finding.path?.[1]}**.`,
        cause?.summary || cause?.phrase || "",
        effect?.summary || effect?.phrase || "",
        "Je n'ai aucun ordre de grandeur pour cet effet. Tel quel, l'affirmation est indiscernable d'une intuition, et je préfère l'écrire que la maquiller."
      ];
    },
    ask: () => "Avez-vous observé ce lien dans le réel, et de quel ordre de grandeur ?",
    useful: [
      "Un ordre de grandeur accompagné du contexte qui le produit : population, durée, baseline.",
      "Une source, une étude ou une expérience de terrain, même partielle.",
      "Une raison structurelle pour laquelle l'effet serait nul, voire inverse."
    ],
    useless: [
      "Un pourcentage sans contexte ni provenance : il serait invérifiable, et je ne l'inscrirais pas.",
      "Une intuition présentée comme un résultat."
    ],
    priorityBonus: 4
  },
  contradiction: {
    order: 3,
    code: "tension",
    label: "Contradiction ou tension",
    intent: "qualifier deux affirmations tenues simultanément",
    heading: "Deux affirmations que je tiens en même temps",
    problem: (finding, context) => {
      const [first, second] = context;
      return [
        "Mon modèle contient ces deux affirmations, et je n'arrive pas à abandonner ni l'une ni l'autre.",
        first ? `**A — ${first.name}** : ${first.summary || first.phrase || ""}` : "",
        second ? `**B — ${second.name}** : ${second.summary || second.phrase || ""}` : "",
        "Soit l'une des deux est fausse, soit il manque une distinction de contexte que je ne vois pas."
      ];
    },
    ask: () => "Est-ce une vraie incompatibilité, ou un contexte manquant qui les réconcilie ?",
    useful: [
      "Le contexte, l'échelle ou le délai qui rendrait les deux affirmations compatibles.",
      "La démonstration que l'une des deux est simplement fausse.",
      "Un troisième cas qui casse les deux."
    ],
    useless: [
      "Le choix d'un camp sans dire ce qui distingue les deux situations."
    ],
    priorityBonus: 5
  },
  underspecified_solution: {
    order: 4,
    code: "mecanisme",
    label: "Solution sous-spécifiée",
    intent: "chercher les angles morts d'un mécanisme proposé sans implémentation ni test",
    heading: "Mécanisme proposé, jamais éprouvé",
    problem: (finding, context) => {
      const [mechanism, ...rest] = context;
      return [
        `Je propose ce mécanisme : **${mechanism?.name || finding.title}**`,
        mechanism?.summary || mechanism?.phrase || "",
        rest.length ? `Il est censé servir : ${rest.map(node => node.name).join(", ")}.` : "",
        "Il n'a jamais été implémenté ni testé. Je cherche les raisons pour lesquelles il ne marcherait pas avant d'y investir quoi que ce soit."
      ];
    },
    ask: () => "Où est-ce que ça casse, et qu'est-ce qui a déjà été tenté de similaire ?",
    useful: [
      "Un mode d'échec concret, avec les conditions qui le déclenchent.",
      "Un système existant qui a tenté la même chose, et ce qu'il en est advenu.",
      "Le détail d'implémentation qui rend la proposition irréaliste."
    ],
    useless: [
      "Un enthousiasme général : il ne discrimine rien et gonflerait une confiance que rien ne soutient."
    ],
    priorityBonus: 0
  }
};

export const CONSULTABLE_CATEGORIES = Object.keys(CONSULTATION_FRAMES);

const slug = (value, max = 60) => String(value)
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max);

/**
 * Clé d'une consultation, dérivée de son sujet et non de son rang dans le rapport.
 *
 * Les identifiants de findings ne conviennent pas : `contradiction:explicit:3` ne décrit que la
 * position d'itération, si bien que toutes les contradictions se ramèneraient à la même clé, et
 * qu'un simple réordonnancement des liens créerait des doublons. La paire (catégorie, nœuds
 * consultés) est en revanche stable d'un run à l'autre et unique par sujet.
 */
export function consultationKey(category, targetIds) {
  const subject = targetIds.slice(0, 2).map(id => slug(id, 26)).join("--");
  return `consultation-${CONSULTATION_FRAMES[category]?.code || slug(category, 12)}-${subject}`;
}

/**
 * Sujets d'un finding, dans l'ordre où le cadre éditorial les lit.
 *
 * L'ordre n'est pas cosmétique : pour une arête causale, `nodeId` désigne la cible et
 * `relatedNodeIds` porte le couple (source, cible). Concaténer les deux inverserait la flèche et
 * publierait l'affirmation à l'envers. Les cadres qui parlent d'une arête lisent donc le couple,
 * ceux qui parlent d'un objet lisent l'objet puis son voisinage.
 */
function subjectIds(finding) {
  const related = (finding.relatedNodeIds || []).filter(Boolean);
  const edgeShaped = ["unquantified_causal", "contradiction"].includes(finding.category);
  const ordered = edgeShaped && related.length >= 2 ? related : [finding.nodeId, ...related];
  return [...new Set(ordered.filter(Boolean))];
}

function contextNodes(finding, nodeById) {
  return subjectIds(finding).map(id => nodeById.get(id)).filter(Boolean).slice(0, 4);
}

/**
 * Objets du graphe que la consultation interroge réellement.
 *
 * Restreint aux types que `CONSULTS` accepte : le voisinage aval d'une question peut contenir
 * des types que le contrat refuse, et les inclure produirait un corpus invalide.
 */
const CONSULTABLE_TARGET_TYPES = new Set([
  "protocol", "axiom", "unlock", "mechanism", "institution", "horizon", "design_rationale",
  "economic_mechanism", "design_effect", "working_hypothesis", "decision", "decision_option",
  "claim", "forecast_event", "estimate", "open_question", "system_state", "metric",
  "observation", "experiment", "dataset", "method"
]);

function consultedTargets(finding, nodeById) {
  return subjectIds(finding)
    .filter(id => CONSULTABLE_TARGET_TYPES.has(nodeById.get(id)?.nodeType))
    .slice(0, 3);
}

/**
 * Types dont la présence signale que la réponse est déjà dans le graphe.
 *
 * Une hypothèse contredite par une observation ou un jeu de données ne se tranche pas dehors :
 * la preuve est là, il reste à l'appliquer. Soumettre ces cas ferait perdre du crédit sur les
 * questions qui, elles, ont réellement besoin d'un regard extérieur.
 */
const SELF_RESOLVABLE_TYPES = new Set(["observation", "experiment", "dataset"]);

function selfResolvable(finding, nodeById) {
  if (finding.category !== "contradiction") return false;
  return [finding.nodeId, ...(finding.relatedNodeIds || [])]
    .filter(Boolean)
    .some(id => SELF_RESOLVABLE_TYPES.has(nodeById.get(id)?.nodeType));
}

/**
 * Classe les findings consultables par valeur attendue d'une réponse externe.
 *
 * Le tri n'est pas celui de l'analyse : une lacune peut être prioritaire pour le projet et
 * inutile à soumettre — une métrique orpheline se règle en interne. Le bonus par catégorie encode
 * ce qu'une audience extérieure peut réellement apporter.
 *
 * La sélection alterne ensuite les catégories. Sans cela un lot entier part en contradictions,
 * qui dominent le score : on publierait quatre fois la même forme de question, et les questions
 * ouvertes — celles qu'une audience traite le mieux — ne sortiraient jamais.
 */
export function selectConsultationCandidates(report, options = {}) {
  const { nodes = [], limit = 5, categories = CONSULTABLE_CATEGORIES, existingKeys = new Set() } = options;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const allowed = new Set(categories);
  const ranked = (report.findings || [])
    .filter(finding => allowed.has(finding.category))
    .map(finding => {
      const frame = CONSULTATION_FRAMES[finding.category];
      const targets = consultedTargets(finding, nodeById);
      return {
        key: consultationKey(finding.category, targets),
        finding,
        frame,
        score: finding.priority + frame.priorityBonus,
        targets,
        context: contextNodes(finding, nodeById)
      };
    })
    .filter(candidate => candidate.targets.length > 0)
    .filter(candidate => !existingKeys.has(candidate.key))
    .filter(candidate => !selfResolvable(candidate.finding, nodeById))
    .sort((a, b) => b.score - a.score || a.frame.order - b.frame.order || a.key.localeCompare(b.key));

  // Deux findings distincts peuvent viser le même couple de nœuds. Les soumettre deux fois
  // publierait deux posts sur la même question et créerait un identifiant en double au seed.
  const seen = new Set();
  const byCategory = new Map();
  for (const candidate of ranked) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    if (!byCategory.has(candidate.finding.category)) byCategory.set(candidate.finding.category, []);
    byCategory.get(candidate.finding.category).push(candidate);
  }

  const queues = [...byCategory.entries()]
    .sort((a, b) => CONSULTATION_FRAMES[a[0]].order - CONSULTATION_FRAMES[b[0]].order)
    .map(entry => entry[1]);
  const selected = [];
  while (selected.length < limit && queues.some(queue => queue.length)) {
    for (const queue of queues) {
      if (selected.length >= limit) break;
      const candidate = queue.shift();
      if (candidate) selected.push(candidate);
    }
  }
  return selected.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/**
 * Nœud `consultation` en statut `draft`, plus ses arêtes `CONSULTS`.
 *
 * Le nœud naît toujours en `draft` : c'est un humain qui publie, et un statut `published` écrit
 * par un script affirmerait une action qui n'a pas eu lieu.
 */
export function buildConsultationNode(candidate, options = {}) {
  const { today = "", channel = "reddit" } = options;
  const { finding, frame } = candidate;
  const node = {
    id: candidate.key,
    name: `Consultation · ${finding.title}`,
    phrase: `${frame.intent} Soumis à une audience externe, sans engagement sur la valeur des réponses.`,
    family: `Consultation externe · ${frame.label}`,
    summary: `${finding.summary} ${finding.diagnosis} La consultation demande : ${frame.ask(finding)} Elle n'engage aucune valeur du modèle : ce qui reviendra sera attribué à son auteur, jamais compté comme preuve.`.trim(),
    nodeType: "consultation",
    consultationStatus: "draft",
    consultationChannel: channel,
    consultationCategory: finding.category,
    askedAt: today,
    findingId: finding.id,
    dateLabel: today,
    clusterId: "consultations"
  };
  const links = candidate.targets.map(targetId => ({
    source: node.id,
    target: targetId,
    type: "CONSULTS",
    justification: `La consultation soumet ce point à une audience externe afin de ${frame.intent}. Elle interroge, elle ne conclut pas : aucune réponse ne validera ce nœud.`
  }));
  return { node, links };
}

function bullets(items) {
  return items.map(item => `- ${item}`).join("\n");
}

/**
 * Brouillon de post, en Markdown.
 *
 * Le corps s'adresse à des inconnus : il ne contient donc ni prédicat, ni score de priorité, ni
 * nom d'indicateur interne. Un lecteur à qui l'on annonce qu'« aucune solution n'est reliée par
 * ADDRESSES » ne répond pas, il s'en va. Le diagnostic de l'analyse reste dans le nœud
 * `consultation`, qui est interne ; le post ne porte que la matière du problème.
 *
 * Le texte reste en français et extractif : le corpus est en français et le générateur n'invente
 * aucune formulation. L'adaptation au ton et à la langue du forum visé est une étape humaine,
 * signalée par l'en-tête du fichier — la traduire ici serait produire du contenu que le graphe
 * ne contient pas.
 */
export function renderConsultationPost(candidate, options = {}) {
  const { today = "" } = options;
  const { finding, frame, context } = candidate;
  const sections = [
    `<!-- BROUILLON — rien n'a été publié. Relire, couper, adapter au ton et à la langue du forum visé, puis publier soi-même. -->`,
    `<!-- Consultation ${candidate.key} · finding ${finding.id} -->`,
    ``,
    `# ${frame.heading} — ${finding.title}`,
    ``,
    ...frame.problem(finding, context).filter(Boolean).flatMap(paragraph => [paragraph, ``]),
    `## Ce que je demande`,
    ``,
    frame.ask(finding),
    ``,
    `### Une réponse utile ressemble à ça`,
    ``,
    bullets(frame.useful),
    ``,
    `### Une réponse que je ne pourrai pas incorporer`,
    ``,
    bullets(frame.useless),
    ``,
    `---`,
    ``,
    `*Ce que j'en ferai : les réponses sont enregistrées comme des positions attribuées à leur auteur, avec un lien vers le fil. Elles ne modifient aucune valeur chiffrée de mon modèle — un argument convaincant y produit une tâche ou une expérience, pas un chiffre. Préparé le ${today}.*`,
    ``
  ];
  return sections.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Squelette de récolte : une entrée par intervention repérée dans le fil.
 *
 * Le typage d'une réponse — affirmation, hypothèse, question, objection — est un jugement, jamais
 * une déduction syntaxique. Le script produit donc des marqueurs TODO à trancher, exactement comme
 * `buildObservableScaffold` pour les états observables.
 */
export function buildHarvestScaffold(consultation, thread, options = {}) {
  const { today = "" } = options;
  const comments = thread.comments || [];
  const authors = [...new Set(comments.map(comment => comment.author).filter(Boolean))];
  const actorNodes = authors.map(author => ({
    id: `actor-${slug(`${consultation.consultationChannel}-${author}`)}`,
    name: author,
    phrase: "TODO — ce que cette personne apporte au fil, en une phrase.",
    family: `Acteur · ${consultation.consultationChannel}`,
    summary: "TODO — position tenue, et pourquoi elle est utile au graphe.",
    nodeType: "actor",
    sourceUrl: thread.authorUrlPattern ? thread.authorUrlPattern.replace("{author}", author) : "",
    clusterId: consultation.clusterId || "consultations"
  }));
  const replyNodes = comments.map((comment, position) => ({
    id: `${consultation.id}-reply-${String(position + 1).padStart(2, "0")}`,
    name: `TODO — titre court de l'apport de ${comment.author || "anonyme"}`,
    phrase: "TODO — l'apport en une phrase, à la voix de son auteur.",
    family: `Signal externe · ${consultation.consultationChannel}`,
    summary: comment.body || "",
    nodeType: "TODO — claim | working_hypothesis | open_question | design_rationale | observation",
    epistemicStatus: "documented",
    dateLabel: today,
    clusterId: consultation.clusterId || "consultations",
    _todo: "Le résumé porte le texte brut. Le réécrire, choisir le nodeType, puis supprimer ce champ.",
    _author: comment.author || ""
  }));
  const links = [];
  for (const reply of replyNodes) {
    links.push({
      source: reply.id,
      target: consultation.id,
      type: "ANSWERS",
      justification: `Cette intervention répond à la consultation ${consultation.id} dans le fil qu'elle a ouvert. Elle documente une position, elle ne la valide pas.`
    });
    const author = actorNodes.find(actor => actor.name === reply._author);
    if (author) {
      links.push({
        source: reply.id,
        target: author.id,
        type: "AUTHORED_BY",
        justification: `L'intervention est publiée par ${author.name} dans le fil de la consultation.`
      });
    }
    links.push({
      source: reply.id,
      target: "TODO — nœud du graphe visé",
      type: "TODO — MOTIVATES | BLOCKS | CONTRADICTS | ADDRESSES | IMPLEMENTS",
      justification: "TODO — dire précisément ce que cette intervention fait au nœud visé."
    });
  }
  return {
    consultationId: consultation.id,
    generatedAt: today,
    rule: "Aucun nœud de ce fichier ne peut porter probabilityPct, confidenceScore ou effectSizePct, ni être source d'un SUPPORTS_ESTIMATE. Une réponse convaincante produit une tâche, pas un chiffre.",
    todo: [
      "Trancher chaque nodeType et chaque prédicat marqué TODO.",
      "Réécrire name, phrase et summary : le texte brut du fil n'est pas une formulation du graphe.",
      "Supprimer les interventions sans apport, plutôt que les typer faiblement.",
      "Supprimer les champs _todo et _author, puis déplacer le résultat dans data/consultations.json."
    ],
    nodes: [...actorNodes, ...replyNodes],
    links
  };
}

/**
 * Découpe un fil collé en interventions.
 *
 * Format attendu, volontairement pauvre parce que la passerelle est manuelle : un bloc par
 * intervention, introduit par une ligne `## u/pseudo` (ou `## pseudo`). Tout ce qui précède le
 * premier en-tête est ignoré comme préambule.
 */
export function parseThread(raw) {
  const lines = String(raw).split(/\r?\n/);
  const comments = [];
  let current = null;
  for (const line of lines) {
    const header = /^##\s+(?:u\/)?(\S+)\s*$/.exec(line);
    if (header) {
      if (current) comments.push(current);
      current = { author: header[1], body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) comments.push(current);
  return { comments: comments.map(comment => ({ ...comment, body: comment.body.trim() })).filter(comment => comment.body) };
}

/** Nœuds atteints par un ANSWERS : la doctrine leur interdit toute quantification. */
export function harvestedNodeIds(links) {
  return new Set(links.filter(link => link.type === "ANSWERS").map(link => idOf(link.source)));
}
