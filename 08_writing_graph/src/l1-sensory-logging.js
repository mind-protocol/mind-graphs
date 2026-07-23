const round = (value, digits = 3) => Number((Number(value) || 0).toFixed(digits));
const percent = value => `${round(100 * value, 1).toFixed(1)} %`;

function groupTransfers(transfers, index) {
  const grouped = new Map();
  for (const transfer of transfers || []) {
    const current = grouped.get(transfer.targetNodeId) || {
      nodeId: transfer.targetNodeId,
      name: index.nameOf.get(transfer.targetNodeId) || transfer.targetNodeId,
      cluster: index.clusterOf.get(transfer.targetNodeId) || "(hors cluster)",
      energy: 0,
      transferCount: 0,
      similarityTotal: 0,
      sourceGraphs: new Set()
    };
    current.energy += transfer.energy;
    current.transferCount += 1;
    current.similarityTotal += transfer.similarity;
    current.sourceGraphs.add(transfer.sourceGraphId);
    grouped.set(transfer.targetNodeId, current);
  }
  return [...grouped.values()]
    .map(item => ({
      ...item,
      energy: round(item.energy, 6),
      meanSimilarity: round(item.similarityTotal / item.transferCount, 4),
      sourceGraphs: [...item.sourceGraphs].sort()
    }))
    .sort((a, b) => b.energy - a.energy || a.nodeId.localeCompare(b.nodeId));
}

export function explainAttention(attention) {
  const { workspace, external, scores } = attention;
  const reasons = [];
  if (workspace.orientation === "internal" && workspace.focusIntensity > 0) {
    reasons.push(`l'entité ${workspace.entityId || "active"} est focalisée vers l'interne (${percent(workspace.focusIntensity)})`);
  } else if (workspace.orientation === "external" && workspace.focusIntensity > 0) {
    reasons.push(`l'entité ${workspace.entityId || "active"} est focalisée vers l'extérieur (${percent(workspace.focusIntensity)})`);
  } else {
    reasons.push("le workspace est en orientation équilibrée");
  }
  if (external.novelty >= 0.67) reasons.push("les signaux sont largement nouveaux");
  else if (external.novelty >= 0.33) reasons.push("les signaux commencent à devenir familiers");
  else reasons.push("les signaux sont surtout familiers");
  if (external.intensity >= 0.67) reasons.push("l'intensité extérieure est forte");
  else if (external.intensity >= 0.33) reasons.push("l'intensité extérieure est moyenne");
  else reasons.push("l'intensité extérieure est faible");
  const winner = scores.external > scores.internal ? "l'extérieur reçoit la priorité" : "l'activité interne reçoit la priorité";
  return `${reasons.join(" ; ")} ; ${winner}.`;
}

export function buildSensoryTickLog(report, index, { physicsBefore, physicsAfter, targetLimit = 8 } = {}) {
  const attention = report.attention;
  const targets = groupTransfers(report.sensory.transfers, index);
  const conservationError = Math.abs(report.totalBudget - report.sensoryAllocated - report.localBudget);
  return {
    tickId: report.sensory.tickId,
    workspace: attention.workspace,
    perception: {
      selectedConnections: report.sensory.selectedConnections.length,
      intensity: round(attention.external.intensity, 4),
      novelty: round(attention.external.novelty, 4),
      connections: report.sensory.selectedConnections.map(connection => ({
        graphId: connection.graphId,
        source: connection.sourceNode?.name || connection.source,
        type: connection.link.type,
        target: connection.targetNode?.name || connection.target,
        weight: round(connection.weight, 4),
        strong: connection.selectedBecause.strong,
        recent: connection.selectedBecause.recent
      }))
    },
    arbitration: {
      externalScore: round(attention.scores.external, 4),
      internalScore: round(attention.scores.internal, 4),
      sensoryShare: round(attention.sensoryShare, 6),
      localShare: round(report.totalBudget ? report.localBudget / report.totalBudget : 0, 6),
      sensoryBudget: round(attention.sensoryBudget, 6),
      sensoryAllocated: round(report.sensoryAllocated, 6),
      localBudget: round(report.localBudget, 6),
      focusDynamics: attention.focusDynamics,
      explanation: explainAttention(attention)
    },
    routing: {
      transfers: report.sensory.transfers.length,
      uniqueTargets: targets.length,
      targets,
      topTargets: targets.slice(0, targetLimit)
    },
    graph: {
      before: physicsBefore || null,
      after: physicsAfter || null,
      energyDelta: physicsBefore && physicsAfter ? round(physicsAfter.totalEnergy - physicsBefore.totalEnergy, 6) : null,
      liveLinksDelta: physicsBefore && physicsAfter ? physicsAfter.liveLinks - physicsBefore.liveLinks : null
    },
    conservation: {
      totalBudget: round(report.totalBudget, 6),
      accountedBudget: round(report.sensoryAllocated + report.localBudget, 6),
      error: round(conservationError, 12),
      conserved: conservationError < 1e-9
    }
  };
}

export function formatSensoryTickLog(log) {
  const entity = log.workspace.entityId || "aucune entité déclarée";
  const focusDynamics = log.arbitration.focusDynamics;
  const lines = [
    `\n══════════ ${log.tickId} ══════════`,
    `WORKSPACE  ${entity} · orientation ${log.workspace.orientation} · focus ${percent(log.workspace.focusIntensity)}`,
    `PERCEPTION ${log.perception.selectedConnections} connexion(s) · intensité ${percent(log.perception.intensity)} · nouveauté ${percent(log.perception.novelty)}`,
    `ARBITRAGE  externe ${log.arbitration.externalScore.toFixed(3)} ↔ interne ${log.arbitration.internalScore.toFixed(3)}`,
    focusDynamics ? `FOCUS       ${focusDynamics.previousFocus.toFixed(3)} → ${focusDynamics.nextFocus.toFixed(3)} · cible ${focusDynamics.target.toFixed(3)}` : null,
    `ALLOCATION sensoriel ${percent(log.arbitration.sensoryShare)} (${log.arbitration.sensoryAllocated.toFixed(3)} E) · local ${percent(log.arbitration.localShare)} (${log.arbitration.localBudget.toFixed(3)} E)`,
    `POURQUOI   ${log.arbitration.explanation}`
  ].filter(Boolean);
  if (log.perception.connections.length) {
    lines.push("CONNEXIONS RETENUES");
    for (const connection of log.perception.connections) {
      const reasons = [connection.strong ? "forte" : null, connection.recent ? "récente" : null].filter(Boolean).join("+");
      lines.push(`  • [${connection.graphId}] ${connection.source} —${connection.type}→ ${connection.target} · W=${connection.weight.toFixed(3)} · ${reasons}`);
    }
  } else {
    lines.push("CONNEXIONS RETENUES  aucune : tout le budget reste local");
  }
  if (log.routing.topTargets.length) {
    lines.push(`ROUTAGE     ${log.routing.transfers} transfert(s) vers ${log.routing.uniqueTargets} node(s) L1`);
    for (const target of log.routing.topTargets) {
      lines.push(`  → ${target.name} [${target.cluster}] +${target.energy.toFixed(4)} E · similarité ${target.meanSimilarity.toFixed(3)}`);
    }
    if (log.routing.uniqueTargets > log.routing.topTargets.length) {
      lines.push(`  … ${log.routing.uniqueTargets - log.routing.topTargets.length} autre(s) cible(s)`);
    }
  }
  if (log.graph.after) {
    lines.push(`GRAPHE      énergie ${log.graph.before?.totalEnergy ?? 0} → ${log.graph.after.totalEnergy} E · liens vivants ${log.graph.before?.liveLinks ?? 0} → ${log.graph.after.liveLinks}`);
    const clusters = (log.graph.after.byCluster || []).slice(0, 3).map(item => `${item.cluster}=${item.energy}`).join(" · ");
    if (clusters) lines.push(`ZONES CHAUDES ${clusters}`);
  }
  lines.push(`CONSERVATION ${log.conservation.conserved ? "OK" : "ERREUR"} · budget ${log.conservation.totalBudget.toFixed(3)} E · écart ${log.conservation.error}`);
  return lines.join("\n");
}

export function summarizeSensoryRun(logs) {
  const count = logs.length;
  const sum = selector => logs.reduce((total, log) => total + selector(log), 0);
  const shares = logs.map(log => log.arbitration.sensoryShare);
  const targetTotals = new Map();
  const sourceTotals = new Map();
  for (const log of logs) {
    for (const connection of log.perception.connections) {
      sourceTotals.set(connection.graphId, (sourceTotals.get(connection.graphId) || 0) + 1);
    }
    for (const target of log.routing.targets) {
      const current = targetTotals.get(target.nodeId) || { nodeId: target.nodeId, name: target.name, cluster: target.cluster, energy: 0, ticks: 0 };
      current.energy += target.energy;
      current.ticks += 1;
      targetTotals.set(target.nodeId, current);
    }
  }
  const finalGraph = logs.at(-1)?.graph.after || null;
  return {
    ticks: count,
    selectedConnections: sum(log => log.perception.selectedConnections),
    transfers: sum(log => log.routing.transfers),
    uniqueTargetNodes: new Set(logs.flatMap(log => log.routing.targets.map(target => target.nodeId))).size,
    energy: {
      totalCitizenBudget: round(sum(log => log.conservation.totalBudget), 6),
      sensoryAllocated: round(sum(log => log.arbitration.sensoryAllocated), 6),
      localAllocated: round(sum(log => log.arbitration.localBudget), 6),
      maximumConservationError: round(Math.max(0, ...logs.map(log => log.conservation.error)), 12)
    },
    attention: {
      meanSensoryShare: round(count ? sum(log => log.arbitration.sensoryShare) / count : 0, 6),
      minimumSensoryShare: round(count ? Math.min(...shares) : 0, 6),
      maximumSensoryShare: round(count ? Math.max(...shares) : 0, 6),
      initialNovelty: round(logs[0]?.perception.novelty || 0, 4),
      finalNovelty: round(logs.at(-1)?.perception.novelty || 0, 4),
      meanExternalIntensity: round(count ? sum(log => log.perception.intensity) / count : 0, 4)
    },
    sources: [...sourceTotals.entries()].sort((a, b) => b[1] - a[1]).map(([graphId, connections]) => ({ graphId, connections })),
    hottestTargets: [...targetTotals.values()].sort((a, b) => b.energy - a.energy).slice(0, 10).map(item => ({ ...item, energy: round(item.energy, 6) })),
    finalGraph
  };
}

export function formatSensoryRunSummary(stats) {
  const lines = [
    "\n══════════ RÉCAPITULATIF SENSORIEL ══════════",
    `Activité       ${stats.ticks} tick(s) · ${stats.selectedConnections} connexion(s) · ${stats.transfers} transfert(s) · ${stats.uniqueTargetNodes} cible(s) L1`,
    `Énergie        budget ${stats.energy.totalCitizenBudget.toFixed(3)} E · sensoriel ${stats.energy.sensoryAllocated.toFixed(3)} E · local ${stats.energy.localAllocated.toFixed(3)} E`,
    `Attention      moyenne ${percent(stats.attention.meanSensoryShare)} · min ${percent(stats.attention.minimumSensoryShare)} · max ${percent(stats.attention.maximumSensoryShare)}`,
    `Habituation    nouveauté ${percent(stats.attention.initialNovelty)} → ${percent(stats.attention.finalNovelty)} · intensité moyenne ${percent(stats.attention.meanExternalIntensity)}`,
    `Conservation   écart maximal ${stats.energy.maximumConservationError} E`,
    `Sources        ${stats.sources.map(item => `${item.graphId}: ${item.connections}`).join(" · ") || "aucune"}`
  ];
  if (stats.hottestTargets.length) {
    lines.push("CIBLES LES PLUS STIMULÉES");
    for (const target of stats.hottestTargets.slice(0, 5)) lines.push(`  • ${target.name} [${target.cluster}] ${target.energy.toFixed(4)} E sur ${target.ticks} tick(s)`);
  }
  if (stats.finalGraph) {
    lines.push(`ÉTAT FINAL     ${stats.finalGraph.totalEnergy} E dans ${stats.finalGraph.liveLinks}/${stats.finalGraph.links} liens · ${stats.finalGraph.activeFlows} flux actif(s)`);
  }
  return lines.join("\n");
}
