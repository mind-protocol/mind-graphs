import { analyzeGraph } from "./graph-analysis.js";
import { buildGraphQueryEngine } from "./graph-query.js";
import { wrapCanvasText } from "./canvas-text.js";
import { serializeClusterContent, serializeNodeContent } from "./copy-content.js";
import { transformClusterToPresentation } from "./cluster-presentation.js";
import { buildClusterRepresentatives, buildHierarchyChildren, buildOverviewNodeIds, clusterSize, navigationNodeIds } from "./graph-navigation.js";
import { linkVisualStyle, linkTerminator } from "./link-visuals.js";
import { iconForNode, iconForRelation } from "./iconography.js";
import { installTermReferences } from "./term-references.js";

const canvas = document.getElementById("graph");
const wrap = document.getElementById("graph-wrap");
const context = canvas.getContext("2d");
const searchInput = document.getElementById("search");
const empty = document.getElementById("empty");
const termHoverCard = document.getElementById("term-hover-card");
const relationInputs = [...document.querySelectorAll("[data-link-type]")];
const nodeTypeInputs = [...document.querySelectorAll("[data-node-type]")];

function decorateTypeControls() {
  for (const input of nodeTypeInputs) {
    const icon = document.createElement("span");
    icon.className = "type-icon node-type-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = iconForNode(input.dataset.nodeType);
    input.after(icon);
  }
  for (const input of relationInputs) {
    const icon = document.createElement("span");
    icon.className = "type-icon relation-type-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = iconForRelation(input.dataset.linkType);
    input.after(icon);
  }
}

decorateTypeControls();

const palette = {
  GROUNDS: "#9277d0",
  UNLOCKS: "#68d4dc",
  SAFEGUARDS: "#9ad17b",
  IMPLEMENTS: "#d7a56d",
  LEADS_TO: "#d77998",
  CONVERGES_IN: "#f6c453",
  MAKES_PLAUSIBLE: "#aab7c4",
  SCENARIO_LEADS_TO: "#f0c674",
  PRESSURES: "#e07a6a",
  MITIGATES: "#7fc8a9",
  AFFECTS_SCENARIO: "#f0c674",
  MOTIVATES: "#d58cff",
  CAUSES: "#ffb347",
  FEEDS: "#68d4dc",
  ASSUMES: "#aab7c4",
  TESTS: "#75a7d8",
  ADDRESSES: "#9ad17b",
  COMMUNICATES: "#d77998",
  DERIVED_FROM: "#8f9aa6"
  , AUTHORED_BY: "#b9a7ff"
  , PART_OF: "#c3a8ff"
  , SUBCASE_OF: "#c3a8ff"
  , SUPPORTS_ESTIMATE: "#72d6a0"
  , CONTRADICTS: "#ff6f6f"
  , BLOCKS: "#e07a6a"
  , OBSERVES: "#7dd3fc"
  , PRODUCES: "#6ee7b7"
  , USES_METHOD: "#93c5fd"
  , MEASURES: "#67e8f9"
  , USES_DATASET: "#a7f3d0"
  , APPLIES_IN: "#f5d08a"
  , PROMOTES_TO: "#d58cff"
  , TARGETS: "#75a7d8"
  , DEPENDS_ON: "#f0c674"
  , DOCUMENTS_PROGRESS: "#72d6a0"
};

const familyPalette = {
  protocol: { fill: "#562f18", stroke: "#ffb347", label: "Mind Protocol" },
  axiom: { fill: "#3d2d62", stroke: "#c3a8ff", label: "axiomes" },
  unlock: { fill: "#163f49", stroke: "#68d4dc", label: "innovations débloquantes" },
  mechanism: { fill: "#243d57", stroke: "#75a7d8", label: "mécanismes" },
  institution: { fill: "#59303f", stroke: "#d77998", label: "institutions" },
  horizon: { fill: "#36451f", stroke: "#c5db71", label: "horizons" },
  forecast_event: { fill: "#493827", stroke: "#f0c674", label: "événements prévus" },
  design_rationale: { fill: "#482b55", stroke: "#d58cff", label: "raisons de design" },
  economic_mechanism: { fill: "#183f47", stroke: "#68d4dc", label: "systèmes économiques Mind" },
  design_effect: { fill: "#4d421d", stroke: "#f6c453", label: "effets recherchés" },
  working_hypothesis: { fill: "#3b3d43", stroke: "#aab7c4", label: "hypothèses de travail" },
  open_question: { fill: "#553029", stroke: "#e07a6a", label: "questions ouvertes" },
  source_document: { fill: "#27313a", stroke: "#c7d0d9", label: "documents sources" },
  actor: { fill: "#302b4f", stroke: "#b9a7ff", label: "acteurs / auteurs" },
  claim: { fill: "#37323f", stroke: "#c4b5fd", label: "affirmations" },
  observation: { fill: "#183d46", stroke: "#7dd3fc", label: "observations" },
  experiment: { fill: "#24402f", stroke: "#6ee7b7", label: "expériences" },
  dataset: { fill: "#263b35", stroke: "#a7f3d0", label: "jeux de données" },
  metric: { fill: "#183a42", stroke: "#67e8f9", label: "métriques" },
  estimate: { fill: "#3f3623", stroke: "#f5d08a", label: "estimations" },
  method: { fill: "#26364b", stroke: "#93c5fd", label: "méthodes" },
  context: { fill: "#403721", stroke: "#e8c878", label: "contextes" },
  terme: { fill: "#422f49", stroke: "#e9a8ff", label: "termes" },
  idea: { fill: "#482b55", stroke: "#d58cff", label: "idées de travail" },
  task: { fill: "#243d57", stroke: "#75a7d8", label: "tâches" },
  change: { fill: "#24402f", stroke: "#72d6a0", label: "changements livrés" },
  decision: { fill: "#4a3524", stroke: "#f0c674", label: "décisions gouvernées" },
  decision_option: { fill: "#303248", stroke: "#aeb7ff", label: "options de décision" },
  state_desirable: { fill: "#284638", stroke: "#7fc8a9", label: "états désirables" },
  state_indesirable: { fill: "#553029", stroke: "#e07a6a", label: "états indésirables" },
  state_mixte: { fill: "#4d421d", stroke: "#f0c674", label: "états mixtes" }
};

const narrativeRelationTypes = new Set(["GROUNDS", "UNLOCKS", "SAFEGUARDS", "IMPLEMENTS", "LEADS_TO", "CONVERGES_IN", "MAKES_PLAUSIBLE", "SCENARIO_LEADS_TO", "PRESSURES", "MITIGATES", "MOTIVATES", "CAUSES", "FEEDS", "ASSUMES", "TESTS", "ADDRESSES", "COMMUNICATES", "DERIVED_FROM", "AUTHORED_BY", "PART_OF", "SUBCASE_OF", "SUPPORTS_ESTIMATE", "CONTRADICTS", "BLOCKS", "OBSERVES", "PRODUCES", "USES_METHOD", "MEASURES", "USES_DATASET", "APPLIES_IN", "PROMOTES_TO", "TARGETS", "DEPENDS_ON", "DOCUMENTS_PROGRESS"]);
const relativeInfluenceTypes = new Set(["AFFECTS_SCENARIO"]);

let allNodes = [];
let allLinks = [];
let healthByTarget = new Map();
let nodes = [];
let links = [];
let selected = null;
let hovered = null;
let transform = d3.zoomIdentity;
let pixelRatio = window.devicePixelRatio || 1;
let analysisReport = null;
let graphQueryEngine = null;
let graphQueryResult = null;
let copyMenuNode = null;
let clusterRepresentatives = new Map();
let hierarchyChildren = new Map();
let overviewNodeIds = new Set();
let expandedHierarchyIds = new Set();
let navigationScope = { type: "overview", clusterId: null };
let lastClickedNode = null;
const motionEnabled = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let lastAnimationFrame = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

const CONFIDENCE_ANCHORS = [
  { max: 0.2, label: "très faible" }, { max: 0.4, label: "faible" },
  { max: 0.6, label: "moyenne" }, { max: 0.8, label: "élevée" }, { max: 1.01, label: "très élevée" }
];
function confidenceAnchor(value) {
  return (CONFIDENCE_ANCHORS.find(anchor => value <= anchor.max) || CONFIDENCE_ANCHORS.at(-1)).label;
}

// Rend un float sous forme de jauge visuelle plutôt qu'un nombre brut.
// kind: "unit" (0–1), "percent" (0–100), "effect" (signé, divergent autour de 0), "confidence" (0–1 + palier).
function meterBar(value, kind = "unit", { cap = 100 } = {}) {
  const v = Number(value);
  if (!Number.isFinite(v)) return escapeHtml(String(value ?? "—"));
  if (kind === "effect") {
    const magnitude = Math.min(Math.abs(v), cap) / cap * 50;
    const sign = v > 0 ? "pos" : v < 0 ? "neg" : "zero";
    const label = `${v > 0 ? "+" : ""}${v.toFixed(1)} %`;
    return `<span class="meter meter-diverging ${sign}" title="Taille d’effet ${label}">
      <span class="meter-track"><span class="meter-fill" style="width:${magnitude.toFixed(1)}%"></span></span>
      <span class="meter-value">${label}</span></span>`;
  }
  const max = kind === "percent" ? 100 : 1;
  const ratio = Math.max(0, Math.min(1, v / max));
  const band = ratio <= 0.2 ? 1 : ratio <= 0.4 ? 2 : ratio <= 0.6 ? 3 : ratio <= 0.8 ? 4 : 5;
  const label = kind === "percent" ? `${v.toFixed(1)} %`
    : kind === "confidence" ? `${v.toFixed(2)} · ${confidenceAnchor(v)}`
    : v.toFixed(2);
  const bandClass = kind === "confidence" ? ` band-${band}` : "";
  return `<span class="meter${bandClass}" title="${escapeHtml(label)}">
    <span class="meter-track"><span class="meter-fill" style="width:${(ratio * 100).toFixed(1)}%"></span></span>
    <span class="meter-value">${label}</span></span>`;
}

const EVIDENCE_BASIS_LABELS = { assertion: "assertion", real_world: "preuve réelle", simulation: "simulation" };
function evidenceBasisBadge(basis) {
  if (!basis) return "";
  const label = EVIDENCE_BASIS_LABELS[basis] || basis;
  return `<span class="evidence-basis basis-${escapeHtml(basis)}">${escapeHtml(label)}</span>`;
}

function renderAnalysisReport() {
  if (!analysisReport) return;
  const summary = document.getElementById("analysis-summary");
  const cards = document.getElementById("analysis-cards");
  const categoryLabels = {
    unanswered_question: "questions",
    underspecified_solution: "solutions",
    fragile_claim: "causalités",
    contradiction: "contradictions",
    consolidation: "consolidations",
    structural_bottleneck: "goulots",
    feedback_loop: "boucles",
    evidence_leverage: "preuves prioritaires"
  };
  document.getElementById("analysis-disclaimer").textContent = analysisReport.disclaimer;
  summary.innerHTML = Object.entries(analysisReport.categoryCounts)
    .map(([category, count]) => `<span><strong>${count}</strong> ${categoryLabels[category] || category}</span>`)
    .join("");
  cards.innerHTML = analysisReport.findings.map((item, index) => `
    <details class="analysis-card severity-${item.severity}" ${index < 3 ? "open" : ""}>
      <summary>
        <span class="analysis-rank">${index + 1}</span>
        <span class="analysis-score">${item.priority}</span>
        <span class="analysis-card-heading"><small>${escapeHtml(item.categoryLabel)}</small><strong>${escapeHtml(item.title)}</strong></span>
      </summary>
      <div class="analysis-card-body">
        <p>${escapeHtml(item.summary)}</p>
        <p class="analysis-diagnosis">${escapeHtml(item.diagnosis)}</p>
        ${item.metrics?.length ? `<dl>${item.metrics.map(metric => `<dt>${escapeHtml(metric.label)}</dt><dd>${escapeHtml(metric.value)}</dd>`).join("")}</dl>` : ""}
        ${item.path?.length ? `<p class="analysis-path"><strong>Chemin :</strong> ${item.path.map(escapeHtml).join(" → ")}</p>` : ""}
        <p class="analysis-action"><strong>Action :</strong> ${escapeHtml(item.action)}</p>
        ${item.nodeId ? `<button type="button" data-focus-node="${escapeHtml(item.nodeId)}">Voir dans le graphe</button>` : ""}
      </div>
    </details>`).join("");
}

function renderGraphQuery(result) {
  const status = document.getElementById("graph-query-status");
  const results = document.getElementById("graph-query-results");
  const clear = document.getElementById("graph-query-clear");
  if (!result) {
    status.textContent = graphQueryEngine ? `Index local prêt · ${graphQueryEngine.metadata.documents} nœuds actifs · ${graphQueryEngine.metadata.dimensions} dimensions` : "Index local en préparation…";
    results.innerHTML = "";
    clear.hidden = true;
    updateCopyActions();
    return;
  }
  clear.hidden = false;
  status.textContent = result.results.length
    ? `${result.mode === "named" ? "Cluster documentaire" : "Cluster connecté"} · ${result.nodes.length} nœuds · ${result.links.length} relations`
    : "Aucun cluster suffisamment pertinent pour cette question.";
  results.innerHTML = result.results.slice(0, 8).map(item => `
    <article class="graph-query-result">
      <strong>${escapeHtml(item.name)}</strong>
      <button type="button" data-query-focus="${escapeHtml(item.nodeId)}">Voir</button>
      <small>${result.mode === "named"
        ? `${escapeHtml(item.documentSection || item.nodeTypeLabel)}${item.sourcePage ? ` · p. ${escapeHtml(item.sourcePage)}` : ""}`
        : `${escapeHtml(item.nodeTypeLabel)} · pertinence ${(item.score * 100).toFixed(1)}% · sémantique ${(item.semanticScore * 100).toFixed(1)}% · graphe ${(item.graphScore * 100).toFixed(1)}%`}</small>
      <p class="graph-query-path">${item.path.map(escapeHtml).join(" → ")}</p>
    </article>`).join("");
  updateCopyActions();
}

const simulation = d3.forceSimulation()
  .force("link", d3.forceLink().id(d => d.id).distance(210).strength(.34))
  .force("charge", d3.forceManyBody().strength(-680))
  .force("horizontal", d3.forceX().strength(.045))
  .force("chronology", d3.forceY().strength(.42))
  .force("collide", d3.forceCollide().radius(d => d.radius + 18).iterations(2))
  .alphaDecay(.035)
  .on("tick", draw);

const zoom = d3.zoom()
  .scaleExtent([0.12, 5])
  .on("zoom", event => { transform = event.transform; draw(); });

d3.select(canvas).call(zoom).on("dblclick.zoom", null);

function nodeSize(node) {
  node.typeLabel = node.nodeTypeLabel || familyPalette[colorGroup(node)]?.label || node.nodeType;
  node.typeIcon = iconForNode(node);
  context.font = "600 9px Inter, system-ui, sans-serif";
  const typeWidth = context.measureText(node.typeLabel.toLocaleUpperCase("fr")).width + 34;
  context.font = node.nodeType === "terme" ? "700 14px Inter, system-ui, sans-serif" : "500 14px Inter, system-ui, sans-serif";
  const titleWidth = context.measureText(node.name).width;
  context.font = "400 18px 'Segoe UI Historic', 'Noto Sans', sans-serif";
  const phraseWidth = context.measureText(node.phrase).width;
  node.width = Math.min(360, Math.max(220, Math.max(typeWidth, titleWidth, phraseWidth) + 32));
  const textWidth = node.width - 32;
  context.font = node.nodeType === "terme" ? "700 14px Inter, system-ui, sans-serif" : "500 14px Inter, system-ui, sans-serif";
  node.titleLines = wrapCanvasText(context, node.name, textWidth);
  context.font = "400 18px 'Segoe UI Historic', 'Noto Sans', sans-serif";
  node.phraseLines = wrapCanvasText(context, node.phrase, textWidth);
  node.height = Math.max(112, 15 + 12 + 8 + node.titleLines.length * 17 + 7 + node.phraseLines.length * 21 + 9 + 13 + 14);
  node.radius = Math.hypot(node.width, node.height) / 2;
  node.colorGroup = colorGroup(node);
}

function colorGroup(node) {
  if (node.nodeType === "protocol") return "protocol";
  if (node.nodeType === "forecast_event") return "forecast_event";
  if (node.nodeType === "system_state") {
    return node.stateOrientation === "undesirable" ? "state_indesirable"
      : node.stateOrientation === "mixed" ? "state_mixte" : "state_desirable";
  }
  if (familyPalette[node.nodeType]) return node.nodeType;
  return "protocol";
}

function formatYear(year) {
  if (year < 0) return `${Math.abs(year)} av. J.-C.`;
  return `${year} apr. J.-C.`;
}

function nodeDate(node) {
  return node.dateLabel || formatYear(node.startYear);
}

function chronologyTarget(node, height) {
  const oldest = -9000;
  const newest = Math.max(new Date().getFullYear(), ...allNodes.map(item => Number(item.startYear) || 0));
  const age = newest - Math.max(oldest, Math.min(newest, node.startYear));
  const maxAge = newest - oldest;
  const normalized = Math.log1p(age) / Math.log1p(maxAge);
  return 70 + normalized * Math.max(200, height - 140);
}

function resize() {
  const rect = wrap.getBoundingClientRect();
  pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
  canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  simulation.force("horizontal").x(rect.width / 2);
  simulation.force("chronology").y(node => chronologyTarget(node, rect.height));
  simulation.alpha(.45).restart();
  draw();
}

new ResizeObserver(resize).observe(wrap);

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function edgePoint(source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const padding = Math.min(target.width, target.height) * .58;
  return { x: target.x - dx / length * padding, y: target.y - dy / length * padding };
}

function quadraticPoint(start, control, end, position) {
  const inverse = 1 - position;
  return {
    x: inverse * inverse * start.x + 2 * inverse * position * control.x + position * position * end.x,
    y: inverse * inverse * start.y + 2 * inverse * position * control.y + position * position * end.y
  };
}

function linkPhase(link) {
  if (link._animationPhase != null) return link._animationPhase;
  const key = `${link.type}:${typeof link.source === "object" ? link.source.id : link.source}:${typeof link.target === "object" ? link.target.id : link.target}`;
  link._animationPhase = [...key].reduce((total, character) => total + character.codePointAt(0), 0) % 100 / 100;
  return link._animationPhase;
}

function drawLinkLabel(link, start, control, end, relationColor, alpha) {
  const label = `${iconForRelation(link)}  ${link.relationLabel || link.type}`;
  const midpoint = quadraticPoint(start, control, end, .5);
  let labelAngle = Math.atan2(end.y - start.y, end.x - start.x);
  if (labelAngle > Math.PI / 2 || labelAngle < -Math.PI / 2) labelAngle += Math.PI;

  context.save();
  context.translate(midpoint.x, midpoint.y);
  context.rotate(labelAngle);
  context.font = "600 10px 'Segoe UI Symbol', Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const labelWidth = context.measureText(label).width + 14;
  context.globalAlpha = alpha > .2 ? .92 : .16;
  context.fillStyle = "#0b0b0a";
  context.strokeStyle = relationColor;
  context.lineWidth = 1;
  roundedRect(context, -labelWidth / 2, -9, labelWidth, 18, 5);
  context.fill();
  context.stroke();
  context.globalAlpha = alpha > .2 ? 1 : .2;
  context.fillStyle = "#f0eee6";
  context.fillText(label, 0, .5);
  context.restore();
}

function drawArrow(link, time = 0) {
  const source = typeof link.source === "object" ? link.source : allNodes.find(n => n.id === link.source);
  const target = typeof link.target === "object" ? link.target : allNodes.find(n => n.id === link.target);
  if (!source || !target || source.x == null || target.x == null) return;
  const end = edgePoint(source, target);
  const start = edgePoint(target, source);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy) || 1;
  const bend = Number(link.relationCurve || 0);
  const offset = Math.min(165, distance * .45) * bend;
  const control = {
    x: (start.x + end.x) / 2 - dy / distance * offset,
    y: (start.y + end.y) / 2 + dx / distance * offset
  };
  const angle = Math.atan2(end.y - control.y, end.x - control.x);
  const relationColor = palette[link.type] || "#aaa79e";
  const visual = linkVisualStyle(link);
  const alpha = selected && source !== selected && target !== selected ? .12 : .68;

  context.save();
  context.strokeStyle = relationColor;
  context.fillStyle = relationColor;
  context.globalAlpha = alpha;
  context.lineWidth = visual.width;
  context.lineCap = visual.cap;
  context.setLineDash(visual.dash);
  context.lineDashOffset = motionEnabled ? -time * visual.speed : 0;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.quadraticCurveTo(control.x, control.y, end.x, end.y);
  context.stroke();
  if (visual.rail) {
    context.strokeStyle = "#0b0b0a";
    context.lineWidth = Math.max(1.2, visual.width - 2.2);
    context.setLineDash(visual.dash);
    context.stroke();
  }
  context.setLineDash([]);
  context.lineDashOffset = 0;

  if (visual.pulse && motionEnabled && alpha > .2) {
    const position = (linkPhase(link) + time * (visual.speed < .001 ? visual.speed : visual.speed * .003)) % 1;
    const pulse = quadraticPoint(start, control, end, position);
    context.globalAlpha = .92;
    context.fillStyle = relationColor;
    context.shadowColor = relationColor;
    context.shadowBlur = 8;
    context.beginPath();
    context.arc(pulse.x, pulse.y, visual.width + .8, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  }

  context.globalAlpha = alpha;
  context.translate(end.x, end.y);
  context.rotate(angle);
  drawLinkTerminator(linkTerminator(link), relationColor, visual.width, alpha > .2);
  context.restore();
  drawLinkLabel(link, start, control, end, relationColor, alpha);
}

// Drawn in a frame translated to the target endpoint and rotated so +x points
// along the link's travel direction (toward the target node). Markers are
// counter-scaled against the zoom so they stay clearly legible when zoomed out.
function drawLinkTerminator(kind, color, width, vivid) {
  // Hold a roughly constant on-screen size: markers grow in graph units as we
  // zoom out so they stay legible instead of shrinking to a speck.
  const s = Math.min(4.5, Math.max(1, 0.9 / transform.k));
  context.scale(s, s);
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineJoin = "round";
  context.lineCap = "round";
  if (vivid) {
    context.shadowColor = color;
    context.shadowBlur = 9;
  }
  switch (kind) {
    case "wall": {
      // A barrier the arrow slams into — reads as "bloque".
      // Outer bright wall + dark hazard core + rivets.
      roundedRect(context, -6, -19, 11, 38, 3);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = "#0b0b0a";
      roundedRect(context, -3.5, -15, 6, 30, 2);
      context.fill();
      context.fillStyle = color;
      for (const oy of [-11, 0, 11]) {
        context.beginPath();
        context.arc(-0.5, oy, 2, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }
    case "clash": {
      // Two crossing strokes — a collision, reads as "contredit".
      context.lineWidth = Math.max(4, width * 1.6);
      context.beginPath();
      context.moveTo(-13, -12); context.lineTo(5, 6);
      context.moveTo(-13, 12); context.lineTo(5, -6);
      context.stroke();
      context.shadowBlur = 0;
      break;
    }
    case "guard": {
      // Double chevron shield — reads as "protège / atténue".
      context.lineWidth = Math.max(4, width * 1.5);
      context.beginPath();
      context.moveTo(-15, -12); context.lineTo(-2, 0); context.lineTo(-15, 12);
      context.moveTo(-7, -12); context.lineTo(6, 0); context.lineTo(-7, 12);
      context.stroke();
      context.shadowBlur = 0;
      break;
    }
    case "key": {
      // Arrowhead tipped with a diamond — reads as "débloque".
      context.beginPath();
      context.moveTo(0, 0); context.lineTo(-12, -7); context.lineTo(-12, 7);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(-12, 0); context.lineTo(-18, -7);
      context.lineTo(-25, 0); context.lineTo(-18, 7);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
      break;
    }
    case "star": {
      // Five-point star — reads as "recommande".
      context.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 14 : 6;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const px = -9 + r * Math.cos(a);
        const py = r * Math.sin(a);
        if (i === 0) context.moveTo(px, py); else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
      break;
    }
    default: {
      // Classic arrowhead — enlarged so direction reads at a glance.
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(-13, -6.5);
      context.lineTo(-13, 6.5);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
    }
  }
  context.shadowBlur = 0;
}

function drawNode(node) {
  const active = node === selected || node === hovered;
  const related = !selected || node === selected || links.some(link =>
    (link.source === selected && link.target === node) || (link.target === selected && link.source === node)
  );
  context.save();
  context.globalAlpha = related ? 1 : .2;
  const cornerRadius = node.nodeType === "axiom" ? node.height / 2
    : node.nodeType === "unlock" ? 18
    : node.nodeType === "institution" ? 12
    : node.nodeType === "horizon" ? 28
    : node.nodeType === "forecast_event" ? 0
    : node.nodeType === "mechanism" ? 3 : 6;
  roundedRect(context, node.x - node.width / 2, node.y - node.height / 2, node.width, node.height, cornerRadius);
  const colors = familyPalette[node.colorGroup];
  context.fillStyle = active ? colors.stroke : colors.fill;
  context.strokeStyle = active ? "#f0eee6" : colors.stroke;
  context.lineWidth = active ? 2 : 1;
  context.fill();
  context.setLineDash(node.nodeType === "forecast_event" ? [6, 4] : []);
  context.stroke();
  context.setLineDash([]);
  const iconX = node.x - node.width / 2 + 20;
  const iconY = node.y - node.height / 2 + 20;
  context.beginPath();
  context.arc(iconX, iconY, 15, 0, Math.PI * 2);
  context.fillStyle = active ? "#171715" : colors.stroke;
  context.fill();
  context.strokeStyle = active ? colors.stroke : "#0b0b0a";
  context.lineWidth = 1.5;
  context.stroke();
  context.fillStyle = active ? colors.stroke : "#0b0b0a";
  context.font = "700 20px 'Segoe UI Symbol', 'Noto Sans Symbols 2', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(node.typeIcon, iconX, iconY + .5);
  context.textAlign = "center";
  context.textBaseline = "top";
  let textY = node.y - node.height / 2 + 15;
  context.fillStyle = active ? "#171715" : colors.stroke;
  context.font = "600 9px Inter, system-ui, sans-serif";
  context.fillText(node.typeLabel.toLocaleUpperCase("fr"), node.x, textY);
  textY += 20;
  context.fillStyle = active ? "#0b0b0a" : "#f0eee6";
  context.font = node.nodeType === "terme" ? "700 14px Inter, system-ui, sans-serif" : "500 14px Inter, system-ui, sans-serif";
  for (const line of node.titleLines) {
    context.fillText(line, node.x, textY);
    textY += 17;
  }
  textY += 7;
  context.fillStyle = active ? "#282622" : "#b8b5ad";
  context.font = "400 18px 'Segoe UI Historic', 'Noto Sans', sans-serif";
  for (const line of node.phraseLines) {
    context.fillText(line, node.x, textY);
    textY += 21;
  }
  context.fillStyle = active ? "#171715" : "#d7d3ca";
  context.font = "400 11px Inter, system-ui, sans-serif";
  const datePrefix = node.nodeType === "forecast_event" ? "fenêtre ·"
    : ["axiom", "unlock", "mechanism", "institution", "horizon"].includes(node.nodeType) ? "projection ·"
    : "horizon ·";
  context.textBaseline = "bottom";
  const navigationLabel = nodeNavigationLabel(node);
  context.fillText(navigationLabel || `${datePrefix} ${nodeDate(node)}`, node.x, node.y + node.height / 2 - 14);
  const health = healthByTarget.get(node.id);
  if (health) {
    const colorsByState = { passing: "#39d98a", failing: "#ff5c5c", partial: "#f2b84b", stale: "#8b8b84", running: "#65a9ff", unknown: "#8b8b84" };
    context.beginPath();
    context.arc(node.x + node.width / 2 - 13, node.y - node.height / 2 + 13, 6, 0, Math.PI * 2);
    context.fillStyle = colorsByState[health.state] || colorsByState.unknown;
    context.fill();
    context.strokeStyle = "#0b0b0a";
    context.lineWidth = 2;
    context.stroke();
  }
  context.restore();
}

function isClusterRepresentative(node) {
  return Boolean(node?.clusterId && clusterRepresentatives.get(node.clusterId) === node.id);
}

function nodeNavigationLabel(node) {
  if (navigationScope.type === "overview" && isClusterRepresentative(node)) {
    return `${clusterSize(allNodes, node.clusterId)} nœuds · cliquer pour ouvrir`;
  }
  const childCount = hierarchyChildren.get(node.id)?.size || 0;
  if (navigationScope.type === "overview" && childCount) {
    return `ouvrir · ${childCount} sous-nœud${childCount > 1 ? "s" : ""}`;
  }
  if (navigationScope.type === "overview") {
    return "cliquer pour explorer";
  }
  return "";
}

function nodeMenuPosition(node) {
  return transform.apply([node.x + node.width / 2 - 17, node.y - node.height / 2 + 17]);
}

function drawNodeMenuButton(node) {
  const [x, y] = nodeMenuPosition(node);
  context.save();
  context.fillStyle = "#171715";
  context.strokeStyle = "#f0eee6";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(x, y, 13, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#f0eee6";
  context.font = "700 18px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("…", x, y - 3);
  context.restore();
}

function positionCopyMenu() {
  const menu = document.getElementById("copy-menu");
  if (menu.hidden || !copyMenuNode) return;
  const [x, y] = nodeMenuPosition(copyMenuNode);
  menu.style.left = `${Math.min(wrap.clientWidth - 190, Math.max(8, x + 17))}px`;
  menu.style.top = `${Math.min(wrap.clientHeight - 100, Math.max(8, y - 12))}px`;
}

function draw(time = performance.now()) {
  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.save();
  context.translate(transform.x, transform.y);
  context.scale(transform.k, transform.k);
  links.forEach(link => drawArrow(link, time));
  nodes.forEach(drawNode);
  context.restore();
  const actionNode = hovered || copyMenuNode || selected;
  if (actionNode && nodes.includes(actionNode)) drawNodeMenuButton(actionNode);
  positionCopyMenu();
}

function animateGraph(time) {
  if (time - lastAnimationFrame >= 32) {
    lastAnimationFrame = time;
    draw(time);
  }
  requestAnimationFrame(animateGraph);
}

if (motionEnabled) requestAnimationFrame(animateGraph);

function graphPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return transform.invert([event.clientX - rect.left, event.clientY - rect.top]);
}

function nodeAt(event) {
  const [x, y] = graphPoint(event);
  return [...nodes].reverse().find(node =>
    Math.abs(x - node.x) <= node.width / 2 && Math.abs(y - node.y) <= node.height / 2
  );
}

function nodeMenuAt(event, node) {
  if (!node) return false;
  const rect = canvas.getBoundingClientRect();
  const [x, y] = nodeMenuPosition(node);
  return Math.abs(event.clientX - rect.left - x) <= 16 && Math.abs(event.clientY - rect.top - y) <= 16;
}

canvas.addEventListener("pointermove", event => {
  hovered = nodeAt(event) || null;
  canvas.style.cursor = hovered ? "pointer" : "grab";
  if (hovered?.nodeType === "terme") {
    termHoverCard.innerHTML = `<strong>${escapeHtml(hovered.name)}</strong><span>${escapeHtml(hovered.definition)}</span><small>Contexte : ${escapeHtml(hovered.context)}</small>`;
    termHoverCard.style.left = `${Math.max(8, Math.min(event.offsetX + 14, canvas.clientWidth - 328))}px`;
    termHoverCard.style.top = `${Math.max(8, event.offsetY - 18)}px`;
    termHoverCard.hidden = false;
  } else {
    termHoverCard.hidden = true;
  }
  draw();
});

canvas.addEventListener("pointerleave", () => {
  hovered = null;
  termHoverCard.hidden = true;
  draw();
});

canvas.addEventListener("click", event => {
  const hit = nodeAt(event);
  if (!hit) {
    closeCopyMenu();
    return;
  }
  lastClickedNode = hit;
  selectNode(hit);
  if (nodeMenuAt(event, hit)) {
    openCopyMenu(hit);
    return;
  }
  if (navigationScope.type === "overview" && isClusterRepresentative(hit)) {
    showNamedCluster(hit.clusterId);
    return;
  }
  if (navigationScope.type === "overview") {
    showNodeNeighborhood(hit);
  }
});

canvas.addEventListener("dblclick", event => {
  const hit = nodeAt(event) || lastClickedNode;
  if (!hit || nodeMenuAt(event, hit)) return;
  event.preventDefault();
  selectNode(hit);
  closeCopyMenu();
  const cluster = clusterForNode(hit);
  if (!cluster) return;
  renderClusterPresentation(transformClusterToPresentation(cluster, { focusNode: hit }));
});

const drag = d3.drag()
  .subject(event => {
    const hit = nodeAt(event.sourceEvent);
    return nodeMenuAt(event.sourceEvent, hit) ? null : hit;
  })
  .on("start", event => {
    if (!event.subject) return;
    if (!event.active) simulation.alphaTarget(.22).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  })
  .on("drag", event => {
    if (!event.subject) return;
    const [x, y] = transform.invert([event.x, event.y]);
    event.subject.fx = x;
    event.subject.fy = y;
  })
  .on("end", event => {
    if (!event.subject) return;
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  });

d3.select(canvas).call(drag);

function selectNode(node) {
  selected = node;
  updateCopyActions();
  document.getElementById("detail-name").textContent = node.name;
  document.getElementById("detail-phrase").textContent = node.phrase;
  document.getElementById("detail-meta").innerHTML = `
    <dt>Période</dt><dd>${node.period}</dd>
    <dt>Type</dt><dd><span class="type-icon" aria-hidden="true">${iconForNode(node)}</span> ${node.nodeTypeLabel || node.nodeType} <small>(${node.nodeType})</small></dd>
    <dt>Épistémique</dt><dd>${node.epistemicLabel || node.epistemicStatus || "non qualifié"}</dd>
    <dt>Horizon</dt><dd>${nodeDate(node)}</dd>
    <dt>Région</dt><dd>${node.region}</dd>
    <dt>Famille</dt><dd>${node.family}</dd>
    <dt>Statut</dt><dd>${node.status}</dd>
    ${node.maturity ? `<dt>Maturité</dt><dd>${escapeHtml(node.maturity)}</dd>` : ""}
    ${node.responseStatus ? `<dt>Statut de réponse</dt><dd>${escapeHtml(node.responseStatus)}</dd>` : ""}
    ${node.ownerRole ? `<dt>Responsable proposé</dt><dd>${escapeHtml(node.ownerRole)}</dd>` : ""}
    ${node.targetDate ? `<dt>Échéance proposée</dt><dd>${escapeHtml(node.targetDate)}</dd>` : ""}
    ${node.closureCriteria ? `<dt>Critère de clôture</dt><dd>${escapeHtml(node.closureCriteria)}</dd>` : ""}
    ${node.testObjective ? `<dt>Objectif du test</dt><dd>${escapeHtml(node.testObjective)}</dd>` : ""}
    ${node.methodSummary ? `<dt>Méthode proposée</dt><dd>${escapeHtml(node.methodSummary)}</dd>` : ""}
    ${Array.isArray(node.metricIds) && node.metricIds.length ? `<dt>Métriques liées</dt><dd>${node.metricIds.map(escapeHtml).join(", ")}</dd>` : ""}
    ${node.failureCondition ? `<dt>Condition d’échec</dt><dd>${escapeHtml(node.failureCondition)}</dd>` : ""}
    ${node.minimumSample ? `<dt>Échantillon minimal</dt><dd>${escapeHtml(node.minimumSample)}</dd>` : ""}
    ${node.decisionStatus ? `<dt>Statut de décision</dt><dd>${escapeHtml(node.decisionStatus)}</dd>` : ""}
    ${node.responsibleRole ? `<dt>Responsable de décision</dt><dd>${escapeHtml(node.responsibleRole)}</dd>` : ""}
    ${node.decisionDue ? `<dt>Échéance de décision</dt><dd>${escapeHtml(node.decisionDue)}</dd>` : ""}
    ${node.chosenOptionId ? `<dt>Option retenue</dt><dd>${escapeHtml(node.chosenOptionId)}</dd>` : ""}
    ${node.optionCriteria?.length ? `<dt>Critères d’arbitrage</dt><dd>${node.optionCriteria.map(escapeHtml).join(" · ")}</dd>` : ""}
    ${node.optionCode ? `<dt>Option</dt><dd>${escapeHtml(node.optionCode)}</dd>` : ""}
    ${node.optionBenefits?.length ? `<dt>Bénéfices</dt><dd>${node.optionBenefits.map(escapeHtml).join(" · ")}</dd>` : ""}
    ${node.optionRisks?.length ? `<dt>Risques</dt><dd>${node.optionRisks.map(escapeHtml).join(" · ")}</dd>` : ""}
    ${node.optionConditions?.length ? `<dt>Conditions</dt><dd>${node.optionConditions.map(escapeHtml).join(" · ")}</dd>` : ""}
    <dt>Forme</dt><dd>${node.phraseStatus}</dd>
    ${node.contextId ? `<dt>Contexte</dt><dd>${escapeHtml(node.contextId)}</dd>` : ""}
    ${node.context ? `<dt>Contexte du terme</dt><dd>${escapeHtml(node.context)}</dd>` : ""}
    ${node.definition ? `<dt>Définition</dt><dd>${escapeHtml(node.definition)}</dd>` : ""}
    ${node.populationOrSystem ? `<dt>Population / système</dt><dd>${escapeHtml(node.populationOrSystem)}</dd>` : ""}
    ${node.jurisdiction ? `<dt>Juridiction</dt><dd>${escapeHtml(node.jurisdiction)}</dd>` : ""}
    ${node.validFrom || node.validTo ? `<dt>Validité</dt><dd>${escapeHtml(node.validFrom || "…")} → ${escapeHtml(node.validTo || "…")}</dd>` : ""}
    ${node.metricId ? `<dt>Métrique</dt><dd>${escapeHtml(node.metricId)}</dd>` : ""}
    ${node.methodId ? `<dt>Méthode</dt><dd>${escapeHtml(node.methodId)}</dd>` : ""}
    ${node.quantificationStatus && node.quantificationStatus !== "unquantified" ? `<dt>Quantification</dt><dd>${escapeHtml(node.quantificationStatus)}</dd>` : ""}
    ${node.probabilityPct !== "" && node.probabilityPct != null ? `<dt>Probabilité</dt><dd>${meterBar(node.probabilityPct, "percent")}</dd>` : ""}
    ${node.confidenceScore !== "" && node.confidenceScore != null ? `<dt>Confiance</dt><dd>${meterBar(node.confidenceScore, "confidence")}</dd>` : ""}
    ${node.effectSizePct !== "" && node.effectSizePct != null ? `<dt>Taille d’effet</dt><dd>${meterBar(node.effectSizePct, "effect")}</dd>` : ""}
    ${node.sourcePage ? `<dt>Page source</dt><dd>${escapeHtml(node.sourcePage)}</dd>` : ""}
    ${node.documentSection ? `<dt>Section</dt><dd>${escapeHtml(node.documentSection)}</dd>` : ""}
    ${node.sourceRepository ? `<dt>Dépôt source</dt><dd>${escapeHtml(node.sourceRepository)}</dd>` : ""}
    ${node.sourcePath ? `<dt>Chemin source</dt><dd>${escapeHtml(node.sourcePath)}</dd>` : ""}
    ${node.sourceHash ? `<dt>Empreinte source</dt><dd><code>${escapeHtml(node.sourceHash.slice(0, 16))}…</code></dd>` : ""}
    ${node.sourceCommit ? `<dt>Commit source</dt><dd><code>${escapeHtml(node.sourceCommit.slice(0, 12))}</code></dd>` : ""}
    ${node.observedAt ? `<dt>Provenance observée</dt><dd>${escapeHtml(node.observedAt)}</dd>` : ""}
    ${node.evidenceType ? `<dt>Type de preuve</dt><dd>${escapeHtml(node.evidenceType)}</dd>` : ""}`;
  document.getElementById("detail-summary").textContent = node.summary;
  const forecastSection = document.getElementById("detail-forecast");
  const forecastList = document.getElementById("detail-forecast-list");
  forecastSection.hidden = node.nodeType !== "forecast_event";
  forecastList.innerHTML = node.nodeType === "forecast_event" ? `
    <dt>Fenêtre</dt><dd>${node.forecastWindow}</dd>
    <dt>Confiance</dt><dd>${node.forecastConfidence}</dd>
    <dt>Signaux</dt><dd>${node.forecastSignals}</dd>
    <dt>Hypothèses</dt><dd>${node.forecastAssumptions}</dd>
    <dt>Impact</dt><dd>${node.forecastImpact}</dd>
    <dt>Réponse</dt><dd>${node.forecastResponse}</dd>` : "";
  const roadmapSection = document.getElementById("detail-roadmap");
  const roadmapList = document.getElementById("detail-roadmap-list");
  const isRoadmapNode = ["working_hypothesis", "open_question", "system_state"].includes(node.nodeType);
  roadmapSection.hidden = !isRoadmapNode;
  roadmapList.innerHTML = node.nodeType === "working_hypothesis" ? `
    <dt>Base</dt><dd>${node.hypothesisBasis}</dd>
    <dt>À vérifier</dt><dd>${node.verificationNeeded}</dd>`
    : node.nodeType === "open_question" ? `
    <dt>Catégorie</dt><dd>${node.questionCategory}</dd>
    <dt>Décision</dt><dd>${node.decisionNeeded}</dd>`
    : node.nodeType === "system_state" ? `
    <dt>Orientation</dt><dd>${node.stateOrientation}</dd>
    <dt>Dimension</dt><dd>${node.stateDimension}</dd>
    <dt>Indicateur</dt><dd>${node.stateIndicator}</dd>` : "";
  const workSection = document.getElementById("detail-work");
  const workList = document.getElementById("detail-work-list");
  const isWorkNode = ["idea", "task", "change"].includes(node.nodeType);
  workSection.hidden = !isWorkNode;
  workList.innerHTML = isWorkNode ? `
    <dt>Statut de travail</dt><dd>${escapeHtml(node.workStatus || "non défini")}</dd>
    ${node.priority !== "" && node.priority != null ? `<dt>Priorité</dt><dd>${escapeHtml(node.priority)}/100</dd>` : ""}
    ${node.autonomyMode ? `<dt>Autonomie</dt><dd>${escapeHtml(node.autonomyMode)}</dd>` : ""}
    ${node.acceptanceCriteria?.length ? `<dt>Critères de clôture</dt><dd><ul>${node.acceptanceCriteria.map(value => `<li>${escapeHtml(value)}</li>`).join("")}</ul></dd>` : ""}
    ${node.verificationCommand ? `<dt>Vérification</dt><dd><code>${escapeHtml(node.verificationCommand)}</code></dd>` : ""}
    ${node.changedPaths?.length ? `<dt>Fichiers changés</dt><dd>${node.changedPaths.map(escapeHtml).join(" · ")}</dd>` : ""}
    ${node.updatedAt ? `<dt>Mis à jour</dt><dd>${escapeHtml(node.updatedAt)}</dd>` : ""}
    ${node.completedAt ? `<dt>Terminé</dt><dd>${escapeHtml(node.completedAt)}</dd>` : ""}` : "";
  const source = document.getElementById("detail-source");
  source.replaceChildren();
  if (node.sourceUrl) {
    const link = document.createElement("a");
    link.href = node.sourceUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = node.sourceTitle || "Source de référence";
    source.append("Source : ", link);
  }

  const outgoing = allLinks.filter(link => idOf(link.source) === node.id);
  const incoming = allLinks.filter(link => idOf(link.target) === node.id);
  document.getElementById("detail-relations").innerHTML = `
    <h3>Relations sortantes</h3>${relationList(outgoing, "target")}
    <h3>Relations entrantes</h3>${relationList(incoming, "source")}`;
  syncNodeParam(node.id);
  draw();
}

function syncNodeParam(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("node", id);
  else url.searchParams.delete("node");
  history.replaceState(null, "", url);
}

function resetDetails() {
  selected = null;
  updateCopyActions();
  document.getElementById("detail-name").textContent = "Clique sur un nœud";
  document.getElementById("detail-phrase").textContent = "Chaque nœud porte une traduction ou une phrase-manifeste propre à son rôle dans le graphe.";
  document.getElementById("detail-meta").innerHTML = "";
  document.getElementById("detail-summary").textContent = "";
  document.getElementById("detail-forecast").hidden = true;
  document.getElementById("detail-work").hidden = true;
  document.getElementById("detail-forecast-list").innerHTML = "";
  document.getElementById("detail-roadmap").hidden = true;
  document.getElementById("detail-roadmap-list").innerHTML = "";
  document.getElementById("detail-source").replaceChildren();
  document.getElementById("detail-relations").innerHTML = "";
  syncNodeParam(null);
}

function updateCopyActions() {
  const nodeButton = document.getElementById("copy-node");
  const clusterButton = document.getElementById("copy-cluster");
  if (!nodeButton || !clusterButton) return;
  const targetNode = copyMenuNode || selected;
  nodeButton.disabled = !targetNode;
  clusterButton.disabled = !clusterForNode(targetNode);
}

function clusterForNode(node) {
  if (!node) return null;
  if (graphQueryResult?.nodes?.some(item => item.id === node.id)) return graphQueryResult;
  if (!node.clusterId) {
    const clusterIds = new Set([node.id]);
    let frontier = new Set([node.id]);
    for (let depth = 0; depth < 2; depth += 1) {
      const nextFrontier = new Set();
      allLinks.forEach(link => {
        const source = idOf(link.source);
        const target = idOf(link.target);
        if (frontier.has(source) && !clusterIds.has(target)) nextFrontier.add(target);
        if (frontier.has(target) && !clusterIds.has(source)) nextFrontier.add(source);
      });
      nextFrontier.forEach(id => clusterIds.add(id));
      frontier = nextFrontier;
    }
    return {
      nodes: allNodes.filter(item => clusterIds.has(item.id)),
      links: allLinks.filter(link => clusterIds.has(idOf(link.source)) && clusterIds.has(idOf(link.target)))
    };
  }
  const seeds = allNodes.filter(item => item.clusterId === node.clusterId);
  const seedIds = new Set(seeds.map(item => item.id));
  const clusterLinks = allLinks.filter(link => seedIds.has(idOf(link.source)) || seedIds.has(idOf(link.target)));
  const clusterIds = new Set(seedIds);
  clusterLinks.forEach(link => {
    clusterIds.add(idOf(link.source));
    clusterIds.add(idOf(link.target));
  });
  return {
    nodes: allNodes.filter(item => clusterIds.has(item.id)),
    links: allLinks.filter(link => clusterIds.has(idOf(link.source)) && clusterIds.has(idOf(link.target)))
  };
}

function renderClusterPresentation(plan) {
  const panel = document.getElementById("cluster-presentation");
  document.getElementById("cluster-presentation-title").textContent = plan.title;
  document.getElementById("cluster-presentation-meta").textContent = `${plan.meta.nodeCount} nœuds · ${plan.meta.semanticRelationCount} relations sémantiques · ${plan.meta.provenanceRelationCount} provenances · algorithme ${plan.algorithmVersion}`;
  document.getElementById("cluster-presentation-lede").innerHTML = `<em>${escapeHtml(plan.lede)}</em>`;
  document.getElementById("cluster-presentation-patterns").innerHTML = plan.patterns.slice(0, 4).map(pattern => `
    <span title="Confiance structurelle ${(pattern.confidence * 100).toFixed(0)} %">${escapeHtml(pattern.label)} <strong>${Math.round(pattern.importance * 100)}</strong></span>
  `).join("");
  document.getElementById("cluster-presentation-sections").innerHTML = plan.sections.map(section => `
    <section data-presentation-section="${escapeHtml(section.id)}">
      <h3>${escapeHtml(section.heading)}</h3>
      <ul class="presentation-node-list">
        ${section.items.map(item => `<li>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.body)}</span>
          <small><em>Importance éditoriale : ${Math.round(item.importance * 100)} %</em></small>
        </li>`).join("")}
      </ul>
      ${section.relations.length ? `<div class="presentation-relations">
        <h4>Enchaînements</h4>
        <ol>${section.relations.map(relation => `<li>
          <strong>${escapeHtml(relation.sourceName)}</strong>
          <em>${escapeHtml(relation.verb)}</em>
          <strong>${escapeHtml(relation.targetName)}</strong>.
          <small>Importance relative du lien : ${Math.round(relation.importance * 100)} %</small>
        </li>`).join("")}</ol>
      </div>` : ""}
    </section>
  `).join("");
  panel.hidden = false;
  panel.scrollTop = 0;
}

function hideClusterPresentation() {
  document.getElementById("cluster-presentation").hidden = true;
}

document.getElementById("cluster-presentation-close").addEventListener("click", hideClusterPresentation);

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !document.getElementById("cluster-presentation").hidden) hideClusterPresentation();
});

function openCopyMenu(node) {
  copyMenuNode = node;
  const menu = document.getElementById("copy-menu");
  menu.hidden = false;
  updateCopyActions();
  positionCopyMenu();
  document.getElementById("copy-node").focus();
  draw();
}

function closeCopyMenu() {
  const menu = document.getElementById("copy-menu");
  menu.hidden = true;
  copyMenuNode = null;
  draw();
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
  if (!copied) throw new Error("La copie n’est pas prise en charge par ce navigateur.");
}

async function copyContent(text, successMessage) {
  const status = document.getElementById("copy-status");
  try {
    await writeToClipboard(text);
    status.textContent = successMessage;
  } catch (error) {
    status.textContent = `Copie impossible : ${error.message}`;
  } finally {
    closeCopyMenu();
  }
}

document.getElementById("copy-node").addEventListener("click", () => {
  const node = copyMenuNode || selected;
  if (node) copyContent(serializeNodeContent(node), "Contenu du nœud copié.");
});

document.getElementById("copy-cluster").addEventListener("click", () => {
  const cluster = clusterForNode(copyMenuNode || selected);
  if (cluster) copyContent(serializeClusterContent(cluster), "Contenu du cluster copié.");
});

document.addEventListener("click", event => {
  const menu = document.getElementById("copy-menu");
  if (!menu.hidden && event.target !== canvas && !menu.contains(event.target)) closeCopyMenu();
});

function idOf(value) { return typeof value === "object" ? value.id : value; }
function nameOf(value) { return allNodes.find(node => node.id === idOf(value))?.name || idOf(value); }
function relationList(items, end) {
  if (!items.length) return "<p class='details-kicker'>Aucune</p>";
  return `<div class="relation-cards">${items.map(link => {
    if (!link.relationLabel) {
      return `<p><span class="type-icon" aria-hidden="true">${iconForRelation(link)}</span> <strong>${link.type}</strong> · ${nameOf(link[end])}${link.note ? ` — ${link.note}` : ""}</p>`;
    }
    return `<details>
      <summary><i style="background:${palette[link.type]}"></i><span class="type-icon" aria-hidden="true">${iconForRelation(link)}</span><strong>${nameOf(link.source)} → ${nameOf(link.target)}</strong> · ${link.relationLabel}</summary>
      <p class="relation-story">${link.relationStory}</p>
      <dl>
        <dt>Justification</dt><dd>${escapeHtml(link.justification)}</dd>
        <dt>Qualité</dt><dd>${link.relationQuality}</dd>
        ${link.relationFamily ? `<dt>Famille</dt><dd>${link.relationFamily}</dd>
        <dt>Portée</dt><dd>${link.relationScope}</dd>
        <dt>Causalité</dt><dd>${link.causalClaim ? "affirmation causale" : "non causale"}</dd>
        <dt>Canon</dt><dd>${link.canonicalPredicate}</dd>
        <dt>Quantifié</dt><dd>${link.quantificationStatus}</dd>` : ""}
        ${link.confidenceScore !== undefined && link.confidenceScore !== null && link.confidenceScore !== "" ? `<dt>Confiance</dt><dd>${meterBar(link.confidenceScore, "confidence")}</dd>` : ""}
        ${link.effectSizePct !== undefined && link.effectSizePct !== null && link.effectSizePct !== "" ? `<dt>Taille d’effet</dt><dd>${meterBar(link.effectSizePct, "effect")}</dd>` : ""}
        ${link.evidenceBasis ? `<dt>Preuve</dt><dd>${evidenceBasisBadge(link.evidenceBasis)}</dd>` : ""}
        ${link.traversalWeight !== undefined ? `<dt>Traversée</dt><dd>${meterBar(link.traversalWeight, "unit")}</dd>
        <dt>Hiérarchie</dt><dd>${escapeHtml(link.hierarchyKind || "none")} · ${meterBar(link.hierarchyWeight || 0, "unit")}</dd>` : ""}
        ${link.forecastEffect ? `<dt>Effet</dt><dd>${link.forecastEffect}</dd>
        <dt>Intensité</dt><dd>${link.forecastStrength}/5</dd>
        <dt>Polarité</dt><dd>${link.forecastPolarity}</dd>
        <dt>Délai</dt><dd>${link.forecastDelay}</dd>
        <dt>Domaines</dt><dd>${link.forecastDimensions}</dd>
        <dt>Boucle</dt><dd>${link.forecastFeedback}</dd>` : ""}
        ${link.causalLogic ? `<dt>Logique</dt><dd>${link.causalLogic}</dd>
        <dt>Condition</dt><dd>${link.causalCondition}</dd>
        <dt>Risque</dt><dd>${link.causalRisk}</dd>` : ""}
        ${link.contextId ? `<dt>Contexte</dt><dd>${escapeHtml(link.contextId)}</dd>` : ""}
        ${link.populationOrSystem ? `<dt>Population / système</dt><dd>${escapeHtml(link.populationOrSystem)}</dd>` : ""}
        ${link.validFrom || link.validTo ? `<dt>Validité</dt><dd>${escapeHtml(link.validFrom || "…")} → ${escapeHtml(link.validTo || "…")}</dd>` : ""}
        ${link.metricId ? `<dt>Métrique</dt><dd>${escapeHtml(link.metricId)}</dd>` : ""}
        ${link.methodId ? `<dt>Méthode</dt><dd>${escapeHtml(link.methodId)}</dd>` : ""}
      </dl>
    </details>`;
  }).join("")}</div>`;
}

function visibleTypes() {
  return new Set(relationInputs.filter(input => input.checked).map(input => input.dataset.linkType));
}

function visibleNodeTypes() {
  return new Set(nodeTypeInputs.filter(input => input.checked).map(input => input.dataset.nodeType));
}

function updateHierarchyNavigation() {
  const back = document.getElementById("hierarchy-back");
  const status = document.getElementById("hierarchy-status");
  const inSubgraph = navigationScope.type !== "overview";
  back.hidden = !inSubgraph;
  if (navigationScope.type === "cluster") {
    const representative = allNodes.find(node => node.id === clusterRepresentatives.get(navigationScope.clusterId));
    status.textContent = `${representative?.name || navigationScope.clusterId} · ${clusterSize(allNodes, navigationScope.clusterId)} nœuds`;
  } else if (navigationScope.type === "result") {
    status.textContent = `Cluster connecté · ${graphQueryResult?.nodes?.length || 0} nœuds`;
  } else if (navigationScope.type === "neighborhood") {
    const focus = allNodes.find(node => node.id === navigationScope.focusNodeId);
    status.textContent = `${focus?.name || "Voisinage"} · voisinage sémantique`;
  } else {
    const visibleOverviewIds = navigationNodeIds(allNodes, allLinks, {
      scope: "overview",
      representatives: clusterRepresentatives,
      hierarchyChildren,
      overviewIds: overviewNodeIds,
      expandedIds: expandedHierarchyIds
    });
    status.textContent = `${clusterRepresentatives.size} clusters repliés · ${visibleOverviewIds.size} nœuds principaux`;
  }
}

function showNodeNeighborhood(node) {
  navigationScope = { type: "neighborhood", clusterId: null, focusNodeId: node.id };
  graphQueryResult = null;
  searchInput.value = "";
  renderGraphQuery(null);
  updateHierarchyNavigation();
  applyFilters();
  selectNode(node);
  setTimeout(() => fitGraph(.55), 300);
}

function showHierarchyOverview() {
  navigationScope = { type: "overview", clusterId: null };
  expandedHierarchyIds.clear();
  graphQueryResult = null;
  searchInput.value = "";
  document.getElementById("graph-question").value = "";
  renderGraphQuery(null);
  hideClusterPresentation();
  resetDetails();
  const url = new URL(window.location.href);
  url.searchParams.delete("cluster");
  history.replaceState(null, "", url);
  updateHierarchyNavigation();
  applyFilters();
  setTimeout(() => fitGraph(.55), 300);
}

document.getElementById("hierarchy-back").addEventListener("click", showHierarchyOverview);

function applyFilters() {
  const query = searchInput.value.trim().toLocaleLowerCase("fr");
  const types = visibleTypes();
  const nodeTypes = visibleNodeTypes();
  const nodeAllowed = node => nodeTypes.has(node.nodeType);
  const exactNameMatches = allNodes.filter(node => nodeAllowed(node) && node.name.toLocaleLowerCase("fr") === query);
  const matchedIds = new Set(allNodes.filter(node => nodeAllowed(node) && (!query || [
    node.name, node.phrase, node.family, node.region, node.summary,
    node.forecastWindow, node.forecastConfidence, node.forecastSignals,
    node.forecastAssumptions, node.forecastImpact, node.forecastResponse,
    node.hypothesisBasis, node.verificationNeeded, node.questionCategory,
    node.decisionNeeded, node.stateOrientation, node.stateDimension, node.stateIndicator,
    node.valenceScore, node.humanValenceDelta,
    node.clusterId, node.sourcePage, node.documentSection, node.contextId,
    node.populationOrSystem, node.jurisdiction, node.metricId, node.methodId,
    node.epistemicStatus, node.quantificationStatus
  ].filter(Boolean).some(value => value.toLocaleLowerCase("fr").includes(query)))).map(node => node.id));
  const directMatchIds = new Set(matchedIds);
  if (query) {
    const hasNarrativeMatch = directMatchIds.size > 0;
    if (hasNarrativeMatch) {
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const link of allLinks.filter(link => narrativeRelationTypes.has(link.type))) {
          const source = idOf(link.source);
          const target = idOf(link.target);
          const sourceNodeType = allNodes.find(node => node.id === source)?.nodeType;
          if (matchedIds.has(target) && nodeTypes.has(sourceNodeType) && !matchedIds.has(source)) {
            matchedIds.add(source);
            expanded = true;
          }
        }
      }
      for (const link of allLinks.filter(link => narrativeRelationTypes.has(link.type))) {
        const source = idOf(link.source);
        const target = idOf(link.target);
        const targetNodeType = allNodes.find(node => node.id === target)?.nodeType;
        if (directMatchIds.has(source) && nodeTypes.has(targetNodeType)) matchedIds.add(target);
      }
      for (const link of allLinks.filter(link => relativeInfluenceTypes.has(link.type))) {
        const source = idOf(link.source);
        const target = idOf(link.target);
        const sourceNodeType = allNodes.find(node => node.id === source)?.nodeType;
        const targetNodeType = allNodes.find(node => node.id === target)?.nodeType;
        if (directMatchIds.has(source) && nodeTypes.has(targetNodeType)) matchedIds.add(target);
        if (directMatchIds.has(target) && nodeTypes.has(sourceNodeType)) matchedIds.add(source);
      }
    }
  }

  for (const id of [...matchedIds]) {
    const node = allNodes.find(item => item.id === id);
    if (!node || !nodeAllowed(node)) matchedIds.delete(id);
  }
  if (graphQueryResult) {
    const clusterIds = new Set(graphQueryResult.nodes.map(node => node.id));
    for (const id of [...matchedIds]) if (!clusterIds.has(id)) matchedIds.delete(id);
  }
  if (navigationScope.type === "cluster" || navigationScope.type === "neighborhood") {
    const navigationIds = navigationNodeIds(allNodes, allLinks, {
      scope: navigationScope.type,
      clusterId: navigationScope.clusterId,
      representatives: clusterRepresentatives,
      hierarchyChildren,
      focusNodeId: navigationScope.focusNodeId,
      expandedIds: expandedHierarchyIds
    });
    for (const id of [...matchedIds]) if (!navigationIds.has(id)) matchedIds.delete(id);
  } else if (!query && !graphQueryResult) {
    const navigationIds = navigationNodeIds(allNodes, allLinks, {
      scope: "overview",
      representatives: clusterRepresentatives,
      hierarchyChildren,
      overviewIds: overviewNodeIds,
      expandedIds: expandedHierarchyIds
    });
    for (const id of [...matchedIds]) if (!navigationIds.has(id)) matchedIds.delete(id);
  }
  links = allLinks.filter(link => types.has(link.type) && matchedIds.has(idOf(link.source)) && matchedIds.has(idOf(link.target)));
  nodes = allNodes.filter(node => matchedIds.has(node.id));
  empty.hidden = nodes.length > 0;
  if (selected && !matchedIds.has(selected.id)) resetDetails();
  simulation.nodes(nodes);
  simulation.force("link").links(links);
  simulation.force("chronology").y(node => chronologyTarget(node, wrap.getBoundingClientRect().height));
  simulation.alpha(1).restart();
  document.getElementById("node-count").textContent = `${nodes.length} nœuds`;
  document.getElementById("link-count").textContent = `${links.length} relations`;
  updateNodeAccessibilityList();
  if (query && exactNameMatches.length === 1) {
    selectNode(exactNameMatches[0]);
  } else if (query && directMatchIds.size === 1) {
    selectNode(allNodes.find(node => node.id === [...directMatchIds][0]));
  }
}

function updateNodeAccessibilityList() {
  const list = document.getElementById("node-a11y-list");
  const count = document.getElementById("node-a11y-count");
  if (!list || !count) return;
  count.textContent = `${nodes.length} nœud${nodes.length > 1 ? "s" : ""} visible${nodes.length > 1 ? "s" : ""}.`;
  const ordered = [...nodes].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  list.innerHTML = ordered.map(node =>
    `<li><button type="button" data-a11y-node="${escapeHtml(node.id)}">${escapeHtml(node.name)} — ${escapeHtml(node.typeLabel || node.nodeType)}</button></li>`
  ).join("");
}

document.getElementById("node-a11y-list")?.addEventListener("click", event => {
  const button = event.target.closest("[data-a11y-node]");
  if (!button) return;
  const node = allNodes.find(item => item.id === button.dataset.a11yNode);
  if (node) {
    selectNode(node);
    fitGraph(.85);
  }
});

searchInput.addEventListener("input", applyFilters);
relationInputs.forEach(input => input.addEventListener("change", applyFilters));
nodeTypeInputs.forEach(input => input.addEventListener("change", applyFilters));

document.getElementById("analysis-cards")?.addEventListener("click", event => {
  const button = event.target.closest("[data-focus-node]");
  if (!button) return;
  const node = allNodes.find(item => item.id === button.dataset.focusNode);
  if (!node) return;
  searchInput.value = node.name;
  applyFilters();
  document.querySelector(".node-inspector").scrollIntoView({ behavior: "smooth", block: "start" });
});

function showNamedCluster(clusterId) {
  hideClusterPresentation();
  navigationScope = { type: "cluster", clusterId };
  const seeds = allNodes.filter(node => node.clusterId === clusterId);
  const seedIds = new Set(seeds.map(node => node.id));
  const clusterNodes = seeds;
  const visibleClusterLinks = allLinks.filter(link => seedIds.has(idOf(link.source)) && seedIds.has(idOf(link.target)));
  const ordered = [...seeds].sort((a, b) => {
    const rank = node => node.nodeType === "source_document" ? 0
      : node.id === "thesis-civilization-substrate" ? 1
      : node.id.startsWith("endgame-pattern-") ? 2
      : node.id.startsWith("endgame-") ? 3
      : node.id.startsWith("pilot-") ? 4
      : node.id.startsWith("guardrail-") ? 5 : 6;
    return rank(a) - rank(b) || a.name.localeCompare(b.name, "fr");
  });
  graphQueryResult = {
    mode: "named",
    nodes: clusterNodes,
    links: visibleClusterLinks,
    results: ordered.map(node => ({
      nodeId: node.id,
      name: node.name,
      nodeTypeLabel: node.nodeTypeLabel,
      documentSection: node.documentSection,
      sourcePage: node.sourcePage,
      score: 1,
      semanticScore: 1,
      graphScore: 1,
      path: [node.name]
    }))
  };
  const picker = document.getElementById("named-cluster");
  if ([...picker.options].some(option => option.value === clusterId)) picker.value = clusterId;
  searchInput.value = "";
  document.getElementById("graph-question").value = "";
  renderGraphQuery(graphQueryResult);
  updateHierarchyNavigation();
  applyFilters();
  const url = new URL(window.location.href);
  url.searchParams.set("cluster", clusterId);
  history.replaceState(null, "", url);
  setTimeout(() => fitGraph(.22), 450);
}

document.getElementById("show-named-cluster").addEventListener("click", () => {
  showNamedCluster(document.getElementById("named-cluster").value);
});

document.getElementById("graph-query-form").addEventListener("submit", event => {
  event.preventDefault();
  const question = document.getElementById("graph-question").value.trim();
  if (!question || !graphQueryEngine) return;
  hideClusterPresentation();
  navigationScope = { type: "result", clusterId: null };
  graphQueryResult = graphQueryEngine.query(question);
  searchInput.value = "";
  renderGraphQuery(graphQueryResult);
  updateHierarchyNavigation();
  applyFilters();
  setTimeout(() => fitGraph(.45), 350);
});

document.getElementById("graph-query-clear").addEventListener("click", () => {
  showHierarchyOverview();
});

document.getElementById("graph-query-results").addEventListener("click", event => {
  const button = event.target.closest("[data-query-focus]");
  if (!button) return;
  const node = allNodes.find(item => item.id === button.dataset.queryFocus);
  if (node) selectNode(node);
});

document.getElementById("reset").addEventListener("click", () => {
  hideClusterPresentation();
  searchInput.value = "";
  relationInputs.forEach(input => input.checked = input.dataset.linkType !== "DERIVED_FROM");
  nodeTypeInputs.forEach(input => input.checked = true);
  navigationScope = { type: "overview", clusterId: null };
  expandedHierarchyIds.clear();
  graphQueryResult = null;
  document.getElementById("graph-question").value = "";
  renderGraphQuery(null);
  resetDetails();
  updateHierarchyNavigation();
  applyFilters();
  d3.select(canvas).transition().duration(350).call(zoom.transform, d3.zoomIdentity);
});

document.querySelectorAll("[data-bulk]").forEach(button => {
  button.addEventListener("click", () => {
    const inputs = button.dataset.bulk === "relation" ? relationInputs : nodeTypeInputs;
    const checked = button.dataset.bulkAction === "all";
    inputs.forEach(input => { input.checked = checked; });
    applyFilters();
  });
});

const filterPresets = {
  all: { relations: () => true, nodes: () => true },
  causal: {
    relations: type => ["CAUSES", "LEADS_TO", "FEEDS", "PRESSURES", "MITIGATES", "CONVERGES_IN", "GROUNDS", "UNLOCKS", "IMPLEMENTS", "BLOCKS", "MAKES_PLAUSIBLE", "SCENARIO_LEADS_TO", "AFFECTS_SCENARIO", "SAFEGUARDS"].includes(type),
    nodes: () => true
  },
  validation: {
    relations: type => ["TESTS", "ADDRESSES", "SUPPORTS_ESTIMATE", "CONTRADICTS", "OBSERVES", "PRODUCES", "USES_METHOD", "MEASURES", "USES_DATASET", "APPLIES_IN", "ASSUMES", "BLOCKS"].includes(type),
    nodes: () => true
  },
  work: {
    relations: type => ["PROMOTES_TO", "TARGETS", "DEPENDS_ON", "DOCUMENTS_PROGRESS", "OPTION_FOR", "RECOMMENDS", "BLOCKS", "ADDRESSES"].includes(type),
    nodes: () => true
  }
};

document.querySelectorAll("[data-preset]").forEach(button => {
  button.addEventListener("click", () => {
    const preset = filterPresets[button.dataset.preset];
    if (!preset) return;
    relationInputs.forEach(input => { input.checked = preset.relations(input.dataset.linkType); });
    nodeTypeInputs.forEach(input => { input.checked = preset.nodes(input.dataset.nodeType); });
    applyFilters();
  });
});

const legendPanel = document.querySelector(".legend");
const legendToggle = document.getElementById("legend-toggle");
legendToggle?.addEventListener("click", () => {
  const show = legendPanel.hidden;
  legendPanel.hidden = !show;
  legendToggle.setAttribute("aria-pressed", String(show));
});

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

const exportStamp = () => new Date().toISOString().slice(0, 10);

document.getElementById("export-png")?.addEventListener("click", () => {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0b0b0a";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  exportCtx.drawImage(canvas, 0, 0);
  exportCanvas.toBlob(blob => { if (blob) downloadBlob(`mind-graph-${exportStamp()}.png`, blob); }, "image/png");
});

document.getElementById("export-json")?.addEventListener("click", () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    scope: navigationScope,
    counts: { nodes: nodes.length, links: links.length },
    nodes: nodes.map(node => ({ id: node.id, name: node.name, nodeType: node.nodeType, clusterId: node.clusterId || null })),
    links: links.map(link => ({ source: idOf(link.source), target: idOf(link.target), type: link.type }))
  };
  downloadBlob(`mind-graph-${exportStamp()}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
});

document.getElementById("fit").addEventListener("click", () => fitGraph(.12));

const fullscreenButton = document.getElementById("fullscreen");
fullscreenButton.addEventListener("click", () => {
  if (document.fullscreenElement === wrap) {
    document.exitFullscreen();
  } else if (wrap.requestFullscreen) {
    wrap.requestFullscreen();
  }
});

document.addEventListener("fullscreenchange", () => {
  const isFullscreen = document.fullscreenElement === wrap;
  wrap.classList.toggle("is-fullscreen", isFullscreen);
  fullscreenButton.textContent = isFullscreen ? "Quitter le plein écran" : "Plein écran";
  fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
  resize();
});

function fitGraph(minScale = .65) {
  if (!nodes.length) return;
  const xs = nodes.map(node => node.x || 0);
  const ys = nodes.map(node => node.y || 0);
  const minX = Math.min(...xs) - 130;
  const maxX = Math.max(...xs) + 130;
  const minY = Math.min(...ys) - 80;
  const maxY = Math.max(...ys) + 80;
  const rect = wrap.getBoundingClientRect();
  const scale = Math.max(minScale, Math.min(1.25, .9 / Math.max((maxX - minX) / rect.width, (maxY - minY) / rect.height)));
  const tx = rect.width / 2 - scale * (minX + maxX) / 2;
  const ty = rect.height / 2 - scale * (minY + maxY) / 2;
  d3.select(canvas).transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

async function load() {
  const status = document.getElementById("db-status");
  try {
    const response = await fetch("/api/graph");
    if (!response.ok) throw new Error((await response.json()).error || response.statusText);
    const data = await response.json();
    const healthResponse = await fetch("/api/runtime-health").catch(() => null);
    if (healthResponse?.ok) {
      const health = await healthResponse.json();
      healthByTarget = new Map((health.statuses || []).map(item => [item.targetId, item]));
    }
    allNodes = data.nodes.map(node => ({ ...node }));
    installTermReferences(document.body, allNodes);
    allNodes.forEach(nodeSize);
    allLinks = data.links.map(link => ({ ...link }));
    clusterRepresentatives = buildClusterRepresentatives(allNodes, allLinks);
    hierarchyChildren = buildHierarchyChildren(allLinks);
    overviewNodeIds = buildOverviewNodeIds(allNodes, allLinks, clusterRepresentatives, hierarchyChildren, 32);
    graphQueryEngine = buildGraphQueryEngine(allNodes, allLinks);
    renderGraphQuery(null);
    updateHierarchyNavigation();
    status.textContent = "FalkorDB connecté";
    status.className = "status ok";
    const url = new URL(window.location.href);
    const requestedCluster = url.searchParams.get("cluster");
    const requestedFocus = url.searchParams.get("focus") || url.searchParams.get("node");
    if (requestedCluster && allNodes.some(node => node.clusterId === requestedCluster)) {
      showNamedCluster(requestedCluster);
    } else if (requestedFocus && allNodes.some(node => node.id === requestedFocus)) {
      const focusedNode = allNodes.find(node => node.id === requestedFocus);
      searchInput.value = focusedNode.name;
      applyFilters();
      selectNode(focusedNode);
      setTimeout(() => fitGraph(.85), 500);
    } else {
      applyFilters();
      setTimeout(() => fitGraph(.65), 900);
    }
  } catch (error) {
    status.textContent = "FalkorDB indisponible";
    status.className = "status error";
    empty.hidden = false;
    empty.textContent = `Impossible de charger le graphe : ${error.message}`;
  }
}

load();
