// Champ attentionnel d'une sous-entité et son barycentre.
//
// Implémente la décision ratifiée `decision-l2-subentity-constellation-field` :
// une sous-entité n'occupe pas un point du graphe, elle forme une constellation
// de nœuds dotée d'un centre de gravité. Le recrutement obéit à un seuil
// d'admission, la capacité est bornée par la loi de Miller (7±2), l'éviction
// libère les moins alignés et l'élagage retire ceux passés sous le seuil de
// rétention.
//
// Nuance épistémique importante : la signature d'une coalition porte des *parts
// d'activation* qui somment à 1, pas des alignements absolus. Les seuils sont
// donc appliqués à un alignement **relatif** — part rapportée à la plus forte
// part du champ. Le nœud le plus chaud vaut 1.0 par construction. C'est une
// mesure de forme du champ, jamais une affirmation d'alignement sémantique
// absolu, et la vue doit le dire.

export const CONSTELLATION_POLICY = Object.freeze({
  admissionThreshold: 0.7,   // recrutement dans le champ
  retentionThreshold: 0.5,   // sous ce seuil, le nœud est élagué
  nominalCapacity: 7,        // loi de Miller
  capacityTolerance: 2       // 7±2
});

export const MAXIMUM_FIELD_SIZE = CONSTELLATION_POLICY.nominalCapacity + CONSTELLATION_POLICY.capacityTolerance;

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

/** Teinte stable dérivée d'un identifiant : deux lectures donnent la même couleur. */
export function hueFromKey(key) {
  const text = String(key || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 360000;
  }
  return hash % 360;
}

/**
 * Construit le champ attentionnel d'une sous-entité.
 *
 * @param activatedNodes [{ id, share }] parts d'activation issues de la signature
 * @param metadataById Map id -> { name, clusterId, semanticType }
 */
/** Cosinus ramené dans [0,1], convention déjà utilisée par le runtime L1. */
function cosineAlignment(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return null;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    normLeft += left[index] ** 2;
    normRight += right[index] ** 2;
  }
  if (!normLeft || !normRight) return null;
  return clamp01((dot / Math.sqrt(normLeft * normRight) + 1) / 2);
}

/** Centre sémantique du champ : moyenne des vecteurs pondérée par l'activation. */
function fieldCentroid(nodes, metadataById) {
  const usable = nodes
    .map(node => ({ vector: metadataById.get(node.id)?.embedding, weight: Number(node.share) || 0 }))
    .filter(entry => Array.isArray(entry.vector) && entry.vector.length && entry.weight > 0);
  if (usable.length < 2) return null;
  const dimensions = usable[0].vector.length;
  if (usable.some(entry => entry.vector.length !== dimensions)) return null;
  const total = usable.reduce((sum, entry) => sum + entry.weight, 0);
  const centroid = new Array(dimensions).fill(0);
  for (const entry of usable) {
    for (let index = 0; index < dimensions; index += 1) centroid[index] += (entry.vector[index] * entry.weight) / total;
  }
  return centroid;
}

export function buildAttentionField(activatedNodes = [], metadataById = new Map()) {
  const ranked = [...activatedNodes]
    .filter(node => node?.id && Number(node.share) > 0)
    .sort((left, right) => right.share - left.share);

  if (!ranked.length) {
    return {
      measurementStatus: "unavailable",
      reason: "aucun nœud activé n'a été enregistré dans la signature de cette coalition",
      alignmentScale: "relative",
      admitted: [],
      periphery: [],
      pruned: [],
      barycentre: null
    };
  }

  // L'alignement se mesure contre le centre sémantique du champ quand les
  // vecteurs existent. Sans vecteurs, on retombe sur la part d'activation
  // rapportée à la plus forte — repli honnête, mais qui rend les seuils
  // d'admission presque inopérants puisque les parts se ressemblent toutes.
  const centroid = fieldCentroid(ranked, metadataById);
  const strongest = ranked[0].share;
  const withAlignment = ranked.map(node => {
    const metadata = metadataById.get(node.id) || {};
    const semantic = centroid ? cosineAlignment(metadata.embedding, centroid) : null;
    return {
      id: node.id,
      name: metadata.name || null,
      content: metadata.content || null,
      clusterId: metadata.clusterId || null,
      semanticType: metadata.semanticType || null,
      epistemicStatus: metadata.epistemicStatus || null,
      share: Number(node.share),
      alignment: semantic === null ? clamp01(node.share / strongest) : semantic,
      alignmentBasis: semantic === null ? "relative_share" : "embedding_cosine"
    };
  });

  const measuredBy = withAlignment.every(node => node.alignmentBasis === "embedding_cosine")
    ? "embedding_cosine"
    : withAlignment.some(node => node.alignmentBasis === "embedding_cosine") ? "mixed" : "relative_share";
  const eligible = withAlignment.filter(node => node.alignment >= CONSTELLATION_POLICY.admissionThreshold);
  const admitted = eligible.slice(0, MAXIMUM_FIELD_SIZE);
  const evicted = eligible.slice(MAXIMUM_FIELD_SIZE);
  const periphery = withAlignment.filter(node =>
    node.alignment < CONSTELLATION_POLICY.admissionThreshold
    && node.alignment >= CONSTELLATION_POLICY.retentionThreshold);
  const pruned = withAlignment.filter(node => node.alignment < CONSTELLATION_POLICY.retentionThreshold);

  return {
    measurementStatus: "derived",
    alignmentScale: measuredBy,
    alignmentNote: measuredBy === "embedding_cosine"
      ? "alignement = cosinus entre le vecteur du nœud et le centre sémantique du champ"
      : measuredBy === "mixed"
        ? "alignement mixte : cosinus quand le vecteur existe, part d'activation relative sinon"
        : "aucun vecteur disponible : alignement replié sur la part d'activation relative, où les seuils d'admission ne discriminent presque pas",
    admitted,
    periphery,
    evicted,
    pruned,
    capacity: { nominal: CONSTELLATION_POLICY.nominalCapacity, maximum: MAXIMUM_FIELD_SIZE, used: admitted.length },
    barycentre: computeBarycentre(admitted.length ? admitted : withAlignment)
  };
}

/**
 * Centre de gravité du champ : le cluster qui concentre le plus de masse
 * d'activation, et à quel point le champ est concentré ou dispersé.
 *
 * `concentration` est la part du cluster dominant. Elle vaut 1 quand toute
 * l'attention tient dans un seul cluster, et tend vers 0 quand elle s'éparpille.
 */
export function computeBarycentre(fieldNodes = []) {
  if (!fieldNodes.length) return null;
  const massByCluster = new Map();
  let total = 0;
  let unattributed = 0;
  for (const node of fieldNodes) {
    const mass = node.alignment;
    total += mass;
    // Un nœud sans cluster n'est pas rangé dans un cluster « vide » : sa masse
    // est comptée à part, pour ne pas fabriquer un barycentre qui n'existe pas.
    if (!node.clusterId) {
      unattributed += mass;
      continue;
    }
    massByCluster.set(node.clusterId, (massByCluster.get(node.clusterId) || 0) + mass);
  }
  const ranked = [...massByCluster]
    .map(([clusterId, mass]) => ({ clusterId, mass, share: total ? mass / total : 0 }))
    .sort((left, right) => right.mass - left.mass || left.clusterId.localeCompare(right.clusterId));

  const dominant = ranked[0] || null;
  const unattributedShare = total ? unattributed / total : 0;

  if (!dominant || unattributedShare > 0.5) {
    return {
      measurementStatus: "unavailable",
      reason: "les nœuds du champ ne portent pas de cluster : aucun centre de gravité ne peut être situé",
      unattributedShare,
      clusters: ranked,
      hue: null
    };
  }

  return {
    measurementStatus: "derived",
    clusterId: dominant.clusterId,
    concentration: dominant.share,
    dispersion: 1 - dominant.share,
    unattributedShare,
    clusters: ranked.slice(0, 4),
    nodeCount: fieldNodes.length,
    hue: hueFromKey(dominant.clusterId)
  };
}
