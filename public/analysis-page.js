import { analyzeGraph } from "./graph-analysis.js";
import { buildAlgorithmExecutions, buildWorkstreams, calculateGraphHealth, enrichRecommendation } from "./graph-health.js";
import { semanticTypeOf } from "./node-semantics.js";
import { serializeRecommendations } from "./recommendation-copy.js";
import { filterExecutions, healthViewHref, normalizeHealthView } from "./health-experience.js";

const categoryLabels = {
  unanswered_question: "Questions non résolues",
  underspecified_solution: "Solutions sous-spécifiées",
  fragile_claim: "Affirmations causales fragiles",
  contradiction: "Contradictions et tensions",
  consolidation: "Consolidations",
  structural_bottleneck: "Goulots structurels",
  feedback_loop: "Boucles de rétroaction",
  evidence_leverage: "Preuves à fort levier",
  causal_gap: "Mécanismes sans effet causal",
  observability_gap: "Périmètres sans observable",
  unmeasured_state: "États sans métrique",
  orphan_metric: "Métriques non rattachées",
  unquantified_causal: "Arêtes causales non chiffrées",
  mistyped_causal: "Prédicats causaux mal employés"
};

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
})[character]);

const tone = score => score >= 80 ? "good" : score >= 60 ? "watch" : score >= 40 ? "weak" : "critical";

const icons = {
  pulse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
  question: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 1 1 3.3 2.4c-.8.3-1 1-1 1.8M12 17h.01"/></svg>',
  tool: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6a4 4 0 0 0-5 5L3 17l4 4 6-6a4 4 0 0 0 5-5l-3 3-4-4 3-3Z"/></svg>',
  document: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6zM9 11h6M9 15h6"/></svg>',
  merge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v4c0 3 2 5 5 5h7M6 21v-4c0-3 2-5 5-5M15 9l3 3-3 3"/></svg>',
  loop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7H8a5 5 0 0 0 0 10h1M15 4l3 3-3 3M9 14l-3 3 3 3"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  graph: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="m7 11 9-4M7 13l9 4"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19zM12 9v5M12 17h.01"/></svg>',
  flask: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8"/></svg>'
  ,copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></svg>',
  decision: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 9-8 9-8-9zM9 12l2 2 4-5"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12h6M10 8H8a4 4 0 0 0 0 8h2M14 8h2a4 4 0 0 1 0 8h-2"/></svg>'
};
const icon = name => `<span class="ui-icon">${icons[name] || icons.graph}</span>`;
const categoryIcons = { fragile_claim: "pulse", unanswered_question: "question", underspecified_solution: "tool", contradiction: "warning", consolidation: "merge", structural_bottleneck: "graph", feedback_loop: "loop", evidence_leverage: "flask", causal_gap: "link", observability_gap: "warning", unmeasured_state: "flask", orphan_metric: "link", unquantified_causal: "pulse", mistyped_causal: "merge" };
const decisionStatusLabels = { proposed: "proposée", in_review: "en revue", approved: "approuvée", rejected: "rejetée", deferred: "différée", superseded: "remplacée" };

let activeHealthView = normalizeHealthView(new URLSearchParams(location.search).get("view"));

function applyHealthView(view, { updateUrl = false } = {}) {
  activeHealthView = normalizeHealthView(view);
  document.querySelector(".health-main").dataset.activeView = activeHealthView;
  for (const section of document.querySelectorAll("[data-health-section]")) {
    section.hidden = section.dataset.healthSection !== activeHealthView;
  }
  for (const link of document.querySelectorAll("[data-health-view-link]")) {
    const active = link.dataset.healthViewLink === activeHealthView;
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  if (updateUrl) history.replaceState(null, "", healthViewHref(location.href, activeHealthView));
}

function setupHealthViews() {
  for (const link of document.querySelectorAll("[data-health-view-link]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      applyHealthView(link.dataset.healthViewLink, { updateUrl: true });
      document.querySelector(".health-view-nav").scrollIntoView({ block: "start" });
    });
  }
  window.addEventListener("popstate", () => applyHealthView(new URLSearchParams(location.search).get("view")));
  applyHealthView(activeHealthView);
}

function renderDecisions(nodes, links) {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const decisions = nodes.filter(node => semanticTypeOf(node) === "decision").sort((a, b) => String(a.decisionDue).localeCompare(String(b.decisionDue)) || a.name.localeCompare(b.name, "fr"));
  const optionsByDecision = new Map(decisions.map(node => [node.id, []]));
  links.filter(link => link.type === "OPTION_FOR").forEach(link => {
    const option = nodeById.get(typeof link.source === "object" ? link.source.id : link.source);
    const target = typeof link.target === "object" ? link.target.id : link.target;
    if (option && optionsByDecision.has(target)) optionsByDecision.get(target).push(option);
  });
  const recommendationByDecision = new Map();
  links.filter(link => link.type === "RECOMMENDS").forEach(link => {
    const source = nodeById.get(typeof link.source === "object" ? link.source.id : link.source);
    const target = typeof link.target === "object" ? link.target.id : link.target;
    if (source) recommendationByDecision.set(target, source);
  });
  const recommendedOptionIds = new Set(links.filter(link => link.type === "IMPLEMENTS" && semanticTypeOf(nodeById.get(typeof link.target === "object" ? link.target.id : link.target)) === "decision_option").map(link => typeof link.target === "object" ? link.target.id : link.target));
  const ready = decisions.filter(item => item.responsibleRole && item.decisionDue && item.optionCriteria?.length && (optionsByDecision.get(item.id)?.length || 0) >= 2).length;
  const approved = decisions.filter(item => item.decisionStatus === "approved").length;
  document.getElementById("decision-summary").innerHTML = `
    <span>${icon("decision")}<strong>${decisions.length}</strong> décisions suivies</span>
    <span>${icon("check")}<strong>${ready}</strong> prêtes pour revue</span>
    <span>${icon("merge")}<strong>${decisions.reduce((sum, item) => sum + (optionsByDecision.get(item.id)?.length || 0), 0)}</strong> options comparables</span>
    <span>${icon("flask")}<strong>${approved}</strong> approuvée${approved > 1 ? "s" : ""}</span>`;
  document.getElementById("decision-board").innerHTML = decisions.map((item, index) => {
    const options = (optionsByDecision.get(item.id) || []).sort((a, b) => String(a.optionCode).localeCompare(String(b.optionCode)));
    const recommendation = recommendationByDecision.get(item.id);
    return `<details class="decision-card status-${escapeHtml(item.decisionStatus || "proposed")}" ${index === 0 ? "open" : ""}>
      <summary>
        <span class="decision-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="decision-heading">${icon("decision")}<span><small>${escapeHtml(decisionStatusLabels[item.decisionStatus] || item.decisionStatus)}</small><strong>${escapeHtml(item.name.replace(/^Décision requise · /, ""))}</strong></span></span>
        <span class="decision-due"><small>Échéance</small><b>${escapeHtml(item.decisionDue || "à fixer")}</b></span>
      </summary>
      <div class="decision-body">
        <p class="decision-question">${escapeHtml(item.phrase)}</p>
        <dl class="decision-governance">
          <div><dt>Responsable</dt><dd>${escapeHtml(item.responsibleRole || "à nommer")}</dd></div>
          <div><dt>Révision</dt><dd>${escapeHtml(item.reviewDate || "à fixer")}</dd></div>
          <div><dt>Option retenue</dt><dd>${escapeHtml(item.chosenOptionId || "aucune · décision non approuvée")}</dd></div>
          <div><dt>Preuve de clôture</dt><dd>${escapeHtml(item.closureEvidence || "à définir")}</dd></div>
        </dl>
        ${recommendation ? `<div class="decision-recommendation">${icon("warning")}<div><small>Recommandation actuelle</small><strong>${escapeHtml(recommendation.name.replace(/^Recommandation · /, ""))}</strong><p>${escapeHtml(recommendation.summary)}</p></div></div>` : ""}
        <section><h3>Critères d’arbitrage</h3><div class="priority-signals">${(item.optionCriteria || []).map(value => `<span>${escapeHtml(value)}</span>`).join("")}</div></section>
        <section><h3>Options explicites</h3><div class="decision-options">${options.map(option => `
          <article class="decision-option ${recommendedOptionIds.has(option.id) ? "recommended" : ""}">
            <div><b>Option ${escapeHtml(option.optionCode)}</b>${recommendedOptionIds.has(option.id) ? "<span>recommandée</span>" : ""}</div>
            <h4>${escapeHtml(option.name.replace(/^Option [A-Z] · /, ""))}</h4>
            <p>${escapeHtml(option.summary)}</p>
            <dl><dt>Bénéfices</dt><dd>${escapeHtml((option.optionBenefits || []).join(" · "))}</dd><dt>Risques</dt><dd>${escapeHtml((option.optionRisks || []).join(" · "))}</dd><dt>Conditions</dt><dd>${escapeHtml((option.optionConditions || []).join(" · "))}</dd></dl>
          </article>`).join("")}</div></section>
        <a class="focus-link" href="/?focus=${encodeURIComponent(item.id)}">Voir la décision dans le graphe →</a>
      </div>
    </details>`;
  }).join("");
}

function renderHealth(health) {
  const score = document.getElementById("health-score");
  score.className = `health-score ${tone(health.score)}`;
  score.style.setProperty("--score", `${health.score * 3.6}deg`);
  score.innerHTML = `<strong>${health.score}</strong><span>${escapeHtml(health.level)} · sur 100</span>`;
  const indicatorById = Object.fromEntries(health.indicators.map(item => [item.id, item]));
  document.getElementById("executive-diagnosis").innerHTML = `<strong>Diagnostic :</strong> le graphe est structurellement propre et connecté, mais sa maturité scientifique reste ${escapeHtml(health.level)} : <b>${indicatorById.quantification.numerator}/${indicatorById.quantification.denominator}</b> causalités sont quantifiées, <b>${indicatorById.causal_context.numerator}/${indicatorById.causal_context.denominator}</b> contextualisées et <b>${indicatorById.questions.numerator}/${indicatorById.questions.denominator}</b> questions possèdent une réponse candidate.`;
  document.getElementById("health-totals").innerHTML = `
    <span><strong>${health.totals.nodes}</strong> nœuds</span>
    <span><strong>${health.totals.links}</strong> relations</span>
    <span><strong>${health.totals.causalLinks}</strong> causalités</span>
    <span><strong>${health.totals.questions}</strong> questions</span>
    <span><strong>${health.totals.solutions}</strong> solutions</span>`;
  document.getElementById("score-drivers").innerHTML = health.drivers.slice(0, 4).map((item, index) => `
    <article><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.action)}</p></div><b>−${item.lostPoints.toFixed(1)} pts</b></article>`).join("");
  document.getElementById("health-indicators").innerHTML = health.indicators.map(item => `
    <article class="indicator-card ${tone(item.score)}">
      <div class="indicator-top"><span>${Math.round(item.weight * 100)} % du score</span><strong>${item.score}<small>/100</small></strong></div>
      <h3>${icon(item.id === "questions" ? "question" : item.id === "provenance" ? "document" : item.id.includes("causal") || item.id === "quantification" ? "pulse" : item.id === "specification" ? "tool" : "graph")}${escapeHtml(item.label)}</h3>
      <div class="indicator-bar"><i style="width:${item.score}%"></i></div>
      <p class="indicator-fraction"><strong>${item.numerator}</strong> ${escapeHtml(item.numeratorLabel)} sur <strong>${item.denominator}</strong> ${escapeHtml(item.denominatorLabel)}</p>
      <p>${escapeHtml(item.explanation)}</p>
      <dl>
        <dt>Pourquoi c’est important</dt><dd>${escapeHtml(item.whyItMatters)}</dd>
        <dt>Limite de lecture</dt><dd>${escapeHtml(item.limitation)}</dd>
        <dt>Prochaine action</dt><dd>${escapeHtml(item.action)}</dd>
      </dl>
    </article>`).join("");
}

// Chaîne d'ancrage mécanisme → état → métrique. Chaque jauge affiche son numérateur et son
// dénominateur : un ratio sans son décompte ne permet pas de savoir ce qu'il reste à faire.
function renderCausalCompleteness(report) {
  const coverage = report.observability;
  const saturation = report.causalSaturation;
  const gauges = [
    {
      id: "saturation",
      icon: "link",
      label: "Saturation causale",
      numerator: saturation.satisfied,
      denominator: saturation.mechanisms,
      unit: "mécanismes affirment un effet",
      definition: saturation.definition,
      reading: "Un mécanisme non compté n’est pas faux : il n’a simplement pas encore dit ce qu’il déplace."
    },
    {
      id: "states",
      icon: "flask",
      label: "États instrumentés",
      numerator: coverage.measuredStates,
      denominator: coverage.states,
      unit: "états reliés à une métrique",
      definition: "Part des system_state possédant au moins une relation MEASURED_BY vers une metric.",
      reading: "Sans métrique reliée, un CAUSES entrant n’a aucune unité dans laquelle écrire son effectSizePct."
    },
    {
      id: "metrics",
      icon: "pulse",
      label: "Métriques rattachées",
      numerator: coverage.anchoredMetrics,
      denominator: coverage.metrics,
      unit: "métriques adossées à un état",
      definition: "Part des metric visées par au moins une relation MEASURED_BY.",
      reading: "Une métrique orpheline mesure une expérience isolée : aucun état du modèle ne bouge quand elle bouge."
    }
  ];
  const percent = item => item.denominator ? Math.round(item.numerator / item.denominator * 100) : 0;
  document.getElementById("causal-completeness").innerHTML = gauges.map(item => {
    const value = percent(item);
    return `<article class="completeness-card ${tone(value)}">
      <div class="completeness-top">${icon(item.icon)}<span>${escapeHtml(item.label)}</span></div>
      <p class="completeness-value"><strong>${item.numerator}</strong><small>/${item.denominator}</small></p>
      <div class="indicator-bar"><i style="width:${value}%"></i></div>
      <p class="completeness-unit">${value} % · ${escapeHtml(item.unit)}</p>
      <dl>
        <dt>Définition</dt><dd>${escapeHtml(item.definition)}</dd>
        <dt>Limite de lecture</dt><dd>${escapeHtml(item.reading)}</dd>
      </dl>
    </article>`;
  }).join("");

  const blind = coverage.blindClusters || [];
  document.getElementById("observability-blind").innerHTML = blind.length
    ? `<div class="observability-alert">${icon("warning")}<div>
        <strong>${blind.length} périmètre${blind.length > 1 ? "s" : ""} sans aucun observable</strong>
        <p>${blind.map(escapeHtml).join(" · ")}</p>
        <p class="observability-note">Les mécanismes de ces périmètres ne peuvent affirmer aucun effet chiffré : il n’existe ni état ni métrique à déplacer. Créer l’observable précède logiquement toute campagne de chiffrage.</p>
        <p class="observability-note"><code>npm run work:propose</code> transforme ces lacunes en tâches candidates, laissées en revue.</p>
      </div></div>`
    : `<div class="observability-alert ok">${icon("check")}<div><strong>Chaque périmètre décrivant des mécanismes expose au moins un observable.</strong><p class="observability-note">Le contrat causal y est satisfiable ; le déficit restant relève de la saisie, pas de la structure.</p></div></div>`;

  const rows = coverage.byCluster || [];
  document.getElementById("observability-table").innerHTML = `
    <table>
      <caption>Observables disponibles par périmètre. Un périmètre sans état ni métrique rend la saturation causale nulle par construction.</caption>
      <thead><tr><th scope="col">Périmètre</th><th scope="col">Mécanismes</th><th scope="col">États</th><th scope="col">dont mesurés</th><th scope="col">Métriques</th><th scope="col">dont rattachées</th></tr></thead>
      <tbody>${rows.map(row => `<tr class="${row.observables === 0 && row.mechanisms > 0 ? "blind" : ""}">
        <th scope="row">${escapeHtml(row.cluster)}</th>
        <td>${row.mechanisms}</td>
        <td>${row.states}</td>
        <td>${row.measuredStates}</td>
        <td>${row.metrics}</td>
        <td>${row.anchoredMetrics}</td>
      </tr>`).join("")}</tbody>
    </table>`;
}

const HEALTH_HISTORY_KEY = "mind-graph-health-history";

function recordHealthHistory(health) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HEALTH_HISTORY_KEY)) || []; } catch { history = []; }
  if (!Array.isArray(history)) history = [];
  const today = new Date().toISOString().slice(0, 10);
  const entry = { date: today, score: health.score };
  const existing = history.findIndex(item => item.date === today);
  if (existing >= 0) history[existing] = entry; else history.push(entry);
  history = history.slice(-30);
  try { localStorage.setItem(HEALTH_HISTORY_KEY, JSON.stringify(history)); } catch { /* stockage indisponible */ }
  return history;
}

function renderTrend(history) {
  const section = document.getElementById("health-trend");
  const chart = document.getElementById("health-trend-chart");
  if (!section || !chart) return;
  section.hidden = false;
  if (history.length < 2) {
    chart.innerHTML = `<p class="health-trend-empty">Première mesure enregistrée (${history[0]?.score ?? "—"}/100). Revenez après une prochaine analyse pour voir la tendance.</p>`;
    return;
  }
  const width = 320;
  const height = 64;
  const pad = 6;
  const scores = history.map(entry => entry.score);
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const span = max - min || 1;
  const x = index => pad + index * (width - 2 * pad) / (history.length - 1);
  const y = score => height - pad - (score - min) / span * (height - 2 * pad);
  const points = history.map((entry, index) => `${x(index).toFixed(1)},${y(entry.score).toFixed(1)}`).join(" ");
  const last = history[history.length - 1].score;
  const previous = history[history.length - 2].score;
  const delta = last - previous;
  const deltaLabel = delta === 0 ? "stable" : `${delta > 0 ? "+" : ""}${delta} pt${Math.abs(delta) > 1 ? "s" : ""}`;
  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="Historique du score de santé">
      <polyline points="${points}" fill="none" stroke="var(--focus)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      ${history.map((entry, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(entry.score).toFixed(1)}" r="2.2" fill="var(--focus)" />`).join("")}
    </svg>
    <div class="trend-meta"><strong>${last}/100</strong><span>${escapeHtml(deltaLabel)} vs mesure précédente · ${history.length} points</span></div>`;
}

function buildReportMarkdown(health, report, workstreams) {
  const lines = [];
  lines.push("# Rapport de santé — Mind Causal Graph");
  lines.push("");
  lines.push(`Généré le ${new Date().toLocaleString("fr-FR")} · méthode ${report.methodVersion}`);
  lines.push("");
  lines.push(`## Score global : ${health.score}/100 (${health.level})`);
  lines.push("");
  lines.push(`- ${health.totals.nodes} nœuds · ${health.totals.links} relations`);
  lines.push(`- ${health.totals.causalLinks} causalités · ${health.totals.questions} questions · ${health.totals.solutions} solutions`);
  lines.push("");
  lines.push("## Indicateurs");
  lines.push("");
  lines.push("| Indicateur | Score | Détail | Poids |");
  lines.push("|---|---:|---|---:|");
  for (const item of health.indicators) {
    lines.push(`| ${item.label} | ${item.score}/100 | ${item.numerator}/${item.denominator} ${item.numeratorLabel} | ${Math.round(item.weight * 100)} % |`);
  }
  lines.push("");
  lines.push("## Facteurs de fragilité");
  lines.push("");
  for (const driver of health.drivers.slice(0, 4)) lines.push(`- **${driver.label}** (−${driver.lostPoints.toFixed(1)} pts) : ${driver.action}`);
  lines.push("");
  lines.push("## Chantiers prioritaires");
  lines.push("");
  for (const stream of workstreams) lines.push(`- **${stream.title}** — ${stream.count} ${stream.unit} · _${stream.urgency}_ : ${stream.action}`);
  lines.push("");
  lines.push(`## Recommandations (${report.findings.length})`);
  lines.push("");
  report.findings.forEach((finding, index) => {
    lines.push(`${index + 1}. **${finding.title}** (priorité ${finding.priority}, ${finding.categoryLabel}) — ${finding.summary}`);
  });
  lines.push("");
  lines.push(`> ${report.disclaimer}`);
  lines.push("");
  return lines.join("\n");
}

function setupReportExport(health, report, workstreams) {
  const button = document.getElementById("export-report");
  if (!button) return;
  button.addEventListener("click", () => {
    const blob = new Blob([buildReportMarkdown(health, report, workstreams)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `mind-health-${new Date().toISOString().slice(0, 10)}.md`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  });
}

function renderWorkstreams(workstreams) {
  document.getElementById("workstreams").innerHTML = workstreams.map(item => `
    <article class="workstream-card urgency-${item.urgency}">
      <div class="workstream-top">${icon(item.icon)}<span>${escapeHtml(item.urgency)}</span></div>
      <strong class="workstream-count">${item.count}</strong><small>${escapeHtml(item.unit)}</small>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.problem)}</p>
      <div><b>Action directrice</b><p>${escapeHtml(item.action)}</p></div>
    </article>`).join("");
}

function recommendationCard(item, index) {
  const metrics = item.metrics?.length ? `<dl class="recommendation-metrics">${item.metrics.map(metric => `<div><dt>${escapeHtml(metric.label)}</dt><dd>${escapeHtml(metric.value)}</dd></div>`).join("")}</dl>` : "";
  const contextMeta = [item.clusters.length ? `Cluster · ${item.clusters.join(", ")}` : null, item.documents.length ? `Sources · ${item.documents.join(", ")}` : null, `${item.relatedEdgeCount} relations concernées`].filter(Boolean);
  return `<details class="recommendation-card severity-${escapeHtml(item.severity)}" ${index < 3 ? "open" : ""}>
    <summary><span class="recommendation-rank">${index + 1}</span><span class="priority-score">${item.priority}</span><span class="recommendation-title">${icon(categoryIcons[item.category])}<span><small>${escapeHtml(item.categoryLabel)}</small><strong>${escapeHtml(item.title)}</strong></span></span></summary>
    <div class="recommendation-body">
      <section class="problem-panel"><h3>Problème formulé clairement</h3><p>${escapeHtml(item.problem)}</p></section>
      <section><h3>Signaux qui expliquent la priorité</h3><div class="priority-signals">${item.prioritySignals.map(signal => `<span>${escapeHtml(signal)}</span>`).join("")}</div></section>
      <section><h3>Constat algorithmique</h3><p>${escapeHtml(item.summary)}</p><p>${escapeHtml(item.diagnosis)}</p>${metrics}</section>
      <section class="reason-panel"><h3>Pourquoi cette recommandation existe</h3><p>${escapeHtml(item.why)}</p><p><strong>Risque si rien ne change :</strong> ${escapeHtml(item.risk)}</p></section>
      <section><h3>Contexte observé</h3><p>${escapeHtml(item.context)}</p><div class="context-meta">${contextMeta.map(value => `<span>${escapeHtml(value)}</span>`).join("")}</div></section>
      <section class="recommendation-columns">
        <div><h3>Causes possibles à vérifier</h3><ul>${item.probableCauses.map(cause => `<li>${escapeHtml(cause)}</li>`).join("")}</ul></div>
        <div><h3>Plan d’action proposé</h3><ol>${item.steps.map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol></div>
      </section>
      <section class="repair-preview"><h3>Modification proposée du graphe</h3><code>${escapeHtml(item.graphPatch)}</code></section>
      <section><h3>Critères de clôture</h3><ul class="closure-list">${item.closureCriteria.map(criterion => `<li>${icon("check")}${escapeHtml(criterion)}</li>`).join("")}</ul></section>
      <section><h3>Questions de revue</h3><ul>${item.reviewQuestions.map(question => `<li>${escapeHtml(question)}</li>`).join("")}</ul></section>
      ${item.nodeId ? `<a class="focus-link" href="/?focus=${encodeURIComponent(item.nodeId)}">Voir le nœud dans le graphe →</a>` : ""}
    </div>
  </details>`;
}

async function writeToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copie non prise en charge");
}

function setupRecommendations(report, nodes, links) {
  const recommendations = report.findings.map(item => enrichRecommendation(item, nodes, links));
  const filter = document.getElementById("category-filter");
  const copyButton = document.getElementById("copy-all-recommendations");
  const copyStatus = document.getElementById("recommendation-copy-status");
  copyButton.innerHTML = `${icon("copy")}Copier toutes les recommandations`;
  Object.entries(report.categoryCounts).forEach(([category, count]) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = `${categoryLabels[category] || category} (${count})`;
    filter.append(option);
  });
  document.getElementById("finding-summary").innerHTML = Object.entries(report.categoryCounts)
    .map(([category, count]) => `<span><strong>${count}</strong>${escapeHtml(categoryLabels[category] || category)}</span>`).join("");
  const render = () => {
    const visible = filter.value === "all" ? recommendations : recommendations.filter(item => item.category === filter.value);
    document.getElementById("recommendation-count").textContent = `${visible.length} recommandation${visible.length > 1 ? "s" : ""}`;
    document.getElementById("recommendations").innerHTML = visible.map(recommendationCard).join("");
  };
  filter.addEventListener("change", render);
  copyButton.addEventListener("click", async () => {
    const text = serializeRecommendations(recommendations, {
      methodVersion: report.methodVersion,
      nodeCount: nodes.length,
      linkCount: links.length
    });
    try {
      await writeToClipboard(text);
      copyStatus.textContent = `${recommendations.length} recommandations copiées · prêtes à coller dans Codex.`;
      copyButton.classList.add("copied");
      copyButton.innerHTML = `${icon("check")}Copié`;
      setTimeout(() => {
        copyButton.classList.remove("copied");
        copyButton.innerHTML = `${icon("copy")}Copier toutes les recommandations`;
      }, 1800);
    } catch (error) {
      copyStatus.textContent = `Copie impossible : ${error.message}`;
    }
  });
  render();
}

function renderExecutions(executions, report, graph, durationMs) {
  const traversals = executions.filter(item => item.kind === "traversal");
  const repairs = executions.filter(item => item.kind === "repair");
  const primaryTargets = new Set(report.findings.map(item => item.nodeId).filter(Boolean));
  const runId = `analyse-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  document.getElementById("run-metadata").innerHTML = `
    <span>${icon("pulse")}<small>Exécution</small><strong>${escapeHtml(runId)}</strong></span>
    <span>${icon("graph")}<small>Instantané</small><strong>${graph.nodes.length} nœuds · ${graph.links.length} liens</strong></span>
    <span>${icon("flask")}<small>Méthode</small><strong>${escapeHtml(report.methodVersion)}</strong></span>
    <span>${icon("check")}<small>Calcul local</small><strong>${Math.round(durationMs)} ms · ${new Date().toLocaleString("fr-FR")}</strong></span>`;
  document.getElementById("execution-summary").innerHTML = `
    <span><strong>${traversals.length}</strong> traversées terminées</span>
    <span><strong>${repairs.length}</strong> réparations simulées</span>
    <span><strong>${report.findings.length}</strong> diagnostics bruts</span>
    <span><strong>${primaryTargets.size}</strong> cibles principales distinctes</span>
    <span><strong>${executions.reduce((sum, item) => sum + item.mutations, 0)}</strong> mutations appliquées</span>`;
  const list = document.getElementById("algorithm-executions");
  const search = document.getElementById("execution-search");
  const kindFilter = document.getElementById("execution-kind-filter");
  const count = document.getElementById("execution-count");
  const renderList = () => {
    const visible = filterExecutions(executions, { kind: kindFilter.value, query: search.value });
    count.textContent = `${visible.length} entrée${visible.length > 1 ? "s" : ""} affichée${visible.length > 1 ? "s" : ""}`;
    list.innerHTML = visible.map(item => `
    <details class="execution-card ${item.kind}">
      <summary>
        <span class="execution-kind">${icon(item.kind === "traversal" ? "graph" : "tool")}${item.kind === "traversal" ? "traversée" : "réparation · simulation"}</span>
        <strong>${escapeHtml(item.label)}</strong>
        <span class="execution-output">${item.outputs} sortie${item.outputs > 1 ? "s" : ""}</span>
        <b class="execution-status">${item.status === "completed" ? "terminée" : "dry-run"}</b>
      </summary>
      <div class="execution-body">
        <p>${escapeHtml(item.description)}</p>
        <dl><dt>Périmètre inspecté</dt><dd>${escapeHtml(item.inspected)}</dd><dt>Mutations</dt><dd>${item.mutations}</dd><dt>Limite</dt><dd>${escapeHtml(item.limitation)}</dd></dl>
        ${item.contract ? `<div class="execution-contract"><span>Contrat ontologique</span><pre>${escapeHtml(JSON.stringify(item.contract, null, 2))}</pre></div>` : ""}
      </div>
    </details>`).join("");
    if (!visible.length) list.innerHTML = `<p class="execution-empty">Aucune exécution ne correspond à ces filtres.</p>`;
  };
  search.addEventListener("input", renderList);
  kindFilter.addEventListener("change", renderList);
  renderList();
}

async function fetchOntology() {
  for (const url of ["/api/ontology", "/graph-ontology.json"]) {
    const response = await fetch(url);
    if (response.ok) return response.json();
  }
  throw new Error("ontologie indisponible");
}

async function load() {
  try {
    const startedAt = performance.now();
    const [response, ontology] = await Promise.all([fetch("/api/graph"), fetchOntology()]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const graph = await response.json();
    const health = calculateGraphHealth(graph.nodes, graph.links);
    const report = analyzeGraph(graph.nodes, graph.links);
    const durationMs = performance.now() - startedAt;
    const workstreams = buildWorkstreams(report, health);
    document.getElementById("schema-version").textContent = `AUDIT ALGORITHMIQUE · SCHÉMA ${ontology.schemaVersion}`;
    renderHealth(health);
    renderCausalCompleteness(report);
    renderTrend(recordHealthHistory(health));
    setupReportExport(health, report, workstreams);
    renderWorkstreams(workstreams);
    renderExecutions(buildAlgorithmExecutions(report, health, ontology, graph.nodes, graph.links), report, graph, durationMs);
    setupRecommendations(report, graph.nodes, graph.links);
    document.getElementById("analysis-version").textContent = `méthode ${report.methodVersion}`;
    document.getElementById("analysis-disclaimer").textContent = report.disclaimer;
    applyHealthView(activeHealthView);
  } catch (error) {
    document.getElementById("analysis-error").textContent = `Impossible de calculer la santé du graphe : ${error.message}`;
  }
}

setupHealthViews();
load();
