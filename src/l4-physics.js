import { reinforceMoments } from "./moment-reinforcement.js";

// Moteur d'énergie L4 : la moitié dynamique de la physique signée.
//
// Ce que ce module fait, et surtout ce qu'il ne fait pas.
//
// Il fait circuler `energy` sur les liens et laisse `weight` apprendre lentement,
// selon la loi I = E·W·P·G·K du cluster `l4-ontology-mapping`. Il honore trois
// arbitrages déjà posés dans le graphe :
//
//   - `l4-role-energetics`, resserré par arbitrage : seul un `actor` **citoyen**
//     est une pompe. La citoyenneté est portée par un champ `citizen: true` sur
//     le nœud acteur ; un acteur documenté qui n'est pas citoyen (un compte
//     externe cité comme source) ne pompe pas. Un `Moment` reste un passage.
//   - L'énergie injectée par une pompe est **son propre poids**. Un citoyen porte
//     un `weight` (défaut 1) ; il pèse dans le graphe à proportion de ce poids.
//   - Le poids d'un citoyen **ne décroît jamais**. `relax` n'agit que sur les
//     liens ; les poids de nœud sont persistants par construction. C'est la
//     différence de loi d'évolution qui distingue un citoyen d'un lien.
//   - `l4-execution-tick` : aucun ordonnanceur global. Chaque acteur bat à sa
//     propre période et n'écrit que dans le voisinage atteint par son énergie.
//     Le double tampon vaut à l'intérieur d'une passe d'acteur.
//   - `question-l4-energy-budget`, tranchée par `decision-l4-conservation-forced` :
//     la propagation CONSERVE l'énergie, elle ne la duplique pas. Ce que weight ne
//     peut plus faire — multiplier la quantité transmise — est ce qui rend un
//     weight non borné inoffensif. weight ne biaise que la répartition. La
//     décroissance de `relax` reste, comme conversion de l'énergie en structure,
//     pas comme dissipation pure.
//
// Il NE fait PAS de seuil. `question-l4-activation-threshold` reste ouverte : la
// loi est un produit de facteurs, donc sans non-linéarité. Conséquence directe et
// mesurable ici : l'échelle d'injection est une jauge. Multiplier toutes les
// injections par k multiplie toutes les énergies par k sans changer un seul
// classement. Tant qu'aucun seuil n'existe, `actorInjection` ne décide de rien —
// c'est `decayPerTick` et `propagationGain` qui gouvernent la forme.
//
// Il n'écrit jamais dans `data/`. L'état est un runtime, pas un corpus.

/**
 * Auto-description des paramètres, lue par `npm run docs:parameters`.
 * `decisive` répond à une question testable : changer ce paramètre changerait-il
 * une conclusion sur laquelle le projet agit — ici, quels liens et quels
 * périmètres remontent chauds ?
 */
export const L4_PHYSICS_TUNING = Object.freeze({
  module: "l4-physics",
  label: "Moteur d'énergie L4",
  purpose: "Fait circuler l'énergie sur les liens du graphe selon la physique signée du cluster l4-ontology-mapping. Il ne produit aucune affirmation : il dit où le graphe est chaud, jamais si ce qui y est écrit est vrai.",
  parameters: Object.freeze({
    actorInjection: {
      value: 1,
      unit: "énergie par unité de poids",
      role: "Énergie injectée par une pompe à chaque tic, PAR UNITÉ DE POIDS du citoyen : un citoyen de poids w injecte w × actorInjection. Sans seuil dans la loi, cette valeur est une jauge — elle fixe l'unité, pas la forme. Elle redeviendra décisive le jour où question-l4-activation-threshold sera tranchée.",
      decisive: false,
      decisionId: null
    },
    queryInjection: {
      value: 1,
      unit: "énergie",
      role: "Énergie injectée par une requête le long du chemin qu'elle a réellement parcouru. Même statut de jauge que actorInjection tant qu'aucun seuil n'existe.",
      decisive: false,
      decisionId: null
    },
    decayPerTick: {
      value: 0.85,
      unit: "facteur",
      role: "Part de l'énergie conservée d'un tic au suivant. Fixe l'horizon de mémoire du moteur : une impulsion perd la moitié de son énergie en ln(0.5)/ln(0.85) ≈ 4,3 tics. Gouverne, avec propagationGain, la stabilité du système.",
      decisive: true,
      decisionId: null
    },
    propagationGain: {
      value: 0.1,
      unit: "part",
      role: "Part de sa propre énergie qu'un lien redistribue à son voisinage à chaque tic. La propagation CONSERVE : ce qui part par une composante positive est retranché à la source, jamais copié. weight n'entre pas dans cette quantité — il ne fait que biaiser la répartition entre destinataires. La quantité déplacée est donc toujours majorée par l'énergie du lien, indépendamment de weight.",
      decisive: true,
      decisionId: null
    },
    propagationFloor: {
      value: 0.001,
      unit: "énergie",
      role: "Énergie sous laquelle un lien cesse d'émettre et est remis à zéro. Empêche une poussière d'énergie de parcourir indéfiniment tout le graphe, ce qui annulerait la localité que l4-execution-tick exige.",
      decisive: true,
      decisionId: null
    },
    injectionRadius: {
      value: 1,
      unit: "sauts",
      role: "Distance à laquelle une pompe dépose son énergie autour d'elle. À 1, un acteur n'échauffe que ses arêtes incidentes et laisse la propagation faire le reste.",
      decisive: true,
      decisionId: null
    },
    weightGain: {
      value: 0.02,
      unit: "part",
      role: "Part de l'activation d'un lien versée dans son weight à chaque tic. C'est le mécanisme qui manquait à la définition de weight : « acquis au fil des coactivations » veut dire que l'énergie qui passe se transforme en structure. Ce n'est pas de la dissipation, c'est une conversion.",
      decisive: true,
      decisionId: null
    },
    weightDecay: {
      value: 0.0004,
      unit: "part",
      role: "Fuite structurelle de weight par tic, délibérément très faible : la structure oublie, mais des ordres de grandeur plus lentement que l'énergie ne s'éteint. C'est cet écart de constante de temps qui rend weight et energy séparables face au critère d'admission. La fuite effective est weightDecay × (1 - stability) : un lien régulièrement actif ne perd presque rien.",
      decisive: true,
      decisionId: null
    },
    stabilityRate: {
      value: 0.02,
      unit: "part",
      role: "Vitesse de la moyenne glissante qui estime stability à l'exécution, faute de pouvoir relire tout l'historique de coactivation à chaque tic. Proxy assumé : stability suit le niveau soutenu d'activation, pas encore sa régularité fine. C'est stability qui protège weight de l'oubli, réunissant les deux grandeurs dérivées que le noyau déclarait séparément.",
      decisive: true,
      decisionId: null
    },
    semanticGuidanceBeta: {
      value: 2,
      unit: "coefficient sans dimension",
      role: "Force avec laquelle la similarité cosinus entre le global workspace du flux et une sortie locale infléchit la répartition. Elle ne multiplie jamais l'énergie disponible : elle n'agit qu'avant la normalisation conservative.",
      decisive: true,
      decisionId: null
    },
    semanticTemperature: {
      value: 1,
      unit: "température softmax",
      role: "Température du softmax local. Une valeur basse concentre l'énergie sur les sorties les mieux alignées ; une valeur haute rapproche la distribution de celle gouvernée par weight seul.",
      decisive: true,
      decisionId: null
    },
    explorationRate: {
      value: 0.05,
      unit: "part de la distribution locale",
      role: "Part du budget local réservée à une distribution uniforme entre les sorties admissibles. Ce plancher empêche un embedding courant d'annuler toute chance de découvrir un détour sémantiquement éloigné.",
      decisive: true,
      decisionId: null
    }
  }),
  limitation: "Loi purement multiplicative, sans seuil ni porte calculée. Elle ne peut donc construire ni porte AND ni branchement, et ne doit pas être présentée comme un moteur d'exécution. `gate` est lu depuis les prototypes et vaut 1 partout tant qu'aucun sous-graphe de conditions n'est implémenté."
});

const P = Object.fromEntries(
  Object.entries(L4_PHYSICS_TUNING.parameters).map(([key, spec]) => [key, spec.value])
);

const idOf = value => (value && typeof value === "object" ? value.id : value);
const num = value => (typeof value === "number" && Number.isFinite(value) ? value : null);
const EPSILON = Number.EPSILON;

const validEmbedding = value => Array.isArray(value)
  && value.length > 0
  && value.every(component => typeof component === "number" && Number.isFinite(component));

export function cosineSimilarity(left, right) {
  if (!validEmbedding(left) || !validEmbedding(right) || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export const linkKey = link => `${idOf(link.source)}|${link.type}|${idOf(link.target)}`;

/**
 * Les pompes du graphe : les acteurs citoyens, avec leur poids. Politique isolée
 * ici pour qu'un seul endroit décide « qui pompe ». Un acteur non citoyen — un
 * compte externe cité comme source — n'apparaît pas. Le poids défaut est 1 : un
 * citoyen sans poids déclaré pèse une unité, il ne pèse jamais zéro.
 */
export function citizenPumps(nodes) {
  return nodes
    .filter(node => (String(node.nodeType).toLowerCase() === "actor" || String(node.semanticType).toLowerCase() === "subentity") && (node.citizen === true || node.subentity === true || String(node.semanticType).toLowerCase() === "subentity"))
    .map(node => ({
      id: node.id,
      weight: num(node.weight) ?? 1,
      semanticType: node.semanticType || node.nodeType,
      nodeType: node.nodeType
    }));
}

/**
 * Sous-système de logging hyper détaillé pour le moteur physique L4.
 * Formate et transmet les événements d'activation, d'injection et de transfert d'énergie.
 */
export function createPhysicsLogger(options = {}) {
  const enabled = Boolean(options.verbose || options.log || options.logger || options.onEvent);
  const events = [];

  const emit = event => {
    const timestamp = event.timestamp || new Date().toISOString();
    const enriched = { timestamp, ...event };
    events.push(enriched);

    if (typeof options.onEvent === "function") {
      options.onEvent(enriched);
    }
    if (typeof options.logger === "function") {
      options.logger(enriched);
    }

    if (options.verbose || options.log) {
      console.log(formatPhysicsEvent(enriched));
    }
  };

  return {
    enabled,
    emit,
    events,
    getLogSummary: () => ({
      totalEvents: events.length,
      activations: events.filter(e => ["ACTOR_ACTIVATION", "SUBENTITY_ACTIVATION", "THING_ACTIVATION"].includes(e.type)).length,
      transfers: events.filter(e => e.type === "ENERGY_TRANSFER").length,
      relaxations: events.filter(e => e.type === "RELAXATION").length
    })
  };
}

/**
 * Formate un événement de physique L4 en une ligne lisible enrichie d'indicateurs visuels.
 */
export function formatPhysicsEvent(event) {
  const time = event.timestamp ? event.timestamp.split("T")[1]?.slice(0, 8) || "" : "";
  const prefix = time ? `[${time}]` : "";

  switch (event.type) {
    case "THING_ACTIVATION": {
      const targetsStr = event.targetCount !== undefined ? ` (${event.targetCount} liens touchés)` : "";
      return `${prefix} [PHYSICS:THING] Thing "${event.originThingId || event.actorId}" injecte ${event.amount?.toFixed(3)} E via ${event.trigger || "événement"}${targetsStr}`;
    }
    case "ACTOR_ACTIVATION":
    case "SUBENTITY_ACTIVATION": {
      const isSubentity = event.type === "SUBENTITY_ACTIVATION" || (event.semanticType && event.semanticType.startsWith("subentity"));
      const icon = isSubentity ? "🤖" : "⚡";
      const tag = isSubentity ? "SUBENTITY" : "ACTOR";
      const targetsStr = event.targetCount !== undefined ? ` (${event.targetCount} liens touchés)` : "";
      return `${prefix} [PHYSICS:${tag}] ${icon} Acteur "${event.actorId}" [${event.semanticType || event.nodeType}] injecte ${event.amount?.toFixed(3)} E (poids=${event.weight})${targetsStr}`;
    }
    case "ENERGY_TRANSFER": {
      const moved = event.moved?.toFixed(4);
      const transfers = event.transfers || [];
      const positiveCount = transfers.filter(t => t.sign > 0).length;
      const negativeCount = transfers.filter(t => t.sign < 0).length;
      const detailStr = transfers.slice(0, 3).map(t =>
        `${t.sign > 0 ? "+" : "-"}${t.amount.toFixed(4)} E ➔ ${t.targetKey}`
      ).join(", ");
      const overflowStr = transfers.length > 3 ? ` ... (+${transfers.length - 3} autres)` : "";
      return `${prefix} [PHYSICS:TRANSFER] ➔ Lien "${event.linkKey}" (E=${event.energyBefore?.toFixed(4)}): déplacé ${moved} E [${positiveCount} transferts, ${negativeCount} inhibitions] :: ${detailStr}${overflowStr}`;
    }
    case "RELAXATION": {
      return `${prefix} [PHYSICS:RELAX] 📉 Decay tic ${event.tick ?? ""} | Énergie totale: ${event.totalEnergy?.toFixed(3)} E | Liens actifs: ${event.activeLinks}/${event.totalLinks} | Weight ajustés: +${event.weightGainedCount || 0} / -${event.weightLeakedCount || 0}`;
    }
    case "INJECTION_PATH": {
      return `${prefix} [PHYSICS:QUERY] 🔍 Parcours de requête injecté: ${event.amount?.toFixed(3)} E le long de ${event.nodeCount} nœuds (${event.touched} liens impactés)`;
    }
    default:
      return `${prefix} [PHYSICS:${event.type}] ${JSON.stringify(event)}`;
  }
}

/**
 * Renvoie une borne supérieure de l'énergie totale. Depuis le passage à la
 * propagation conservative (`decision-l4-conservation-forced`), la propagation ne
 * peut plus, à elle seule, faire diverger l'énergie : elle la déplace sans la
 * copier. Ce qui borne le total, c'est la décroissance de `relax` — chaque tic
 * retire une fraction (1 - decayPerTick), et le total converge vers
 * injection / (1 - decayPerTick).
 *
 * La borne historique injection / (1 - decay × (1 + gain)), calculée pour le
 * modèle à duplication, reste renvoyée comme enveloppe : elle est désormais
 * PESSIMISTE, donc toujours valide. Le garde qui refuse decay × (1 + gain) ≥ 1
 * est conservé : il rejette les réglages qui divergeraient sous duplication, ce
 * qui reste une sécurité utile même si la conservation ne les fait plus diverger.
 */
export function assertStable(tuning = P) {
  const factor = tuning.decayPerTick * (1 + tuning.propagationGain);
  if (!(factor < 1)) {
    throw new Error(
      `Régime divergent : decayPerTick × (1 + propagationGain) = ${factor.toFixed(4)} ≥ 1. `
      + "L'énergie totale croîtrait sans borne et le déclenchement local dégénérerait en global."
    );
  }
  return { factor, steadyStateTotalPerUnitInjected: 1 / (1 - factor) };
}

/**
 * Index topologique et physique. Les prototypes du dictionnaire fournissent
 * polarity, permanence et gate ; ils initialisent, ils ne sont pas l'identité
 * durable du lien (`exactNumericEqualityIsMeaning: false`).
 */
export function buildPhysicsIndex(nodes, links, profiles) {
  const profileOf = new Map(profiles.map(profile => [profile.source, profile]));
  const outOf = new Map();
  const inTo = new Map();
  const entries = [];

  for (const link of links) {
    const profile = profileOf.get(link.type);
    const physical = link.physics;
    if (!profile && !physical) continue;
    const source = idOf(link.source);
    const target = idOf(link.target);
    const key = linkKey(link);
    const entry = {
      key,
      source,
      target,
      type: link.type,
      polarity: profile?.polarity ?? [num(physical.P) ?? 0, 0],
      permanence: profile?.permanence ?? num(physical.S) ?? 0.5,
      gate: num(physical?.G) ?? 1,
      initialWeight: num(physical?.W) ?? 1,
      embedding: validEmbedding(link.embedding) ? [...link.embedding] : null,
      embeddingModel: link.embeddingModel || null,
      embeddingModelVersion: link.embeddingModelVersion || null
    };
    entries.push(entry);
    if (!outOf.has(source)) outOf.set(source, []);
    if (!inTo.has(target)) inTo.set(target, []);
    outOf.get(source).push(entry);
    inTo.get(target).push(entry);
  }

  const moments = nodes.filter(node => String(node.nodeType).toLowerCase() === "moment");
  return {
    entries,
    byKey: new Map(entries.map(entry => [entry.key, entry])),
    outOf,
    inTo,
    clusterOf: new Map(nodes.map(node => [node.id, node.clusterId ?? "(hors cluster)"])),
    typeOf: new Map(nodes.map(node => [node.id, node.nodeType])),
    semanticTypeOf: new Map(nodes.map(node => [node.id, node.semanticType || node.nodeType])),
    nameOf: new Map(nodes.map(node => [node.id, node.name || node.id])),
    nodeEmbedding: new Map(nodes
      .filter(node => validEmbedding(node.embedding))
      .map(node => [node.id, [...node.embedding]])),
    nodeEmbeddingMetadata: new Map(nodes
      .filter(node => validEmbedding(node.embedding))
      .map(node => [node.id, {
        embeddingModel: node.embeddingModel || null,
        embeddingModelVersion: node.embeddingModelVersion || null
      }])),
    momentIds: new Set(moments.map(node => node.id)),
    momentInitialWeight: new Map(moments.map(node => [
      node.id,
      num(node.reinforcement?.weight) ?? num(node.weight) ?? 1
    ])),
    // Poids des pompes, persistants : lus une fois, jamais relaxés.
    citizenWeight: new Map(citizenPumps(nodes).map(pump => [pump.id, pump.weight]))
  };
}

/**
 * État runtime. Les poids de lien démarrent au défaut du dictionnaire et
 * apprennent ; les poids de citoyen sont semés depuis l'index et ne décroissent
 * jamais — aucune fonction de ce module ne les touche après la création.
 */
export function createState(index, { weight = 1 } = {}) {
  const energy = new Map();
  const flows = new Map();
  const weights = new Map();
  const lastTraversedAtS = new Map();
  const stability = new Map();
  for (const entry of index.entries) {
    energy.set(entry.key, 0);
    flows.set(entry.key, new Map());
    weights.set(entry.key, entry.initialWeight ?? weight);
    stability.set(entry.key, 0);
  }
  return {
    energy,
    flows,
    workspaces: new Map(),
    weight: weights,
    stability,
    nodeWeight: new Map(index.citizenWeight ?? []),
    momentWeight: new Map(index.momentInitialWeight ?? []),
    momentReinforcement: new Map([...(index.momentInitialWeight ?? [])].map(([id, momentWeight]) => [
      id,
      { weight: momentWeight, updateCount: 0 }
    ])),
    lastTraversedAtS,
    tick: 0,
    injected: 0
  };
}

export function applyMomentOutcome(state, index, outcome, options = {}) {
  const moments = [...(index.momentIds || [])].map(id => ({
    id,
    reinforcement: structuredClone(
      state.momentReinforcement.get(id)
      || { weight: state.momentWeight.get(id) ?? 1, updateCount: 0 }
    )
  }));
  const result = reinforceMoments(moments, outcome, options);
  for (const moment of result.moments) {
    state.momentWeight.set(moment.id, moment.reinforcement.weight);
    state.momentReinforcement.set(moment.id, structuredClone(moment.reinforcement));
  }
  return result;
}

export function setCitizenWorkspace(state, citizenId, workspace) {
  if (!citizenId) throw new Error("setCitizenWorkspace requires a citizenId");
  if (!workspace || typeof workspace !== "object") throw new Error("workspace must be an object");
  if (!validEmbedding(workspace.embedding)) throw new Error("workspace.embedding must be a non-empty finite vector");
  const normalized = {
    id: workspace.id || `workspace-${citizenId}`,
    version: workspace.version ?? 1,
    embedding: [...workspace.embedding],
    embeddingModel: workspace.embeddingModel || null,
    embeddingModelVersion: workspace.embeddingModelVersion || null,
    goalIds: [...new Set(workspace.goalIds || [])],
    contentHash: workspace.contentHash || null,
    cortexState: workspace.intentProfile?.cortexState || workspace.cortexState || null,
    affectVector: workspace.affectVector ? structuredClone(workspace.affectVector) : null,
    intentProfile: workspace.intentProfile ? structuredClone(workspace.intentProfile) : null,
    componentWeights: workspace.intentProfile?.componentWeights
      ? structuredClone(workspace.intentProfile.componentWeights)
      : null,
    predicateBoosts: workspace.intentProfile?.predicateBoosts
      ? structuredClone(workspace.intentProfile.predicateBoosts)
      : null,
    routingTuning: workspace.intentProfile?.routing
      ? structuredClone(workspace.intentProfile.routing)
      : null,
    // L'arbitre attentionnel doit connaître l'entité actuellement diffusée.
    // Ces champs décrivent le workspace ; ils ne modifient ni son embedding ni
    // la quantité d'énergie disponible.
    activeEntity: workspace.activeEntity ? structuredClone(workspace.activeEntity) : null,
    broadcastEntity: workspace.broadcastEntity ? structuredClone(workspace.broadcastEntity) : null
  };
  state.workspaces.set(citizenId, normalized);
  return normalized;
}

const flowSignature = flow => [
  flow.citizenId || "anonymous",
  flow.workspaceId || "workspace-default",
  flow.workspaceVersion ?? 0,
  (flow.goalIds || []).join(",") || "no-goal"
].join("|");

function flowFromOptions(state, nodeId, options = {}) {
  const citizenId = options.citizenId === null ? null : (options.citizenId || nodeId);
  const workspace = options.workspace || (citizenId ? state.workspaces.get(citizenId) : null) || null;
  const goalIds = [...new Set(options.goalIds || workspace?.goalIds || [])];
  const flow = {
    flowId: options.flowId || "",
    citizenId,
    workspaceId: options.workspaceId || workspace?.id || null,
    workspaceVersion: options.workspaceVersion ?? workspace?.version ?? null,
    workspaceEmbedding: validEmbedding(options.workspaceEmbedding)
      ? [...options.workspaceEmbedding]
      : (validEmbedding(workspace?.embedding) ? [...workspace.embedding] : null),
    embeddingModel: options.embeddingModel || workspace?.embeddingModel || null,
    embeddingModelVersion: options.embeddingModelVersion || workspace?.embeddingModelVersion || null,
    workspaceContentHash: options.workspaceContentHash || workspace?.contentHash || null,
    cortexState: options.cortexState || workspace?.cortexState || null,
    componentWeights: structuredClone(options.componentWeights || workspace?.componentWeights || {}),
    predicateBoosts: structuredClone(options.predicateBoosts || workspace?.predicateBoosts || {}),
    routingTuning: structuredClone(options.routingTuning || workspace?.routingTuning || {}),
    originThingId: options.originThingId || null,
    flowKind: options.flowKind || null,
    trigger: options.trigger || null,
    budgetSource: options.budgetSource || null,
    goalIds,
    injectedAt: options.injectedAt || null,
    remainingBudget: num(options.remainingBudget)
  };
  flow.flowId = flow.flowId || flowSignature(flow);
  return flow;
}

const cloneFlow = (flow, amount) => ({ ...flow, goalIds: [...(flow.goalIds || [])], amount });

function flowBucket(state, key) {
  if (!state.flows.has(key)) state.flows.set(key, new Map());
  return state.flows.get(key);
}

function sumBucket(bucket) {
  let total = 0;
  for (const flow of bucket.values()) total += flow.amount;
  return total;
}

function refreshAggregate(state, key) {
  const total = sumBucket(flowBucket(state, key));
  state.energy.set(key, total < EPSILON ? 0 : total);
  return total;
}

// Compatibilité avec les consommateurs historiques qui écrivent directement
// dans state.energy. Toute différence devient un flux legacy sans workspace ;
// la physique canonique reste ensuite attribuée par flowId.
function importLegacyAggregate(state, key) {
  const bucket = flowBucket(state, key);
  const aggregate = state.energy.get(key) ?? 0;
  const attributed = sumBucket(bucket);
  const difference = aggregate - attributed;
  if (Math.abs(difference) <= EPSILON) return;
  const legacyId = `legacy|${key}`;
  const existing = bucket.get(legacyId);
  const amount = Math.max(0, (existing?.amount ?? 0) + difference);
  if (amount <= EPSILON) bucket.delete(legacyId);
  else bucket.set(legacyId, {
    flowId: legacyId,
    citizenId: null,
    workspaceId: null,
    workspaceVersion: null,
    workspaceEmbedding: null,
    embeddingModel: null,
    embeddingModelVersion: null,
    workspaceContentHash: null,
    goalIds: [],
    injectedAt: null,
    remainingBudget: null,
    amount
  });
  refreshAggregate(state, key);
}

function candidateEmbeddingInfo(index, entry, junctionNode) {
  if (validEmbedding(entry.embedding)) return {
    embedding: entry.embedding,
    embeddingModel: entry.embeddingModel,
    embeddingModelVersion: entry.embeddingModelVersion
  };
  const destination = entry.source === junctionNode ? entry.target : entry.source;
  return {
    embedding: index.nodeEmbedding.get(destination) || null,
    ...(index.nodeEmbeddingMetadata.get(destination) || {})
  };
}

function embeddingsCompatible(flow, candidate) {
  if (flow.embeddingModel && candidate.embeddingModel && flow.embeddingModel !== candidate.embeddingModel) return false;
  if (flow.embeddingModelVersion && candidate.embeddingModelVersion
    && flow.embeddingModelVersion !== candidate.embeddingModelVersion) return false;
  return true;
}

export function semanticRoutingShares(candidates, index, flow, tuning = P, junctionNode = null) {
  if (!candidates.length) return [];
  const temperature = Math.max(EPSILON, tuning.semanticTemperature ?? P.semanticTemperature);
  const baseBeta = tuning.semanticGuidanceBeta ?? P.semanticGuidanceBeta;
  const betaMultiplier = Math.max(0, Number(flow.routingTuning?.semanticGuidanceMultiplier) || 1);
  const beta = baseBeta * betaMultiplier;
  const exploration = Math.min(1, Math.max(0,
    flow.routingTuning?.explorationRate ?? tuning.explorationRate ?? P.explorationRate
  ));
  const scored = candidates.map(candidate => {
    const candidateInfo = candidateEmbeddingInfo(index, candidate.entry, candidate.junctionNode ?? junctionNode);
    const relevance = embeddingsCompatible(flow, candidateInfo)
      ? cosineSimilarity(flow.workspaceEmbedding, candidateInfo.embedding)
      : 0;
    const predicateBoost = Math.max(EPSILON, Number(flow.predicateBoosts?.[candidate.entry.type]) || 1);
    const momentWeight = Math.max(EPSILON, Number(candidate.momentWeight) || 1);
    return {
      ...candidate,
      relevance,
      predicateBoost,
      momentWeight,
      logScore: (Math.log(Math.max(EPSILON,
        candidate.weight * candidate.magnitude * predicateBoost * momentWeight
      )) + beta * relevance) / temperature
    };
  });
  const maxScore = Math.max(...scored.map(candidate => candidate.logScore));
  const exponentials = scored.map(candidate => Math.exp(candidate.logScore - maxScore));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0) || candidates.length;
  return scored.map((candidate, position) => ({
    ...candidate,
    share: (1 - exploration) * (exponentials[position] / denominator) + exploration / candidates.length
  }));
}

/** Arêtes situées à `radius` sauts d'un nœud, dans les deux sens. */
export function neighbourhood(index, nodeId, radius = P.injectionRadius) {
  const seenNodes = new Set([nodeId]);
  const reached = new Set();
  let frontier = [nodeId];
  for (let hop = 0; hop < radius; hop += 1) {
    const next = [];
    for (const current of frontier) {
      for (const entry of [...(index.outOf.get(current) || []), ...(index.inTo.get(current) || [])]) {
        reached.add(entry);
        const other = entry.source === current ? entry.target : entry.source;
        if (!seenNodes.has(other)) {
          seenNodes.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return [...reached];
}

/**
 * Dépose de l'énergie autour d'un nœud. Réservé aux pompes : un acteur qui bat,
 * une requête qui parcourt. Un Moment créé n'appelle jamais ceci.
 */
export function injectAtNode(state, index, nodeId, amount = P.actorInjection, options = {}) {
  const radius = options.radius ?? P.injectionRadius;
  const atSeconds = options.atSeconds ?? null;
  const targets = neighbourhood(index, nodeId, radius);
  if (!targets.length) return 0;
  const share = amount / targets.length;
  const maxReservoir = num(options.maxReservoir);
  const perTargetCap = maxReservoir === null ? Infinity : Math.max(0, maxReservoir) / targets.length;
  const flow = flowFromOptions(state, nodeId, {
    ...options,
    remainingBudget: options.remainingBudget ?? amount
  });
  let accepted = 0;
  for (const entry of targets) {
    importLegacyAggregate(state, entry.key);
    const bucket = flowBucket(state, entry.key);
    const existing = bucket.get(flow.flowId);
    const previous = existing?.amount ?? 0;
    const next = Math.min(perTargetCap, previous + share);
    bucket.set(flow.flowId, cloneFlow(flow, next));
    accepted += Math.max(0, next - previous);
    refreshAggregate(state, entry.key);
    if (atSeconds !== null) state.lastTraversedAtS.set(entry.key, atSeconds);
  }
  state.injected += accepted;

  const logger = options.logger || (options.verbose || options.log ? createPhysicsLogger(options) : null);
  if (logger) {
    const semanticType = index.semanticTypeOf?.get(nodeId) || index.typeOf?.get(nodeId) || "actor";
    const isSubentity = semanticType.startsWith("subentity");
    logger.emit({
      type: flow.originThingId ? "THING_ACTIVATION" : (isSubentity ? "SUBENTITY_ACTIVATION" : "ACTOR_ACTIVATION"),
      actorId: nodeId,
      nodeType: index.typeOf?.get(nodeId) || "actor",
      semanticType,
      amount: accepted,
      flowId: flow.flowId,
      workspaceId: flow.workspaceId,
      workspaceVersion: flow.workspaceVersion,
      embeddingModel: flow.embeddingModel,
      embeddingModelVersion: flow.embeddingModelVersion,
      goalIds: flow.goalIds,
      originThingId: flow.originThingId,
      flowKind: flow.flowKind,
      trigger: flow.trigger,
      budgetSource: flow.budgetSource,
      maxReservoir,
      weight: state.nodeWeight?.get(nodeId) ?? 1,
      targetCount: targets.length,
      targets: targets.map(t => t.key)
    });
  }

  return targets.length;
}

export function injectAlongPath(state, index, nodeIds, amount = P.queryInjection, options = {}) {
  const unique = [...new Set(nodeIds)].filter(id => index.outOf.has(id) || index.inTo.has(id));
  if (!unique.length) return 0;
  const share = amount / unique.length;
  const maxReservoir = num(options.maxReservoir);
  let touched = 0;
  for (const nodeId of unique) touched += injectAtNode(state, index, nodeId, share, {
    ...options,
    maxReservoir: maxReservoir === null ? undefined : maxReservoir / unique.length
  });

  const logger = options.logger || (options.verbose || options.log ? createPhysicsLogger(options) : null);
  if (logger) {
    logger.emit({
      type: "INJECTION_PATH",
      nodeCount: unique.length,
      nodeIds: unique,
      amount,
      touched
    });
  }

  return touched;
}

export function propagate(state, index, tuning = P, options = {}) {
  const resolvedTuning = typeof tuning === "object" && tuning.propagationGain !== undefined ? tuning : P;
  const opts = typeof tuning === "object" && tuning.propagationGain === undefined ? tuning : options;
  const logger = opts.logger || (opts.verbose || opts.log ? createPhysicsLogger(opts) : null);

  const delta = new Map();
  const flowDelta = new Map();
  const addFlow = (key, flow, value) => {
    if (!flowDelta.has(key)) flowDelta.set(key, new Map());
    const bucket = flowDelta.get(key);
    const current = bucket.get(flow.flowId);
    bucket.set(flow.flowId, {
      flow,
      value: (current?.value ?? 0) + value
    });
    delta.set(key, (delta.get(key) ?? 0) + value);
  };
  const weightOf = key => state.weight.get(key) ?? 1;
  const momentWeightOf = (entry, junctionNode) => {
    const destination = entry.source === junctionNode ? entry.target : entry.source;
    return index.momentIds?.has(destination) ? (state.momentWeight.get(destination) ?? 1) : 1;
  };

  for (const entry of index.entries) {
    importLegacyAggregate(state, entry.key);
    const sourceFlows = [...flowBucket(state, entry.key).values()]
      .filter(flow => !opts.citizenId || flow.citizenId === opts.citizenId);
    if (!sourceFlows.length) continue;
    const [forward, backward] = entry.polarity;
    const forwardTargets = (index.outOf.get(entry.target) || []).filter(t => t.key !== entry.key);
    const backwardTargets = (index.inTo.get(entry.source) || []).filter(t => t.key !== entry.key);

    for (const flow of sourceFlows) {
      const energy = flow.amount;
      if (energy < resolvedTuning.propagationFloor) continue;
      const moved = energy * entry.gate * resolvedTuning.propagationGain;
      if (moved <= 0) continue;

      const positiveCandidates = [
        ...forwardTargets.map(target => ({
          entry: target,
          magnitude: Math.max(0, forward),
          weight: weightOf(target.key),
          momentWeight: momentWeightOf(target, entry.target),
          junctionNode: entry.target
        })),
        ...backwardTargets.map(target => ({
          entry: target,
          magnitude: Math.max(0, backward),
          weight: weightOf(target.key),
          momentWeight: momentWeightOf(target, entry.source),
          junctionNode: entry.source
        }))
      ].filter(candidate => candidate.magnitude > 0);

      const transfers = [];
      if (positiveCandidates.length) {
        // Les deux jonctions peuvent coexister. candidateEmbedding reçoit le
        // nœud par lequel le flux atteint chaque sortie, sans requête globale.
        const routed = semanticRoutingShares(
          positiveCandidates,
          index,
          flow,
          resolvedTuning,
          null
        ).map(candidate => {
          const junction = candidate.junctionNode;
          const candidateInfo = candidateEmbeddingInfo(index, candidate.entry, junction);
          const relevance = embeddingsCompatible(flow, candidateInfo)
            ? cosineSimilarity(flow.workspaceEmbedding, candidateInfo.embedding)
            : 0;
          return { ...candidate, relevance };
        });
        for (const target of routed) {
          const amount = moved * target.share;
          addFlow(target.entry.key, flow, amount);
          transfers.push({
            targetKey: target.entry.key,
            amount,
            bias: target.share,
            semanticRelevance: target.relevance,
            momentWeight: target.momentWeight,
            sign: 1,
            flowId: flow.flowId
          });
        }
        addFlow(entry.key, flow, -moved);
      }

      const inhibit = (targets, magnitude) => {
        if (!targets.length || magnitude <= 0) return;
        const totalWeight = targets.reduce((sum, target) => sum + weightOf(target.key), 0) || targets.length;
        for (const target of targets) {
          const share = weightOf(target.key) / totalWeight;
          const amount = moved * magnitude * share;
          addFlow(target.key, flow, -amount);
          transfers.push({ targetKey: target.key, amount, bias: share, semanticRelevance: 0, sign: -1, flowId: flow.flowId });
        }
      };
      inhibit(forwardTargets, Math.max(0, -forward));
      inhibit(backwardTargets, Math.max(0, -backward));

      if (logger && transfers.length > 0) {
        logger.emit({
          type: "ENERGY_TRANSFER",
          linkKey: entry.key,
          source: entry.source,
          target: entry.target,
          energyBefore: energy,
          moved,
          flowId: flow.flowId,
          citizenId: flow.citizenId,
          workspaceId: flow.workspaceId,
          workspaceVersion: flow.workspaceVersion,
          embeddingModel: flow.embeddingModel,
          embeddingModelVersion: flow.embeddingModelVersion,
          goalIds: flow.goalIds,
          transfers
        });
      }
    }
  }

  for (const [key, changes] of flowDelta) {
    const bucket = flowBucket(state, key);
    for (const { flow, value } of changes.values()) {
      const existing = bucket.get(flow.flowId);
      const amount = Math.max(0, (existing?.amount ?? 0) + value);
      if (amount <= EPSILON) bucket.delete(flow.flowId);
      else bucket.set(flow.flowId, cloneFlow(existing || flow, amount));
    }
    refreshAggregate(state, key);
  }
  return delta.size;
}

export function relax(state, index, tuning = P, options = {}) {
  const resolvedTuning = typeof tuning === "object" && tuning.decayPerTick !== undefined ? tuning : P;
  const opts = typeof tuning === "object" && tuning.decayPerTick === undefined ? tuning : options;
  const logger = opts.logger || (opts.verbose || opts.log ? createPhysicsLogger(opts) : null);

  let totalEnergy = 0;
  let activeLinks = 0;
  let weightGainedCount = 0;
  let weightLeakedCount = 0;

  for (const entry of index.entries) {
    importLegacyAggregate(state, entry.key);
    const bucket = flowBucket(state, entry.key);
    for (const [flowId, flow] of bucket) {
      const amount = flow.amount * resolvedTuning.decayPerTick;
      if (amount < resolvedTuning.propagationFloor) bucket.delete(flowId);
      else bucket.set(flowId, cloneFlow(flow, amount));
    }
    const energy = refreshAggregate(state, entry.key);
    if (energy >= resolvedTuning.propagationFloor) activeLinks += 1;
    totalEnergy += energy;
    const activation = Math.min(1, energy);

    const stability = state.stability.get(entry.key) ?? 0;
    const nextStability = stability + resolvedTuning.stabilityRate * (activation - stability);
    state.stability.set(entry.key, nextStability);

    const weight = state.weight.get(entry.key) ?? 1;
    const gained = resolvedTuning.weightGain * activation;
    const leaked = resolvedTuning.weightDecay * (1 - nextStability) * weight;
    if (gained > 1e-6) weightGainedCount += 1;
    if (leaked > 1e-6) weightLeakedCount += 1;
    const next = weight + gained - leaked;
    state.weight.set(entry.key, next < 0 ? 0 : next);
  }

  if (logger) {
    logger.emit({
      type: "RELAXATION",
      tick: state.tick,
      totalEnergy,
      activeLinks,
      totalLinks: index.entries.length,
      weightGainedCount,
      weightLeakedCount
    });
  }
}

export function pump(state, index, actorId, options = {}) {
  const tuning = { ...P, ...(options.tuning || {}) };
  const weight = state.nodeWeight.get(actorId) ?? 1;
  const amount = options.amount ?? weight * tuning.actorInjection;
  injectAtNode(state, index, actorId, amount, options);
  propagate(state, index, tuning, { ...options, citizenId: actorId });
  return state;
}

export function step(state, index, pumps, options = {}) {
  const tuning = { ...P, ...(options.tuning || {}) };
  for (const entry of pumps) {
    const id = typeof entry === "string" ? entry : entry.id;
    pump(state, index, id, { ...options, tuning });
  }
  relax(state, index, tuning, options);
  state.tick += 1;
  return state;
}

/**
 * Convenance pour une pompe unique : un pas de temps complet à un seul citoyen.
 * Équivaut à `step` avec une seule pompe, donc sans ambiguïté d'ordre.
 */
export function tickActor(state, index, actorId, options = {}) {
  return step(state, index, [actorId], options);
}

/** Lecture agrégée. Ne juge rien : dit où le graphe est chaud. */
export function summarize(state, index, { limit = 10 } = {}) {
  let total = 0;
  const byCluster = new Map();
  const hot = [];
  const byCitizen = new Map();
  const activeFlowIds = new Set();
  for (const entry of index.entries) {
    importLegacyAggregate(state, entry.key);
    const energy = state.energy.get(entry.key) ?? 0;
    total += energy;
    if (energy > 0) {
      hot.push({ key: entry.key, type: entry.type, energy, weight: state.weight.get(entry.key) ?? 1 });
      for (const flow of flowBucket(state, entry.key).values()) {
        activeFlowIds.add(flow.flowId);
        const citizen = flow.citizenId || "(non attribué)";
        byCitizen.set(citizen, (byCitizen.get(citizen) ?? 0) + flow.amount);
      }
      for (const nodeId of [entry.source, entry.target]) {
        const cluster = index.clusterOf.get(nodeId) ?? "(hors cluster)";
        byCluster.set(cluster, (byCluster.get(cluster) ?? 0) + energy / 2);
      }
    }
  }
  hot.sort((a, b) => b.energy - a.energy);
  return {
    tick: state.tick,
    injected: Number(state.injected.toFixed(3)),
    totalEnergy: Number(total.toFixed(3)),
    liveLinks: hot.length,
    activeFlows: activeFlowIds.size,
    links: index.entries.length,
    byCitizen: [...byCitizen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([citizenId, energy]) => ({ citizenId, energy: Number(energy.toFixed(3)) })),
    byCluster: [...byCluster.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([cluster, energy]) => ({ cluster, energy: Number(energy.toFixed(3)) })),
    hottest: hot.slice(0, limit).map(item => ({
      link: item.key,
      type: item.type,
      energy: Number(item.energy.toFixed(4)),
      weight: Number(item.weight.toFixed(4))
    }))
  };
}
