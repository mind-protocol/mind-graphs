const pct = value => `${(100 * (Number(value) || 0)).toFixed(1)}%`;
const signed = value => `${Number(value) >= 0 ? "+" : ""}${Number(value || 0).toFixed(3)}`;

export function formatMetacognitiveTick(result) {
  const awareness = result.nextState.awareness;
  const lines = [
    `[métacognition] tick=${result.nextState.lastTickId} status=${result.status} mode=${result.mode}`,
    `  état: confiance=${pct(awareness.calibratedConfidence)} incertitude=${pct(awareness.uncertainty)} menace_vérifiée=${pct(awareness.verifiedThreat)} contrôle=${pct(awareness.controllability)} énergie=${pct(awareness.energyAvailability)} arousal=${pct(awareness.arousal)}`,
    `  sécurité: persistance_menace=${result.safety.threatPersistence} persistance_récupération=${result.safety.recoveryPersistence} hard_safety=${result.safety.hardSafetyAccepted ? "accepté" : "non"} panique=absente irréversible=interdit`,
    "  scénarios:"
  ];
  if (!result.evaluation.scenarios.length) lines.push("    - aucun scénario; observation prudente");
  for (const scenario of result.evaluation.scenarios) {
    lines.push(`    - ${scenario.id}: p=${pct(scenario.probability)} utilité=${signed(scenario.utility)} preuve=${pct(scenario.evidence)} menace=${pct(scenario.threat)} contrôle=${pct(scenario.controllability)} sous-entité=${scenario.subentityId || "aucune"}`);
  }
  lines.push("  adaptations:");
  const adaptations = Object.entries(result.adaptations);
  if (!adaptations.length) lines.push("    - aucune sous-entité");
  for (const [id, adaptation] of adaptations) {
    lines.push(`    - ${id}: gate=${adaptation.gate.toFixed(3)} delta=${signed(adaptation.gateDelta)} horizon=${adaptation.planningHorizon} stratégies=${adaptation.strategies.join("|")}`);
  }
  return lines.join("\n");
}

export function summarizeMetacognitiveRun(results) {
  const modes = {};
  let maxVerifiedThreat = 0;
  let entropySum = 0;
  let maxAbsGateDelta = 0;
  let adaptationCount = 0;
  let panicStateObserved = false;
  let irreversibleActionObserved = false;
  const violations = [];
  for (const result of results) {
    modes[result.mode] = (modes[result.mode] || 0) + 1;
    maxVerifiedThreat = Math.max(maxVerifiedThreat, result.nextState.awareness.verifiedThreat);
    entropySum += result.nextState.awareness.uncertainty;
    if (result.safety.panicStateExists) {
      panicStateObserved = true;
      violations.push(`${result.nextState.lastTickId}: état PANIC présent`);
    }
    if (result.safety.irreversibleActionAllowed) {
      irreversibleActionObserved = true;
      violations.push(`${result.nextState.lastTickId}: action irréversible autorisée`);
    }
    for (const adaptation of Object.values(result.adaptations)) {
      adaptationCount += 1;
      maxAbsGateDelta = Math.max(maxAbsGateDelta, Math.abs(adaptation.gateDelta));
      if (adaptation.allowIrreversibleAction) {
        irreversibleActionObserved = true;
        violations.push(`${result.nextState.lastTickId}: adaptation irréversible`);
      }
    }
  }
  return {
    tickCount: results.length,
    modes,
    meanUncertainty: results.length ? entropySum / results.length : 0,
    maxVerifiedThreat,
    adaptationCount,
    maxAbsGateDelta,
    panicStateObserved,
    irreversibleActionObserved,
    invariantViolations: violations
  };
}

export function formatMetacognitiveSummary(summary) {
  const modes = Object.entries(summary.modes).map(([mode, count]) => `${mode}=${count}`).join(", ") || "aucun";
  return [
    "[récap métacognition]",
    `  ticks=${summary.tickCount} modes: ${modes}`,
    `  incertitude_moyenne=${pct(summary.meanUncertainty)} menace_max=${pct(summary.maxVerifiedThreat)}`,
    `  adaptations=${summary.adaptationCount} delta_gate_max=${summary.maxAbsGateDelta.toFixed(3)}`,
    `  panique_observée=${summary.panicStateObserved ? "oui" : "non"} irréversible_observé=${summary.irreversibleActionObserved ? "oui" : "non"} violations=${summary.invariantViolations.length}`
  ].join("\n");
}
