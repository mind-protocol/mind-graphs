// Projette le corpus actuel dans la forme L4 : cinq rôles physiques de nœuds et
// un lien universel porteur d'une physique signée, conditionnelle et temporelle.
//
// La projection est délibérément non destructive. Elle ne remplace pas les
// données ; elle produit un artefact et, surtout, un rapport de retour arrière.
// Le seul énoncé qui compte est celui-là : combien de prédicats sont encore
// reconnaissables quand on n'a plus que les nombres et la topologie. Un mapping
// qui ne mesure pas sa propre perte n'est pas un mapping, c'est un vœu.
import {
  loadManifest, selectGraph, loadOntology, readDatasets, datasetNodes, datasetLinks
} from "./graph-manifest.js";

const MAPPING_DATASET = "l4-ontology-mapping";

// Les quatre nombres que porte un lien projeté. `permanence` vit dans [0,1] et
// les trois autres dans [-1,1] : sans normalisation par l'amplitude, un écart de
// permanence pèserait deux fois moins qu'un écart de polarité, ce qui fausserait
// silencieusement toutes les distances du décodeur.
const AXES = [
  { key: "p_ab", span: 2, of: profile => profile.polarity[0] },
  { key: "p_ba", span: 2, of: profile => profile.polarity[1] },
  { key: "hierarchy", span: 2, of: profile => profile.hierarchy },
  { key: "permanence", span: 1, of: profile => profile.permanence }
];

const vectorOf = profile => AXES.map(axis => axis.of(profile));

function distance(a, b) {
  const sum = AXES.reduce((acc, axis, index) => {
    const delta = (a[index] - b[index]) / axis.span;
    return acc + delta * delta;
  }, 0);
  return Math.sqrt(sum / AXES.length);
}

/** Types de nœuds qu'un prédicat accepte à une extrémité, selon l'ontologie. */
function allowedTypes(ontology, predicate, side) {
  const constraint = ontology.relationConstraints?.[predicate];
  if (!constraint || constraint.allowAny) return null;
  const types = new Set(constraint[`${side}Types`] || []);
  for (const group of constraint[`${side}Groups`] || []) {
    for (const type of ontology.typeGroups?.[group] || []) types.add(type);
  }
  return types.size ? types : null;
}

/**
 * Décode un lien projeté sans jamais regarder son ancien verbe : on ne dispose
 * que des nombres et, si la politique l'exige, des types des extrémités.
 * Retourne `ambiguous` plutôt que d'élire un gagnant à la marge.
 */
export function decode(vector, { profiles, policy, ontology, sourceType, targetType }) {
  let candidates = profiles.map(profile => ({
    predicate: profile.source,
    mode: profile.mode,
    distance: distance(vector, vectorOf(profile))
  }));

  if (policy.requireTopology && sourceType && targetType) {
    const compatible = candidates.filter(candidate => {
      const sources = allowedTypes(ontology, candidate.predicate, "source");
      const targets = allowedTypes(ontology, candidate.predicate, "target");
      return (!sources || sources.has(sourceType)) && (!targets || targets.has(targetType));
    });
    if (compatible.length) candidates = compatible;
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const [best, runnerUp] = candidates;
  const withinTolerance = candidates.filter(c => c.distance <= policy.candidateTolerance);

  if (!withinTolerance.length) return { verdict: "no_candidate", best: best?.predicate ?? null, candidates: [] };
  if (withinTolerance.length === 1) return { verdict: "decoded", best: best.predicate, candidates: [best.predicate] };

  const margin = runnerUp.distance - best.distance;
  if (margin >= policy.minimumWinnerMargin) {
    return { verdict: "decoded", best: best.predicate, candidates: withinTolerance.map(c => c.predicate) };
  }
  return { verdict: "ambiguous", best: best.predicate, candidates: withinTolerance.map(c => c.predicate) };
}

export async function projectGraph(graphId = "design") {
  const manifest = await loadManifest();
  const graph = selectGraph(manifest, graphId);
  const [ontology, datasets] = await Promise.all([loadOntology(graph), readDatasets(graph)]);

  const mappingEntry = datasets.find(entry => entry.id === MAPPING_DATASET);
  if (!mappingEntry) throw new Error(`Le graphe "${graphId}" ne déclare pas le jeu ${MAPPING_DATASET}`);
  const mapping = mappingEntry.data;
  const typeMap = new Map(
    mapping.nodes.find(node => node.id === "l4-node-type-mapping").mappings.map(entry => [entry.source, entry])
  );
  const dictionary = mapping.nodes.find(node => node.id === "l4-predicate-translation-dictionary");
  const profiles = dictionary.profiles;
  const profileMap = new Map(profiles.map(profile => [profile.source, profile]));
  const policy = dictionary.decoderPolicy;

  const nodes = [];
  const links = [];
  for (const entry of datasets) {
    for (const node of datasetNodes(entry)) nodes.push(node);
    for (const link of datasetLinks(entry)) links.push(link);
  }
  const typeOf = new Map(nodes.map(node => [node.id, node.semanticType || node.nodeType]));
  const nameOf = new Map(nodes.map(node => [node.id, node.name]));

  const roleCounts = {};
  const unmappedTypes = new Set();
  let overrideCandidates = 0;
  const L4_ROLES = new Set(["actor", "moment", "narrative", "space", "thing"]);
  const projectedNodes = nodes.map(node => {
    const semanticType = node.semanticType || node.nodeType;
    const rule = typeMap.get(semanticType);
    if (!rule && !L4_ROLES.has(node.nodeType)) unmappedTypes.add(semanticType);
    if (rule?.override) overrideCandidates += 1;
    const role = L4_ROLES.has(node.nodeType) ? node.nodeType : (rule?.l4 ?? null);
    roleCounts[role ?? "unmapped"] = (roleCounts[role ?? "unmapped"] || 0) + 1;
    const projected = {
      id: node.id,
      role,
      legacyType: semanticType,
      name: node.name,
      overrideRule: rule?.override ?? null,
      needsArbitration: Boolean(rule?.override)
    };
    if (rule?.momentStatus) projected.momentStatus = rule.momentStatus;
    if (rule?.momentStatusFrom) projected.momentStatus = node[rule.momentStatusFrom] ?? null;
    return projected;
  });

  const dynamic = dictionary.dynamicDefaults;
  // Depuis le mapping 0.4.0 un lien projeté ne porte plus ni delay ni duration :
  // ce qu'un routeur impose arrive par gate, et le noyau n'en garde aucun champ.
  const roundTrip = { decoded: 0, ambiguous: 0, no_candidate: 0, wrong: 0 };
  const lossByMode = {};
  const collisions = new Map();
  const unmappedPredicates = new Set();

  const projectedLinks = links.map(link => {
    const profile = profileMap.get(link.type);
    if (!profile) {
      unmappedPredicates.add(link.type);
      return { source: link.source, target: link.target, legacyPredicate: link.type, projected: false };
    }
    const vector = vectorOf(profile);
    const result = decode(vector, {
      profiles, policy, ontology,
      sourceType: typeOf.get(link.source),
      targetType: typeOf.get(link.target)
    });
    const recovered = result.verdict === "decoded" && result.best === link.type;
    const verdict = result.verdict === "decoded" && !recovered ? "wrong" : result.verdict;
    roundTrip[verdict] += 1;

    lossByMode[profile.mode] ??= { total: 0, recovered: 0 };
    lossByMode[profile.mode].total += 1;
    if (recovered) lossByMode[profile.mode].recovered += 1;

    if (verdict !== "decoded") {
      const key = `${link.type} ~ ${result.candidates.join(" | ") || result.best}`;
      collisions.set(key, (collisions.get(key) || 0) + 1);
    }

    return {
      source: link.source,
      target: link.target,
      legacyPredicate: link.type,
      projected: true,
      physics: {
        polarity: profile.polarity,
        hierarchy: profile.hierarchy,
        permanence: profile.permanence,
        weight: dynamic.weight,
        energy: dynamic.energy,
        gate: dynamic.gate
      },
      synthesis: profile.synthesis
        .replace("{a}", nameOf.get(link.source) ?? link.source)
        .replace("{b}", nameOf.get(link.target) ?? link.target),
      mode: profile.mode,
      decode: { verdict, best: result.best, candidates: result.candidates }
    };
  });

  const decodable = roundTrip.decoded;
  return {
    graphId,
    mappingVersion: mapping.mappingVersion,
    ontologyDimensions: Object.keys(
      mapping.nodes.find(node => node.id === "l4-signed-conditional-temporal-physics").dimensions
    ),
    summary: {
      nodes: projectedNodes.length,
      links: projectedLinks.length,
      roles: roleCounts,
      nodesNeedingArbitration: overrideCandidates,
      unmappedNodeTypes: [...unmappedTypes],
      unmappedPredicates: [...unmappedPredicates],
      roundTrip,
      recoveryRatePct: links.length ? Number(((decodable / links.length) * 100).toFixed(1)) : 0,
      lossByMode: Object.fromEntries(Object.entries(lossByMode).map(([mode, stat]) => [
        mode,
        { ...stat, recoveryRatePct: Number(((stat.recovered / stat.total) * 100).toFixed(1)) }
      ])),
      topCollisions: [...collisions.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([signature, count]) => ({ signature, count }))
    },
    nodes: projectedNodes,
    links: projectedLinks
  };
}
