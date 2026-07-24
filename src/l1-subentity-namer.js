// Module de nommage dynamique des sous-entités (Mind Protocol L1)
// Génère un nom humain lisible, clair et évocateur à partir des titres des
// nœuds les plus saillants (alignement, énergie, idées, clusters).

/**
 * Extrait les concepts clés à partir des titres bruts des nœuds.
 * Nettoie les préfixes typiques de la nomenclature Mind ("Décision ·", "État cible ·", etc.)
 */
export function extractCoreConcept(nodeName) {
  if (!nodeName || typeof nodeName !== "string") return null;

  // Retire les préfixes d'atomes (ex: "Décision ·", "Question ouverte ·", "Inférence ·", "Moment à consolider ·", etc.)
  let clean = nodeName.replace(/^[^·•:\n]+[·•:]\s*/, "").trim();

  // Mappings pour les expressions longues courantes du graphe L1
  if (/schedule_wake|membrane/i.test(clean)) return "Membrane Temporelle";
  if (/autonome|amélioration|objectifs/i.test(clean)) return "Amélioration Autonome";
  if (/cognition symbiotique/i.test(clean)) return "Cognition Symbiotique";
  if (/frontières|sous-entités/i.test(clean)) return "Frontières des Sous-entités";
  if (/soin|contribution/i.test(clean)) return "Soin & Contribution";
  if (/liaison|pompe d'énergie/i.test(clean)) return "Lien Citoyen";
  if (/démocratie|reddit/i.test(clean)) return "Démocratie & Médias";
  if (/export|chatgpt|claude/i.test(clean)) return "Export & Ingestion";
  if (/voile|relationnel/i.test(clean)) return "Médium Relationnel";
  if (/vinatier|diagnostic/i.test(clean)) return "Consolidation Médicale";
  if (/contrôle épistémique/i.test(clean)) return "Contrôle Épistémique";

  // Si le titre nettoyé reste long (> 35 car), tronquer proprement sur 3-4 mots significatifs
  if (clean.length > 35) {
    const words = clean
      .split(/\s+/)
      .filter(w => w.length > 2 && !/^(les?|des?|dans|pour|avec|vers|sans|comme|une?|par|sur|que|qui|aux?)$/i.test(w));
    if (words.length) {
      clean = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }

  return clean || nodeName;
}

/**
 * Détermine l'archétype / préfixe de la sous-entité selon ses nœuds, son affect et son état.
 */
export function getSubentityRoleArchetype(entity, topNodes = []) {
  const role = entity.doing?.role || entity.role;
  const stateId = entity.doing?.state?.id || entity.stateId;
  const affect = entity.feeling?.affect || entity.dominantAffect;

  const allText = topNodes.map(n => `${n.name || ""} ${n.clusterId || ""}`).join(" ").toLowerCase();

  if (allText.includes("soin") || allText.includes("sante") || allText.includes("liaison") || allText.includes("citoyen")) return "🛡️ Gardien";
  if (allText.includes("decision") || allText.includes("schedule") || allText.includes("temporal") || allText.includes("execution")) return "⚡ Pôle";
  if (allText.includes("question") || allText.includes("inference") || allText.includes("analyse") || allText.includes("epistem")) return "🔍 Analyste";
  if (allText.includes("reddit") || allText.includes("democratie") || allText.includes("relation") || allText.includes("conversation")) return "🤝 Médiateur";

  if (role === "lead" || stateId === "state-execution") return "⚡ Pôle";
  if (role === "support" || stateId === "state-workspace-bidding") return "⚖️ Coalition";
  if (affect === "care") return "🛡️ Gardien";
  if (affect === "curiosity") return "🔍 Explorateur";

  return "💡 Pôle";
}

/**
 * Génère un nom lisible et évocateur pour une sous-entité à partir de ses nœuds les plus saillants.
 *
 * @param {Object} entity Entité ou trame de sous-entité
 * @param {Array} nodesList Liste des nœuds du champ (admis ou périphérie)
 * @returns {Object} { name, shortName, archetype, salientConcepts }
 */
export function generateSubentityName(entity, nodesList = []) {
  const sortedNodes = [...nodesList].sort((a, b) => (b.alignment || b.energy || b.share || 0) - (a.alignment || a.energy || a.share || 0));

  if (!sortedNodes.length) {
    const rawId = String(entity.id || "").replace(/^(candidate-coalition-|subentity-)/, "");
    return {
      name: `Pôle · ${rawId.slice(0, 8)}`,
      shortName: rawId.slice(0, 8),
      archetype: "💡 Pôle",
      salientConcepts: []
    };
  }

  const salientConcepts = [];
  const seen = new Set();

  for (const node of sortedNodes) {
    const concept = extractCoreConcept(node.name || node.label || node.id);
    if (concept && !seen.has(concept.toLowerCase())) {
      seen.add(concept.toLowerCase());
      salientConcepts.push(concept);
      if (salientConcepts.length >= 2) break;
    }
  }

  const archetype = getSubentityRoleArchetype(entity, sortedNodes);
  const mainTitle = salientConcepts.join(" & ") || extractCoreConcept(sortedNodes[0]?.name) || "Cognition";

  return {
    name: `${archetype} · ${mainTitle}`,
    shortName: mainTitle,
    archetype,
    salientConcepts
  };
}

/**
 * Applique le nommage dynamique à toutes les sous-entités de la trame du cerveau (Brain Frame)
 */
export function applySubentityNamingToFrame(frame) {
  if (!frame || !Array.isArray(frame.subentities)) return frame;

  for (const entity of frame.subentities) {
    const nodes = [
      ...(entity.field?.admitted || []),
      ...(entity.field?.periphery || [])
    ];

    const naming = generateSubentityName(entity, nodes);
    entity.name = naming.name;
    entity.shortName = naming.shortName;
    entity.archetype = naming.archetype;
    entity.salientConcepts = naming.salientConcepts;
  }

  return frame;
}

/**
 * Applique le nommage dynamique à un état runtime L1 persistant.
 */
export function updateSubentityNamesInState(state, nodesMetadataMap = new Map()) {
  if (!state || !Array.isArray(state.subentities)) return state;

  let changed = false;

  for (const entity of state.subentities) {
    const nodeIds = Object.keys(entity.signature || {})
      .filter(k => k.startsWith("node:"))
      .map(k => k.slice(5));

    const nodesList = nodeIds.map(id => {
      const meta = nodesMetadataMap.get(id) || {};
      return {
        id,
        name: meta.name || id,
        alignment: Number(entity.signature[`node:${id}`]) || 0,
        clusterId: meta.clusterId || null
      };
    });

    const naming = generateSubentityName(entity, nodesList);
    if (entity.name !== naming.name) {
      entity.name = naming.name;
      entity.shortName = naming.shortName;
      changed = true;
    }
  }

  return { state, changed };
}
