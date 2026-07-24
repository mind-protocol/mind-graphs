const CORTEX_LABELS = Object.freeze({
  "state-monitoring": "veille et détection",
  "state-activation-evaluation": "évaluation de l'importance et de la faisabilité",
  "state-workspace-bidding": "arbitrage du workspace",
  "state-targeting-planning": "recherche de ce qui manque pour atteindre la cible",
  "state-execution": "exécution",
  "state-feedback-monitoring": "vérification du résultat",
  "state-closure-consolidation": "consolidation de ce qui a réussi",
  "state-frustration-pivot": "recherche d'une voie alternative"
});

const MODE_LABELS = Object.freeze({
  OBSERVE: "observe",
  VERIFY: "vérifie avant de s'engager",
  STABILIZE: "stabilise ses ressources",
  PROTECT: "protège son intégrité",
  RECOVER: "récupère progressivement",
  ENGAGE: "s'engage dans l'action"
});

const AFFECT_LABELS = Object.freeze({
  curiosity: "curiosité",
  desire: "désir d'avancer",
  care: "attention portée à ce qui compte",
  fearOfError: "crainte de l'erreur",
  frustration: "frustration",
  surprise: "surprise",
  anger: "colère"
});

export const CITIZEN_STATUS_TEXT_PRESETS = Object.freeze({
  compact: Object.freeze({
    detail: "compact",
    includeUnknowns: false,
    maximumAffects: 1,
    thresholds: Object.freeze({ low: 0.3, high: 0.7, focus: 0.2, strongFocus: 0.65 })
  }),
  standard: Object.freeze({
    detail: "standard",
    includeUnknowns: false,
    maximumAffects: 3,
    thresholds: Object.freeze({ low: 0.3, high: 0.7, focus: 0.2, strongFocus: 0.65 })
  }),
  detailed: Object.freeze({
    detail: "detailed",
    includeUnknowns: true,
    maximumAffects: 5,
    thresholds: Object.freeze({ low: 0.3, high: 0.7, focus: 0.2, strongFocus: 0.65 })
  })
});

const finite = value => value === null || value === undefined || value === ""
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const clamp01 = value => {
  const number = finite(value);
  return number === null ? null : Math.max(0, Math.min(1, number));
};
const percent = value => `${Math.round(clamp01(value) * 100)} %`;
const sentence = text => text.endsWith(".") ? text : `${text}.`;

function resolveConfig(input = "standard") {
  const authored = typeof input === "string" ? { preset: input } : input;
  const presetName = authored?.preset || authored?.detail || "standard";
  const base = CITIZEN_STATUS_TEXT_PRESETS[presetName] || CITIZEN_STATUS_TEXT_PRESETS.standard;
  return {
    ...base,
    ...authored,
    detail: authored?.detail || base.detail,
    thresholds: { ...base.thresholds, ...(authored?.thresholds || {}) }
  };
}

function band(value, config) {
  const number = clamp01(value);
  if (number === null) return "unknown";
  if (number < config.thresholds.low) return "low";
  if (number >= config.thresholds.high) return "high";
  return "medium";
}

function focusText(focus, config) {
  const value = finite(focus);
  if (value === null) return null;
  const magnitude = Math.abs(value);
  if (magnitude < config.thresholds.focus) return "Son attention équilibre les signaux internes et externes";
  const strength = magnitude >= config.thresholds.strongFocus ? "fortement " : "";
  return value < 0
    ? `Son attention est ${strength}orientée vers ses objectifs, tensions et questions internes`
    : `Son attention est ${strength}orientée vers les perceptions et demandes extérieures`;
}

function affectText(affect, config) {
  const ranked = Object.entries(affect?.vector || {})
    .map(([key, value]) => ({ key, value: clamp01(value) }))
    .filter(item => item.value !== null && item.value >= config.thresholds.low)
    .sort((left, right) => right.value - left.value)
    .slice(0, config.maximumAffects);
  if (!ranked.length) return "Aucun affect saillant n'est détecté";
  return `Les affects saillants sont ${ranked.map(item => `${AFFECT_LABELS[item.key] || item.key} (${percent(item.value)})`).join(", ")}`;
}

function awarenessText(awareness, config) {
  if (!awareness || !Object.keys(awareness).length) return null;
  const pieces = [];
  const confidence = band(awareness.calibratedConfidence, config);
  const uncertainty = band(awareness.uncertainty, config);
  const threat = band(awareness.verifiedThreat, config);
  const control = band(awareness.controllability, config);
  if (confidence === "low") pieces.push("sa confiance calibrée reste faible");
  if (confidence === "high") pieces.push("sa confiance calibrée est élevée");
  if (uncertainty === "high") pieces.push("l'incertitude reste importante");
  if (threat === "high") pieces.push("une menace vérifiée importante est active");
  if (control === "low") pieces.push("la situation paraît peu contrôlable");
  if (control === "high") pieces.push("la situation paraît contrôlable");
  return pieces.length ? `Métacognitivement, ${pieces.join(", ")}` : "Les estimations métacognitives restent dans leur zone intermédiaire";
}

function energyText(energy, config) {
  const availability = energy?.availability;
  if (finite(availability) !== null) {
    const state = band(availability, config);
    if (state === "low") return `L'énergie disponible est faible (${percent(availability)})`;
    if (state === "high") return `L'énergie disponible est élevée (${percent(availability)})`;
    return `L'énergie disponible est intermédiaire (${percent(availability)})`;
  }
  if (finite(energy?.citizenEnergy) !== null) {
    return `Le graphe attribue ${Number(energy.citizenEnergy).toFixed(3)} E à ce citoyen`;
  }
  return null;
}

function agencyText(agency) {
  if (!agency?.activeSubentityId) return "Aucune sous-entité ne contrôle explicitement le workspace";
  const confidence = finite(agency.controllerConfidence);
  const confidenceText = confidence === null ? "" : ` avec une confiance de ${percent(confidence)}`;
  return `La sous-entité ${agency.activeSubentityName || agency.activeSubentityId} est attribuée au contrôle${confidenceText}`;
}

function cognitionText(cognition) {
  const questions = Number(cognition?.openQuestionCount || 0);
  const scenarios = Number(cognition?.scenarioCount || 0);
  if (!questions && !scenarios) return "Aucune question interne ni scénario actif n'est diffusé";
  const pieces = [];
  if (questions) pieces.push(`${questions} question${questions > 1 ? "s" : ""} interne${questions > 1 ? "s" : ""}`);
  if (scenarios) pieces.push(`${scenarios} scénario${scenarios > 1 ? "s" : ""}`);
  return `${pieces.join(" et ")} sont actuellement en compétition`;
}

function integrityText(integrity, config) {
  const pieces = [];
  const fragmentation = band(integrity?.fragmentationPressure, config);
  if (fragmentation === "high") pieces.push("la pression de fragmentation est élevée");
  else if (fragmentation === "medium") pieces.push("la pression de fragmentation est modérée");
  else if (fragmentation === "low") pieces.push("la pression de fragmentation est faible");
  if (integrity?.conserved === false) pieces.push("la conservation énergétique échoue");
  if (integrity?.projectionStatus === "repair_required") pieces.push("la projection du graphe doit être réparée");
  return pieces.length ? `Côté intégrité, ${pieces.join(", ")}` : null;
}

export function describeCitizenStatus(status, configInput = "standard") {
  const config = resolveConfig(configInput);
  const name = status?.name || status?.citizenId || "Citoyen inconnu";
  const cortex = CORTEX_LABELS[status?.executive?.cortexState] || status?.executive?.cortexState || "état exécutif inconnu";
  const mode = MODE_LABELS[status?.executive?.metacognitiveMode] || String(status?.executive?.metacognitiveMode || "observe").toLowerCase();
  const focus = focusText(status?.attention?.innerOuterFocus, config);
  const energy = energyText(status?.energy, config);
  const affect = affectText(status?.affect, config);
  const awareness = awarenessText(status?.awareness, config);
  const agency = agencyText(status?.agency);
  const cognition = cognitionText(status?.cognition);
  const integrity = integrityText(status?.integrity, config);
  const activeTask = status?.executive?.activeTask;

  const lead = [`${name} est en ${cortex} et ${mode}`];
  if (focus) lead.push(focus);
  if (energy) lead.push(energy);
  if (config.detail !== "compact") lead.push(affect);

  let sections = [
    { id: "executive", title: "Orientation actuelle", text: lead.map(sentence).join(" ") },
    { id: "awareness", title: "Lecture de soi", text: awareness ? sentence(awareness) : null },
    { id: "agency", title: "Agence", text: sentence(agency) },
    { id: "cognition", title: "Travail cognitif", text: sentence(cognition) },
    { id: "integrity", title: "Intégrité", text: integrity ? sentence(integrity) : null }
  ].filter(section => section.text || config.includeUnknowns);

  if (config.detail === "compact") sections = sections.filter(section => section.id === "executive");
  if (config.detail === "detailed" && activeTask) {
    sections.splice(1, 0, {
      id: "task",
      title: "Tâche active",
      text: sentence(`${activeTask.name || activeTask.id}${activeTask.summary ? ` — ${activeTask.summary}` : ""}`)
    });
  }

  const alerts = [];
  if (band(status?.energy?.availability, config) === "low") alerts.push({ level: "warning", code: "low_energy", text: "Énergie disponible faible" });
  if (band(status?.awareness?.verifiedThreat, config) === "high") alerts.push({ level: "danger", code: "verified_threat", text: "Menace vérifiée élevée" });
  if (band(status?.integrity?.fragmentationPressure, config) === "high") alerts.push({ level: "warning", code: "fragmentation", text: "Fragmentation élevée" });
  if (status?.integrity?.projectionStatus === "repair_required") alerts.push({ level: "danger", code: "projection", text: "Projection à réparer" });

  return {
    preset: config.detail,
    headline: `${name} · ${cortex}`,
    summary: lead.map(sentence).join(" "),
    sections,
    alerts
  };
}

// Sérialise un `status` (issu de composeCitizenStatuses) en markdown lisible :
// le Global Workspace en prose. On ne réémet pas `summary` séparément, car la
// section « Orientation actuelle » en est déjà le texte — éviter le doublon.
export function statusToMarkdown(status, configInput = "standard") {
  const described = describeCitizenStatus(status, configInput);
  const lines = [`# ${described.headline}`];

  const provenance = [];
  if (status?.observedAt) provenance.push(`observé ${status.observedAt}`);
  if (finite(status?.tick) !== null) provenance.push(`tick ${status.tick}`);
  if (finite(status?.revision) !== null) provenance.push(`révision ${status.revision}`);
  const degraded = Object.entries(status?.sourceAvailability || {})
    .filter(([, value]) => value && value.available === false)
    .map(([source]) => source);
  if (degraded.length) provenance.push(`sources indisponibles : ${degraded.join(", ")}`);
  if (provenance.length) lines.push("", `*${provenance.join(" · ")}*`);

  for (const section of described.sections) {
    if (!section.text) continue;
    lines.push("", `## ${section.title}`, section.text);
  }

  if (described.alerts.length) {
    lines.push("", "## Alertes");
    for (const alert of described.alerts) {
      lines.push(`- **[${alert.level}]** ${alert.text} (\`${alert.code}\`)`);
    }
  }

  return lines.join("\n");
}
