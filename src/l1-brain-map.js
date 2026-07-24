// Carte du cerveau : place les sous-entités et leurs nœuds dans un plan issu
// de l'espace vectoriel réel.
//
// La base de projection est construite une fois à partir des profils
// d'embedding des clusters, qui forment un repère stable : les clusters ne se
// déplacent pas d'un tick à l'autre. Une sous-entité, elle, se déplace — parce
// que son champ attentionnel change réellement de composition. Un mouvement à
// l'écran correspond donc à un mouvement mesuré, jamais à une animation.
import { buildProjectionBasis, projectVector, projectWeightedCentroid } from "./embedding-projection.js";
import { buildAttentionField, hueFromKey } from "./l1-attention-field.js";
import { buildEnergyField } from "./l1-energy-field.js";
import { SUBENTITY_STATES, describeDoing, describeFeeling, describeSeeing, deriveSubentityState } from "./l1-subentity-semantics.js";

/**
 * Teinte du centre de gravité. Le cluster dominant est la lecture la plus
 * parlante, mais il n'existe que si les nœuds du champ portent un cluster.
 * À défaut, la teinte suit l'angle du barycentre dans le plan vectoriel : c'est
 * toujours le même centre de gravité, lu autrement. Deux sous-entités voisines
 * dans l'espace partagent alors une famille de couleur, et on voit qu'elles se
 * rapprochent. La provenance de la teinte est transportée pour que la vue ne
 * fasse pas passer une lecture pour l'autre.
 */
function hueOf(barycentre, position) {
  if (barycentre?.measurementStatus === "derived" && barycentre.hue !== null) {
    return { hue: barycentre.hue, hueSource: "cluster", hueLabel: barycentre.clusterId };
  }
  if (position) {
    const angle = Math.atan2(position.y, position.x);
    return { hue: Math.round(((angle + Math.PI) / (2 * Math.PI)) * 360), hueSource: "position", hueLabel: "direction du barycentre dans le plan vectoriel" };
  }
  return { hue: null, hueSource: "unavailable", hueLabel: null };
}

let cachedBasis = null;
let cachedBasisKey = null;

/** Base stable dérivée des profils de clusters, mémorisée entre deux requêtes. */
export function projectionBasisFromClusters(clusterProfiles = []) {
  const usable = clusterProfiles
    .map(profile => ({ clusterId: profile.clusterId, vector: profile.components?.semantic }))
    .filter(entry => Array.isArray(entry.vector) && entry.vector.length);
  if (usable.length < 2) return { basis: null, landmarks: [] };

  const key = `${usable.length}:${usable.map(entry => entry.clusterId).join("|")}`;
  if (cachedBasisKey !== key) {
    cachedBasis = buildProjectionBasis(usable.map(entry => entry.vector));
    cachedBasisKey = key;
  }
  const basis = cachedBasis;
  const landmarks = usable.map(entry => ({
    clusterId: entry.clusterId,
    hue: hueFromKey(entry.clusterId),
    position: projectVector(basis, entry.vector)
  })).filter(landmark => landmark.position);
  return { basis, landmarks };
}

/**
 * Enrichit une trame cérébrale avec le champ attentionnel, la position et la
 * lecture humaine de chaque sous-entité.
 *
 * @param resolveNodes (ids) => Map id -> { name, clusterId, semanticType, embedding }
 */
export async function enrichBrainFrame(frame, {
  resolveNodes,
  resolveRelations = null,
  physics = null,
  clusterProfiles = [],
  promotedIds = new Set()
} = {}) {
  const { basis, landmarks } = projectionBasisFromClusters(clusterProfiles);
  const ids = [...new Set(frame.subentities.flatMap(entity => entity.why.activatedNodes.map(node => node.id)))];
  const metadata = ids.length && typeof resolveNodes === "function" ? await resolveNodes(ids) : new Map();

  let missingEmbeddings = 0;
  const subentities = frame.subentities.map(entity => {
    const field = buildAttentionField(entity.why.activatedNodes, metadata);
    const state = deriveSubentityState({
      place: entity.doing,
      goals: entity.why.goals,
      behaviour: entity.doing.behaviour.measurementStatus === "unavailable" ? null : entity.doing.behaviour,
      promotedThisTick: promotedIds.has(entity.id)
    });

    // Position = barycentre pondéré des vecteurs du champ. Les nœuds admis
    // pèsent selon leur alignement ; un nœud sans vecteur ne pèse rien et son
    // absence est comptée, pas comblée.
    const weighted = [];
    for (const node of field.admitted || []) {
      const embedding = metadata.get(node.id)?.embedding;
      if (Array.isArray(embedding) && embedding.length) weighted.push({ vector: embedding, weight: node.alignment });
      else missingEmbeddings += 1;
    }
    const position = basis ? projectWeightedCentroid(basis, weighted) : null;

    const locate = node => ({
      ...node,
      position: basis ? projectVector(basis, metadata.get(node.id)?.embedding) : null,
      hasEmbedding: Array.isArray(metadata.get(node.id)?.embedding)
    });
    const nodes = (field.admitted || []).map(locate);
    // Les nœuds de périphérie sont la frontière du champ : recrutés à moitié,
    // sous le seuil d'admission mais au-dessus du seuil de rétention. Ils sont
    // localisés comme les autres pour qu'on puisse voir où le champ s'arrête.
    const peripheryNodes = (field.periphery || []).map(locate);

    const tint = hueOf(field.barycentre, position);

    return {
      ...entity,
      state: {
        ...SUBENTITY_STATES[state.id],
        ...state,
        measurementStatus: "derived",
        derivation: "règle explicite appliquée à la place au workspace, l'enchère, les pénalités et les buts ; la machine à états du blueprint n'est pas implémentée"
      },
      field: { ...field, admitted: nodes, periphery: peripheryNodes },
      position: position
        ? { measurementStatus: "derived", ...position, basedOn: weighted.length, missingVectors: (field.admitted || []).length - weighted.length }
        : { measurementStatus: "unavailable", reason: weighted.length ? "aucune base de projection disponible" : "aucun nœud de son champ ne porte de vecteur" },
      ...tint,
      reading: {
        doing: describeDoing(state.id, entity.doing, frame.workspace?.characterBudget),
        seeing: describeSeeing(field),
        feeling: describeFeeling(entity.feeling)
      }
    };
  });

  // Frontières entre sous-entités : un nœud tenu par plusieurs champs est un
  // terrain partagé. C'est là que deux sous-entités se touchent, et c'est ce
  // qui rend visible une rivalité ou une coopération naissante.
  const holdersByNode = new Map();
  for (const entity of subentities) {
    for (const node of [...(entity.field.admitted || []), ...(entity.field.periphery || [])]) {
      if (!holdersByNode.has(node.id)) holdersByNode.set(node.id, []);
      holdersByNode.get(node.id).push({
        subentityId: entity.id,
        label: entity.name || entity.state.label,
        hue: entity.hue,
        alignment: node.alignment,
        zone: (entity.field.admitted || []).some(item => item.id === node.id) ? "admitted" : "periphery"
      });
    }
  }
  const boundaries = [...holdersByNode]
    .filter(([, holders]) => holders.length > 1)
    .map(([id, holders]) => ({ id, holders }));
  const boundaryIds = new Set(boundaries.map(entry => entry.id));
  for (const entity of subentities) {
    for (const node of [...(entity.field.admitted || []), ...(entity.field.periphery || [])]) {
      node.sharedWith = boundaryIds.has(node.id)
        ? holdersByNode.get(node.id).filter(holder => holder.subentityId !== entity.id)
        : [];
    }
  }

  // Champ énergétique sur les nœuds réellement affichés, périphérie comprise.
  const visibleNodeIds = [...new Set(subentities.flatMap(entity => [
    ...(entity.field.admitted || []).map(node => node.id),
    ...(entity.field.periphery || []).map(node => node.id)
  ]))];
  const energy = physics ? buildEnergyField({ physics, nodeIds: visibleNodeIds }) : {
    measurementStatus: "unavailable",
    reason: "l'état physique L4 n'a pas pu être lu",
    edges: [],
    nodes: []
  };
  // La nature d'une relation colore l'arête. Aucun lien ne portant d'émotion
  // dans le graphe, la couleur dit la famille de relation — et la vue doit
  // dire que ce n'est pas une couleur d'émotion.
  if (energy.edges.length && typeof resolveRelations === "function") {
    const families = await resolveRelations(energy.edges.map(edge => ({ source: edge.source, type: edge.type, target: edge.target })));
    for (const edge of energy.edges) {
      const found = families.get(`${edge.source}|${edge.type}|${edge.target}`);
      edge.family = found?.family || null;
      edge.predicate = found?.predicate || edge.type;
      edge.epistemicStatus = found?.epistemicStatus || null;
      edge.hasAffect = Boolean(found?.hasAffect);
    }
  }
  // Les satellites sont les nœuds hors champ touchés par une arête vivante. Ils
  // sont placés par leur propre vecteur, jamais approchés ou inventés : sans
  // vecteur, le satellite n'est pas dessiné.
  const satellites = [];
  if (energy.satelliteIds?.length && typeof resolveNodes === "function" && basis) {
    const extra = await resolveNodes(energy.satelliteIds);
    for (const id of energy.satelliteIds) {
      const found = extra.get(id);
      const position = found?.embedding ? projectVector(basis, found.embedding) : null;
      if (!position) continue;
      satellites.push({
        id,
        name: found.name || null,
        content: found.content || null,
        clusterId: found.clusterId || null,
        semanticType: found.semanticType || null,
        position
      });
    }
  }

  const brightnessById = new Map(energy.nodes.map(node => [node.id, node]));
  for (const entity of subentities) {
    for (const node of [...(entity.field.admitted || []), ...(entity.field.periphery || [])]) {
      const measured = brightnessById.get(node.id);
      node.energy = measured ? measured.energy : null;
      node.brightness = measured ? measured.brightness : null;
    }
  }

  return {
    ...frame,
    subentities,
    boundaries,
    energy: {
      ...energy,
      satellites,
      affectOnLinks: {
        measurementStatus: "unavailable",
        reason: "aucun lien du graphe ne porte de vecteur affectif ; la couleur des arêtes dit la famille de relation, pas une émotion"
      }
    },
    map: {
      measurementStatus: basis ? "derived" : "unavailable",
      reason: basis ? null : "les profils d'embedding de clusters sont absents : aucun repère ne peut être construit",
      embeddingModel: clusterProfiles[0]?.embeddingModel || null,
      basisSampleCount: basis?.sampleCount || 0,
      landmarks,
      missingEmbeddings,
      projection: "ACP à base figée sur les profils de clusters ; un déplacement traduit un changement réel de champ attentionnel"
    }
  };
}
