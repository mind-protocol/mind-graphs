const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
})[character]);

const statusLabels = { proposed: "proposée", in_review: "en revue", approved: "approuvée", rejected: "rejetée", deferred: "différée", superseded: "remplacée" };

const governanceChoices = [
  ["◆", "Décisions de première classe", "Une décision possède son propre type, un statut, un responsable, une échéance et une preuve de clôture."],
  ["⋔", "Options séparées", "Chaque alternative est un nœud comparable avec bénéfices, risques et conditions."],
  ["★", "Recommandation ≠ approbation", "Une relation RECOMMENDS indique une préférence argumentée sans changer le statut de la décision."],
  ["▤", "Provenance durable", "Les feedbacks sources sont archivés localement et protégés par une empreinte SHA-256."],
  ["⚗", "Pilotes mesurables", "Les propositions cliniques et scientifiques sont reliées à des contextes et métriques explicites."]
];

function idOf(value) { return typeof value === "object" ? value?.id : value; }

function render(graph, ontology) {
  const nodes = graph.nodes || [];
  const links = graph.links || [];
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const decisions = nodes.filter(node => node.nodeType === "decision").sort((a, b) => String(a.decisionDue).localeCompare(String(b.decisionDue)) || a.name.localeCompare(b.name, "fr"));
  const approved = decisions.filter(node => node.decisionStatus === "approved");
  const inReview = decisions.filter(node => node.decisionStatus === "in_review");
  const proposed = decisions.filter(node => node.decisionStatus === "proposed");
  const optionsByDecision = new Map(decisions.map(node => [node.id, []]));
  links.filter(link => link.type === "OPTION_FOR").forEach(link => {
    const option = nodeById.get(idOf(link.source));
    if (option && optionsByDecision.has(idOf(link.target))) optionsByDecision.get(idOf(link.target)).push(option);
  });
  const recommendationByDecision = new Map();
  links.filter(link => link.type === "RECOMMENDS").forEach(link => recommendationByDecision.set(idOf(link.target), nodeById.get(idOf(link.source))));
  const recommendedOptionIds = new Set(links.filter(link => link.type === "IMPLEMENTS" && nodeById.get(idOf(link.target))?.nodeType === "decision_option").map(link => idOf(link.target)));

  document.getElementById("schema-version").textContent = `schéma ${ontology.schemaVersion}`;
  document.getElementById("decision-state").innerHTML = `<strong>${approved.length}</strong><span>décision stratégique actée</span><small>${decisions.length - approved.length} restent à arbitrer</small>`;
  document.getElementById("decision-totals").innerHTML = `
    <span><strong>${decisions.length}</strong> suivies</span>
    <span><strong>${approved.length}</strong> approuvées</span>
    <span><strong>${inReview.length}</strong> en revue</span>
    <span><strong>${proposed.length}</strong> proposées</span>
    <span><strong>${[...optionsByDecision.values()].flat().length}</strong> options</span>`;
  document.getElementById("governance-decisions").innerHTML = governanceChoices.map(([symbol, title, description], index) => `
    <article><span>${symbol}</span><small>ACTÉ · ${String(index + 1).padStart(2, "0")}</small><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></article>`).join("");
  document.getElementById("strategic-decisions").innerHTML = decisions.map((decision, index) => {
    const options = (optionsByDecision.get(decision.id) || []).sort((a, b) => String(a.optionCode).localeCompare(String(b.optionCode)));
    const recommendation = recommendationByDecision.get(decision.id);
    const isApproved = decision.decisionStatus === "approved";
    return `<article class="strategic-card status-${escapeHtml(decision.decisionStatus)}">
      <header><span>${String(index + 1).padStart(2, "0")}</span><div><small>${escapeHtml(statusLabels[decision.decisionStatus] || decision.decisionStatus)}</small><h3>${escapeHtml(decision.name.replace(/^Décision requise · /, ""))}</h3></div><b>${escapeHtml(decision.decisionDue || "échéance à fixer")}</b></header>
      <p class="strategic-question">${escapeHtml(decision.phrase)}</p>
      <div class="strategic-meta"><span><small>Responsable</small>${escapeHtml(decision.responsibleRole)}</span><span><small>Option retenue</small>${escapeHtml(decision.chosenOptionId || "aucune")}</span></div>
      ${recommendation ? `<div class="current-recommendation"><small>Recommandation actuelle</small><strong>${escapeHtml(recommendation.name.replace(/^Recommandation · /, ""))}</strong><p>${escapeHtml(recommendation.summary)}</p></div>` : ""}
      <div class="recap-options">${options.map(option => `<section class="${recommendedOptionIds.has(option.id) ? "recommended" : ""}"><div><b>Option ${escapeHtml(option.optionCode)}</b>${recommendedOptionIds.has(option.id) ? "<em>recommandée</em>" : ""}</div><strong>${escapeHtml(option.name.replace(/^Option [A-Z] · /, ""))}</strong><p>${escapeHtml(option.summary)}</p></section>`).join("")}</div>
      <footer><p><strong>${isApproved ? "Justification actée" : "Pourquoi ce n’est pas encore décidé"}</strong>${escapeHtml(isApproved ? decision.decisionRationale : "Aucune option retenue et aucune justification d’approbation enregistrée.")}</p><a href="/?focus=${encodeURIComponent(decision.id)}">Voir dans le graphe →</a></footer>
    </article>`;
  }).join("");
}

async function load() {
  try {
    const [graphResponse, ontologyResponse] = await Promise.all([fetch("/api/graph"), fetch("/api/ontology")]);
    if (!graphResponse.ok) throw new Error(`graphe HTTP ${graphResponse.status}`);
    if (!ontologyResponse.ok) throw new Error(`ontologie HTTP ${ontologyResponse.status}`);
    render(await graphResponse.json(), await ontologyResponse.json());
  } catch (error) {
    document.getElementById("decisions-error").textContent = `Impossible de charger le registre de décisions : ${error.message}`;
  }
}

load();
