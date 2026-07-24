// Champ énergétique visible : arêtes vivantes entre les nœuds affichés, énergie
// stockée par nœud, et transferts en cours.
//
// La physique L4 tient trois grandeurs distinctes par arête, qu'il ne faut pas
// confondre :
//   energy  — énergie *stockée* sur l'arête à l'instant du snapshot
//   flows   — transferts *en cours*, chacun avec son montant et sa cause
//   weight  — poids structurel accumulé, qui ne bouge qu'à long terme
//
// La luminosité d'un nœud suit l'énergie ; les bulles qui circulent suivent les
// flux. Un nœud sans arête vivante n'est pas éteint « à zéro » : il est sans
// mesure d'énergie, ce que la vue doit pouvoir distinguer.

const EDGE_KEY = /^(.+)\|([^|]+)\|(.+)$/;

const flowAmount = entry => {
  if (Array.isArray(entry)) return entry.reduce((sum, flow) => sum + Math.abs(Number(flow?.amount) || 0), 0);
  return Math.abs(Number(entry) || 0);
};

const flowKinds = entry => Array.isArray(entry)
  ? [...new Set(entry.map(flow => flow?.flowKind).filter(Boolean))]
  : [];

/**
 * @param physics état physique L4 (energy/flows/weight par clé `source|TYPE|target`)
 * @param nodeIds identifiants des nœuds effectivement affichés
 */
export function buildEnergyField({ physics = {}, nodeIds = [], maxEdges = 60 }) {
  const visible = new Set(nodeIds);
  const energyByEdge = physics.energy || {};
  const flowsByEdge = physics.flows || {};
  const weightByEdge = physics.weight || {};

  const edges = [];
  const nodeEnergy = new Map();
  let maxEdgeEnergy = 0;
  let maxFlow = 0;

  for (const [key, rawEnergy] of Object.entries(energyByEdge)) {
    const match = EDGE_KEY.exec(key);
    if (!match) continue;
    const [, source, type, target] = match;
    const energy = Math.abs(Number(rawEnergy) || 0);

    // L'énergie incidente compte pour un nœud visible même si l'autre extrémité
    // ne l'est pas : sinon la luminosité dépendrait du cadrage, pas du cerveau.
    for (const endpoint of [source, target]) {
      if (visible.has(endpoint)) nodeEnergy.set(endpoint, (nodeEnergy.get(endpoint) || 0) + energy);
    }

    // Une arête compte dès qu'elle touche le champ. Exiger les deux extrémités
    // visibles masquait précisément ce qu'on veut voir : les échanges entre le
    // champ attentionnel et le reste du graphe. L'extrémité hors champ devient
    // un satellite, marqué comme tel.
    const sourceVisible = visible.has(source);
    const targetVisible = visible.has(target);
    if (!sourceVisible && !targetVisible) continue;
    const flow = flowAmount(flowsByEdge[key]);
    maxEdgeEnergy = Math.max(maxEdgeEnergy, energy);
    maxFlow = Math.max(maxFlow, flow);
    edges.push({
      id: key,
      source,
      target,
      type,
      energy,
      flow,
      flowKinds: flowKinds(flowsByEdge[key]),
      weight: Math.abs(Number(weightByEdge[key]) || 0),
      sourceVisible,
      targetVisible
    });
  }

  const maxNodeEnergy = Math.max(0, ...nodeEnergy.values());
  // Trois absences différentes, qu'un seul « 0 » confondrait :
  //   - la physique n'a pas encore tourné (tick 0) : rien n'est mesuré ;
  //   - elle a tourné mais aucune arête n'est vivante : zéro mesuré ;
  //   - elle a tourné et des arêtes vivent, mais aucune ne touche l'affichage.
  const tick = Number(physics.summary?.tick);
  const notRunYet = Number.isFinite(tick) && tick === 0 && !Object.keys(energyByEdge).length;
  const reason = notRunYet
    ? "la physique L4 a été réinitialisée au tick 0 : aucune énergie n'a encore été propagée"
    : !Object.keys(energyByEdge).length
      ? "l'état physique L4 ne contient aucune arête"
      : "aucune arête vivante ne touche les nœuds affichés";

  return {
    measurementStatus: nodeEnergy.size ? "observed" : "unavailable",
    reason: nodeEnergy.size ? null : reason,
    physicsTick: Number.isFinite(tick) ? tick : null,
    // Les arêtes les plus chaudes d'abord, et bornées : au-delà, la carte
    // devient un plat de spaghettis où plus rien ne se lit. La coupe est
    // annoncée pour qu'elle ne passe pas pour une exhaustivité.
    edges: edges.sort((left, right) => right.energy - left.energy).slice(0, maxEdges),
    truncatedEdges: Math.max(0, edges.length - maxEdges),
    totalTouchingEdges: edges.length,
    satelliteIds: [...new Set(edges
      .slice(0, maxEdges)
      .flatMap(edge => [edge.sourceVisible ? null : edge.source, edge.targetVisible ? null : edge.target])
      .filter(Boolean))],
    nodes: [...nodeEnergy].map(([id, energy]) => ({
      id,
      energy,
      // Part relative à la node la plus chaude actuellement visible : c'est une
      // luminosité comparative, pas une échelle absolue.
      brightness: maxNodeEnergy ? energy / maxNodeEnergy : 0
    })),
    maxNodeEnergy,
    maxEdgeEnergy,
    maxFlow,
    activeFlowCount: edges.filter(edge => edge.flow > 0).length
  };
}
