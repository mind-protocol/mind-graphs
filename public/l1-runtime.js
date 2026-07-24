const byId = id => document.getElementById(id);
const empty = () => byId("empty-template").content.cloneNode(true);
const unit = value => Math.max(0, Math.min(1, Number(value) || 0));
const label = value => String(value || "—").replaceAll("_", " ");

function replaceChildren(id, children) {
  const target = byId(id);
  target.replaceChildren(...(children.length ? children : [empty()]));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderStats(counts) {
  const labels = { active:"actives", highLevel:"niveau haut", candidates:"candidates", merged:"fusionnées", narratives:"narratifs", moments:"moments" };
  replaceChildren("stats", Object.entries(labels).map(([key, text]) => {
    const card = element("article", "stat");
    card.append(element("strong", "", counts?.[key] || 0), element("span", "", text));
    return card;
  }));
}

function meter(name, value) {
  const node = element("span", "meter", `${name} · ${unit(value).toFixed(2)}`);
  const bar = element("i");
  bar.style.setProperty("--value", `${unit(value) * 100}%`);
  node.append(bar);
  return node;
}

let currentCockpitSubentityId = null;

async function executeCockpitAction(actionObj, subentityId) {
  const action = typeof actionObj === "string" ? actionObj : actionObj.id;
  const query = currentGraph ? `?graph=${encodeURIComponent(currentGraph)}` : "";
  const body = { action, subentityId, reasoning: `Action '${action}' exécutée depuis le Cockpit` };

  if (action === "set_attention_head") {
    const val = prompt("Entrez l'ID du nœud à placer en tête d'attention :");
    if (!val) return;
    body.nodeId = val.trim();
  } else if (action === "admit_node" || action === "remove_node") {
    const val = prompt(`Entrez l'ID du nœud à ${action === "admit_node" ? "faire entrer au" : "retirer du"} périmètre :`);
    if (!val) return;
    body.nodeId = val.trim();
  } else if (action === "create_node") {
    const nodeId = prompt("ID du nouveau nœud (ex: node-idee) :");
    if (!nodeId) return;
    const label = prompt("Nom / Label du nœud :", nodeId);
    const semanticType = prompt("Type sémantique (Thing, Moment, Narrative, Actor, Space) :", "Thing");
    body.nodeId = nodeId.trim();
    body.label = (label || nodeId).trim();
    body.semanticType = (semanticType || "Thing").trim();
  } else if (action === "inject_node_energy" || action === "direct_energy") {
    const targetNodeId = prompt("ID du nœud cible dans lequel diriger l'énergie :");
    if (!targetNodeId) return;
    const percentStr = prompt("Pourcentage d'énergie à allouer (10, 25, 50, 75, 100 %) :", "50");
    if (!percentStr) return;
    body.nodeId = targetNodeId.trim();
    body.energyPercentage = Number(percentStr.replace("%", "").trim()) || 50;
  } else if (action === "create_relation") {
    const sourceNodeId = prompt("ID du nœud source :", subentityId);
    if (!sourceNodeId) return;
    const targetNodeId = prompt("ID du nœud cible :");
    if (!targetNodeId) return;
    const relationType = prompt("Type de relation (ACTIVATES, OCCUPIES, SUPPORTS_EMERGENCE, SUPERSEDES, PERCEIVED_BY...) :", "ACTIVATES");
    body.sourceNodeId = sourceNodeId.trim();
    body.targetNodeId = targetNodeId.trim();
    body.relationType = (relationType || "ACTIVATES").trim();
  }

  try {
    const response = await fetch(`/api/l1/subentities/manual-control${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    await openCockpit(subentityId);
    await refresh();
  } catch (error) {
    alert(`Erreur d'action cockpit : ${error.message}`);
  }
}

async function openCockpit(subentityId) {
  currentCockpitSubentityId = subentityId;
  const modal = byId("cockpit-modal");
  const bodyNode = byId("cockpit-body");
  const titleNode = byId("cockpit-title");
  if (!modal || !bodyNode) return;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  bodyNode.innerHTML = `<p class="loading">Chargement du cockpit pour ${subentityId}...</p>`;

  const query = currentGraph ? `&graph=${encodeURIComponent(currentGraph)}` : "";
  try {
    const res = await fetch(`/api/l1/subentities/cockpit?id=${encodeURIComponent(subentityId)}${query}`, { cache: "no-store" });
    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({}));
      throw new Error(errPayload.error || `HTTP ${res.status}`);
    }
    const data = await res.json();

    titleNode.textContent = `Cockpit · ${data.subentity.name || data.subentity.id}`;
    bodyNode.replaceChildren();

    // Recommandation Algorithmique
    const recBanner = element("div", "recommendation-banner");
    recBanner.append(
      element("strong", "", `💡 Recommandation Algorithmique : ${data.recommendation.label}`),
      element("span", "", data.recommendation.reason)
    );

    // Prompt / Mission Box
    const promptBox = element("div", "cockpit-box prompt-box");
    promptBox.append(
      element("h4", "", "Mission & Prompt Opérationnel"),
      element("div", "prompt-text", data.subentity.missionPrompt)
    );

    // Grid Container
    const grid = element("div", "cockpit-grid");

    // Senses & Perimeter Box
    const sensesBox = element("div", "cockpit-box");
    sensesBox.append(element("h4", "", "Sensation & Périmètre"));
    const nodesList = element("div", "nodes-tag-list");
    if (data.perception.activeNodeIds.length) {
      data.perception.activeNodeIds.forEach(nodeId => {
        nodesList.append(element("span", "node-tag", nodeId));
      });
    } else {
      nodesList.append(element("span", "meta", "Aucun nœud actif au périmètre"));
    }
    sensesBox.append(
      element("p", "meta", `Affect dominant: ${label(data.subentity.dominantAffect || "aucun")}`),
      nodesList,
      element("p", "meta", `${data.perception.visibleRelations.length} arêtes sémantiques visibles`)
    );

    // State Machine Box
    const stateBox = element("div", "cockpit-box");
    stateBox.append(
      element("h4", "", `Machine à États · ${data.stateMachine.icon} ${data.stateMachine.label}`),
      element("p", "meta", `Règle : ${data.stateMachine.rule}`),
      element("p", "meta", data.stateMachine.doing)
    );
    const meters = element("div", "meters");
    meters.append(
      meter("poids", 1 - Math.exp(-(Number(data.subentity.weight) || 0) / 4)),
      meter("stabilité", data.subentity.stability),
      meter("certitude", data.subentity.certainty)
    );
    stateBox.append(meters);

    // Actions Box
    const actionsBox = element("div", "cockpit-box");
    actionsBox.append(element("h4", "", "Choix des Actions (Contrôle Manuel)"));
    const actionsList = element("div", "action-buttons-list");

    data.availableActions.forEach(act => {
      const btn = element("button", `action-btn ${act.current ? "current" : ""}`);
      btn.type = "button";
      btn.append(
        element("span", "action-btn-title", `${act.current ? "✓ " : ""}${act.label}`),
        element("span", "action-btn-desc", act.description)
      );
      btn.addEventListener("click", () => executeCockpitAction(act, subentityId));
      actionsList.append(btn);
    });

    actionsBox.append(actionsList);

    grid.append(sensesBox, stateBox, actionsBox);
    bodyNode.append(recBanner, promptBox, grid);
  } catch (error) {
    bodyNode.innerHTML = `<p class="empty-state">Échec du chargement du cockpit : ${error.message}</p>`;
  }
}

function closeCockpit() {
  const modal = byId("cockpit-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

async function toggleManualControl(subentityId, isCurrentlyControlled) {
  const query = currentGraph ? `?graph=${encodeURIComponent(currentGraph)}` : "";
  const body = isCurrentlyControlled
    ? { action: "clear" }
    : { action: "set", subentityId, reasoning: "Prise de contrôle manuel via l'interface UI" };

  try {
    const response = await fetch(`/api/l1/subentities/manual-control${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    await refresh();
  } catch (error) {
    alert(`Erreur de contrôle manuel : ${error.message}`);
  }
}

function renderSubentities(items, controllers, manualControl = null) {
  const controllerIds = new Set(controllers.map(controller => controller.subentityId));
  const activeManualId = manualControl?.active ? manualControl.subentityId : null;

  replaceChildren("subentities", items.map(item => {
    const card = element("article", "card");
    const isManuallyControlled = activeManualId === item.id;
    const head = element("div", "card-head");

    let badgeText = label(item.level);
    let badgeClass = "badge";
    if (isManuallyControlled) {
      badgeText = "CONTRÔLE MANUEL";
      badgeClass = "badge manual-control";
    } else if (controllerIds.has(item.id)) {
      badgeText = "contrôle";
    }

    head.append(element("h3", "", item.name || item.id), element("span", badgeClass, badgeText));
    const meta = element("p", "meta", `${item.observationCount || 0} observations · affect ${label(item.dominantAffect)}`);
    const meters = element("div", "meters");
    meters.append(meter("poids", 1 - Math.exp(-(Number(item.weight) || 0) / 4)), meter("stabilité", item.stability), meter("certitude", item.certainty));

    const actionsContainer = element("div", "card-actions");
    actionsContainer.style.display = "flex";
    actionsContainer.style.gap = ".4rem";

    const cockpitBtn = element("button", "btn-manual-control active", "Cockpit 🎛️");
    cockpitBtn.type = "button";
    cockpitBtn.addEventListener("click", () => openCockpit(item.id));

    const btn = element(
      "button",
      `btn-manual-control ${isManuallyControlled ? "active" : ""}`,
      isManuallyControlled ? "Libérer le contrôle" : "Prendre le contrôle"
    );
    btn.type = "button";
    btn.addEventListener("click", () => toggleManualControl(item.id, isManuallyControlled));

    actionsContainer.append(cockpitBtn, btn);
    card.append(head, meta, meters, actionsContainer);
    return card;
  }));
}

function renderControllers(controllers, latestMoment, subentities, manualControl = null) {
  const bySubentity = new Map(subentities.map(item => [item.id, item]));
  const nodes = [];

  if (manualControl?.active) {
    const banner = element("div", "manual-banner");
    const info = element("span", "", `Contrôle manuel actif : ${manualControl.subentityName || manualControl.subentityId}`);
    const releaseBtn = element("button", "btn-manual-control active", "Libérer");
    releaseBtn.type = "button";
    releaseBtn.addEventListener("click", () => toggleManualControl(manualControl.subentityId, true));
    banner.append(info, releaseBtn);
    nodes.push(banner);
  }

  controllers.forEach(controller => {
    const card = element("article", "card");
    const entity = bySubentity.get(controller.subentityId);
    const isManual = manualControl?.active && manualControl.subentityId === controller.subentityId;
    const modeLabel = isManual ? "mode manuel" : label(controller.attribution);
    card.append(
      element("h3", "", `${entity?.name || controller.subentityId}${isManual ? " (Contrôle Manuel)" : ""}`),
      element("p", "meta", `${modeLabel} · confiance ${unit(controller.confidence).toFixed(2)} · Moment ${latestMoment?.id || "—"}`)
    );
    nodes.push(card);
  });

  replaceChildren("controllers", nodes);
}

function renderEvents(events) {
  replaceChildren("events", events.map(event => {
    const card = element("article", "card");
    card.append(element("h3", "", label(event.type)), element("p", "meta", `${event.subentityId || event.survivorId || ""} · ${event.recordedAt || event.tickId || ""}`));
    return card;
  }));
}

function renderNarratives(narratives) {
  replaceChildren("narratives", narratives.map(narrative => {
    const card = element("article", "card");
    card.append(element("h3", "", narrative.name || narrative.id), element("p", "meta", narrative.description || "Narratif inféré"));
    return card;
  }));
}

const metricLabel = value => typeof value === "number" ? (value >= 0 && value <= 1 ? value.toFixed(2) : String(value)) : String(value ?? "—");

async function reviewProposal(proposalId, verdict) {
  const response = await fetch("/api/l1/subentities/shadow/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposalId, verdict })
  });
  if (!response.ok) throw new Error(`Review HTTP ${response.status}`);
  await refresh();
}

function renderShadow(data) {
  byId("shadow-status").textContent = `shadow r${data.revision} · L1 observé r${data.authoritativeRevision}`;
  const selectedMetrics = [
    ["ticks", data.metrics.totalTicks],
    ["propositions", data.metrics.proposals],
    ["pression fragmentation", data.metrics.fragmentationPressure],
    ["couverture contrôleur", data.metrics.controllerCoverage],
    ["acceptation revue", data.metrics.reviewAcceptanceRate]
  ];
  replaceChildren("shadow-metrics", selectedMetrics.map(([name, value]) => {
    const node = element("article", "shadow-metric");
    node.append(element("strong", "", metricLabel(value)), element("span", "", name));
    return node;
  }));
  replaceChildren("shadow-proposals", data.proposals.map(proposal => {
    const card = element("article", "card proposal");
    const head = element("div", "card-head");
    head.append(element("h3", "", label(proposal.type)), element("span", "badge", proposal.tickId));
    card.append(head, element("p", "meta", proposal.rationale || "Proposition shadow"));
    if (proposal.review) {
      card.append(element("p", "reviewed", `Revue · ${label(proposal.review.verdict)}`));
    } else {
      const actions = element("div", "review-actions");
      for (const [verdict, text] of [["accepted", "Accepter"], ["rejected", "Rejeter"], ["uncertain", "Incertain"]]) {
        const button = element("button", "", text);
        button.type = "button";
        button.addEventListener("click", () => reviewProposal(proposal.id, verdict).catch(error => { byId("shadow-status").textContent = error.message; }));
        actions.append(button);
      }
      card.append(actions);
    }
    return card;
  }));
}

let currentGraph = new URLSearchParams(window.location.search).get("graph") || "";

async function initGraphSelector() {
  const select = byId("l1-graph-select");
  const switchBtn = byId("l1-graph-switch-btn");
  if (!select || !switchBtn) return;

  try {
    const response = await fetch("/api/l1/graphs");
    if (response.ok) {
      const { graphs } = await response.json();
      select.replaceChildren();
      if (graphs && graphs.length) {
        for (const g of graphs) {
          const opt = document.createElement("option");
          opt.value = g.falkorGraph || g.id;
          opt.textContent = `${g.label || g.id} (${g.falkorGraph || g.id})`;
          if (currentGraph && (currentGraph === g.falkorGraph || currentGraph === g.id)) {
            opt.selected = true;
          }
          select.append(opt);
        }
        if (!currentGraph && select.value) {
          currentGraph = select.value;
        }
      }
    }
  } catch (error) {
    console.warn("Échec de chargement des graphes L1:", error);
  }

  const applyGraphChange = async () => {
    if (select.value) {
      currentGraph = select.value;
      const url = new URL(window.location.href);
      url.searchParams.set("graph", currentGraph);
      window.history.replaceState({}, "", url);
      await refresh();
    }
  };

  switchBtn.addEventListener("click", applyGraphChange);
  select.addEventListener("change", applyGraphChange);
}

async function refresh() {
  const connection = byId("connection");
  const query = currentGraph ? `?graph=${encodeURIComponent(currentGraph)}` : "";
  try {
    const [summaryResponse, shadowResponse] = await Promise.all([
      fetch(`/api/l1/subentities/summary${query}`, { cache: "no-store" }),
      fetch(`/api/l1/subentities/shadow${query}`, { cache: "no-store" })
    ]);
    if (!summaryResponse.ok) throw new Error(`Summary HTTP ${summaryResponse.status}`);
    if (!shadowResponse.ok) throw new Error(`Shadow HTTP ${shadowResponse.status}`);
    const [data, shadow] = await Promise.all([summaryResponse.json(), shadowResponse.json()]);
    connection.className = `status ${data.projection.status === "current" ? "current" : "error"}`;
    connection.textContent = data.projection.status === "current" ? `Révision ${data.revision} · ${currentGraph || "graphe par défaut"}` : `Révision ${data.revision} · projection à réparer`;
    renderStats(data.counts);
    renderSubentities(data.activeSubentities, data.controllers, data.manualControl);
    renderControllers(data.controllers, data.latestMoment, data.activeSubentities, data.manualControl);
    renderEvents(data.recentEvents);
    renderNarratives(data.narratives);
    renderShadow(shadow);
  } catch (error) {
    connection.className = "status error";
    connection.textContent = `Runtime indisponible · ${error.message}`;
  }
}

byId("cockpit-close-btn")?.addEventListener("click", closeCockpit);
byId("cockpit-modal")?.addEventListener("click", e => { if (e.target === byId("cockpit-modal")) closeCockpit(); });

await initGraphSelector();
await refresh();
setInterval(refresh, 5000);
