const byId = id => document.getElementById(id);
const state = { citizens: [], selectedId: null };
const AFFECT_LABELS = {
  curiosity: "Curiosité", desire: "Désir", care: "Care", fearOfError: "Crainte de l'erreur",
  frustration: "Frustration", surprise: "Surprise", anger: "Colère"
};
const AWARENESS_LABELS = {
  arousal: "Activation", energyAvailability: "Énergie disponible", uncertainty: "Incertitude",
  controllability: "Contrôlabilité", expectedValence: "Valence attendue",
  verifiedThreat: "Menace vérifiée", calibratedConfidence: "Confiance calibrée"
};

const finite = value => value === null || value === undefined || value === ""
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const unit = value => Math.max(0, Math.min(1, finite(value) ?? 0));
const valueText = (value, digits = 2) => finite(value) === null ? "indisponible" : Number(value).toFixed(digits);
const percent = value => finite(value) === null ? "indisponible" : `${Math.round(unit(value) * 100)} %`;
const label = value => String(value || "indisponible").replaceAll("_", " ");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function empty() {
  return byId("empty-template").content.cloneNode(true);
}

function replace(id, nodes) {
  byId(id).replaceChildren(...(nodes.length ? nodes : [empty()]));
}

function metricCard(name, value, detail, tone = "") {
  const card = element("article", `metric ${tone}`);
  card.append(element("span", "metric-label", name), element("strong", "", value), element("small", "", detail));
  return card;
}

function meter(name, value, options = {}) {
  const row = element("div", "meter-row");
  const head = element("div", "meter-head");
  head.append(element("span", "", name), element("strong", "", options.signed ? valueText(value) : percent(value)));
  const track = element("div", `meter-track ${options.signed ? "signed" : ""}`);
  const fill = element("i");
  if (options.signed) {
    const normalized = (Math.max(-1, Math.min(1, finite(value) ?? 0)) + 1) / 2;
    fill.style.setProperty("--value", `${normalized * 100}%`);
  } else {
    fill.style.setProperty("--value", `${unit(value) * 100}%`);
  }
  track.append(fill);
  row.append(head, track);
  return row;
}

function keyValues(entries) {
  const list = element("dl", "key-values");
  for (const [key, value] of entries) {
    list.append(element("dt", "", key), element("dd", "", value ?? "indisponible"));
  }
  return list;
}

function renderMetrics(citizen) {
  replace("metrics", [
    metricCard("Focus inner / outer", valueText(citizen.attention.innerOuterFocus), "−1 interne · +1 externe"),
    metricCard("Énergie citoyen", valueText(citizen.energy.citizenEnergy, 3), "unités E dans la physique"),
    metricCard("Confiance", percent(citizen.awareness.calibratedConfidence), "estimation calibrée"),
    metricCard("Questions", String(citizen.cognition.openQuestionCount), `${valueText(citizen.cognition.questionBudget)} E de budget`),
    metricCard("Sous-entités", String(citizen.counts.active), `${citizen.counts.highLevel} de niveau haut`),
    metricCard("Fragmentation", percent(citizen.integrity.fragmentationPressure), "métrique shadow", unit(citizen.integrity.fragmentationPressure) >= .7 ? "warning" : "")
  ]);
}

function renderNarrative(citizen) {
  replace("narrative", citizen.text.sections.map(section => {
    const item = element("section", "narrative-section");
    item.append(element("h3", "", section.title), element("p", "", section.text || "Mesure indisponible."));
    return item;
  }));
}

function renderAttentionEnergy(citizen) {
  const focus = finite(citizen.attention.innerOuterFocus);
  const orientation = focus === null ? "indisponible" : Math.abs(focus) < .2 ? "équilibrée" : focus < 0 ? "interne" : "externe";
  replace("attention-energy", [
    meter("Inner ⟷ outer", citizen.attention.innerOuterFocus, { signed: true }),
    keyValues([
      ["Orientation", orientation],
      ["Cible du focus", valueText(citizen.attention.target)],
      ["Demande interne", valueText(citizen.attention.internalDemand)],
      ["Demande externe", valueText(citizen.attention.externalDemand)],
      ["Énergie du graphe", `${valueText(citizen.energy.graphEnergy, 3)} E`],
      ["Liens vivants", valueText(citizen.energy.liveLinks, 0)],
      ["Flux actifs", valueText(citizen.energy.activeFlows, 0)]
    ])
  ]);
}

function renderAffects(citizen) {
  replace("affects", Object.entries(AFFECT_LABELS).map(([key, name]) => meter(name, citizen.affect.vector?.[key])));
}

function renderAwareness(citizen) {
  replace("awareness", Object.entries(AWARENESS_LABELS).map(([key, name]) =>
    meter(name, citizen.awareness?.[key], { signed: key === "expectedValence" })
  ));
}

function renderSubentities(citizen) {
  replace("subentities", citizen.subentities.slice(0, 8).map(item => {
    const card = element("article", "subentity");
    const heading = element("div", "subentity-head");
    const isController = citizen.controllers.some(controller => controller.subentityId === item.id);
    heading.append(element("h3", "", item.name || item.id), element("span", `pill ${isController ? "active" : ""}`, isController ? "contrôle" : label(item.level)));
    card.append(
      heading,
      keyValues([
        ["Poids", valueText(item.weight)],
        ["Stabilité", percent(item.stability)],
        ["Certitude", percent(item.certainty)],
        ["Cohérence", percent(item.coherence)],
        ["Affect dominant", label(item.dominantAffect)]
      ])
    );
    return card;
  }));
}

function renderDirection(citizen) {
  const task = citizen.executive.activeTask;
  const taskCard = element("article", "task-card");
  taskCard.append(
    element("span", "pill active", label(citizen.executive.workspaceMode)),
    element("h3", "", task?.name || "Aucune tâche active"),
    element("p", "", task?.summary || "Le workspace n'exécute pas de tâche explicite.")
  );
  const goals = element("div", "chips");
  for (const goal of citizen.executive.goalIds || []) goals.append(element("span", "chip", goal));
  replace("direction", [
    taskCard,
    keyValues([
      ["État Cortex", label(citizen.executive.cortexState)],
      ["Mode métacognitif", label(citizen.executive.metacognitiveMode)],
      ["Sous-entité active", citizen.agency.activeSubentityName || citizen.agency.activeSubentityId],
      ["Stratégie active", label(citizen.agency.activeStrategy)]
    ]),
    ...(goals.childElementCount ? [goals] : [])
  ]);
}

function renderQuestions(citizen) {
  replace("questions", citizen.cognition.questionAgenda.map((question, index) => {
    const card = element("article", "question");
    const head = element("div", "question-head");
    head.append(element("span", "question-number", String(index + 1)), element("span", "pill", `${valueText(question.energyBudget, 3)} E`));
    card.append(
      head,
      element("h3", "", question.text),
      element("p", "", question.reason),
      keyValues([
        ["Manque", label(question.gapType)],
        ["Priorité", valueText(question.priority, 3)],
        ["Essai", question.loopControl ? `${question.loopControl.attempt}/${question.loopControl.maxAttempts}` : "indisponible"],
        ["Preuve attendue", question.evidenceRequirement || "indisponible"]
      ])
    );
    return card;
  }));
}

function renderLearning(citizen) {
  replace("learning", [
    keyValues([
      ["Dernier Moment", citizen.learning.momentId],
      ["Score de renforcement", valueText(citizen.learning.reinforcementScore)],
      ["Projection", label(citizen.integrity.projectionStatus)],
      ["Couverture contrôleur", percent(citizen.integrity.controllerCoverage)],
      ["Churn des candidates", valueText(citizen.integrity.candidateChurnPerTick)]
    ])
  ]);
}

function renderSources(citizen) {
  replace("sources", Object.entries(citizen.sourceAvailability || {}).map(([name, source]) => {
    const row = element("div", `source ${source.available ? "available" : "missing"}`);
    row.append(element("strong", "", label(name)), element("span", "", source.available ? "disponible" : source.error || "indisponible"));
    return row;
  }));
}

function renderCitizen(citizen) {
  if (!citizen) return;
  state.selectedId = citizen.citizenId;
  byId("citizen-kicker").textContent = `${citizen.graphId || "L1"} · tick ${citizen.tick ?? "—"} · révision ${citizen.revision}`;
  byId("citizen-title").textContent = citizen.text.headline;
  byId("citizen-summary").textContent = citizen.text.summary;
  byId("alerts").replaceChildren(...citizen.text.alerts.map(alert => element("span", `alert ${alert.level}`, alert.text)));
  renderMetrics(citizen);
  renderNarrative(citizen);
  renderAttentionEnergy(citizen);
  renderAffects(citizen);
  renderAwareness(citizen);
  renderSubentities(citizen);
  renderDirection(citizen);
  renderQuestions(citizen);
  renderLearning(citizen);
  renderSources(citizen);
  byId("raw-json").textContent = JSON.stringify(citizen, null, 2);
}

function renderSelector(citizens) {
  const select = byId("citizen-select");
  const current = state.selectedId;
  select.replaceChildren(...citizens.map(citizen => {
    const option = element("option", "", citizen.name || citizen.citizenId);
    option.value = citizen.citizenId;
    return option;
  }));
  const selected = citizens.find(citizen => citizen.citizenId === current) || citizens[0];
  if (selected) {
    select.value = selected.citizenId;
    renderCitizen(selected);
  }
}

async function refresh() {
  const connection = byId("connection");
  try {
    const detail = byId("detail-select").value;
    const response = await fetch(`/api/l1/citizens/status?detail=${encodeURIComponent(detail)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.citizens = payload.citizens || [];
    renderSelector(state.citizens);
    connection.className = "connection current";
    connection.textContent = `${state.citizens.length} citoyen${state.citizens.length > 1 ? "s" : ""} · ${new Date(payload.generatedAt).toLocaleTimeString("fr-FR")}`;
  } catch (error) {
    connection.className = "connection error";
    connection.textContent = `Runtime indisponible · ${error.message}`;
  }
}

byId("citizen-select").addEventListener("change", event => {
  renderCitizen(state.citizens.find(citizen => citizen.citizenId === event.target.value));
});
byId("detail-select").addEventListener("change", refresh);

await refresh();
setInterval(refresh, 5000);
