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

function renderSubentities(items, controllers) {
  const controllerIds = new Set(controllers.map(controller => controller.subentityId));
  replaceChildren("subentities", items.map(item => {
    const card = element("article", "card");
    const head = element("div", "card-head");
    head.append(element("h3", "", item.name || item.id), element("span", "badge", controllerIds.has(item.id) ? "contrôle" : label(item.level)));
    const meta = element("p", "meta", `${item.observationCount || 0} observations · affect ${label(item.dominantAffect)}`);
    const meters = element("div", "meters");
    meters.append(meter("poids", 1 - Math.exp(-(Number(item.weight) || 0) / 4)), meter("stabilité", item.stability), meter("certitude", item.certainty));
    card.append(head, meta, meters);
    return card;
  }));
}

function renderControllers(controllers, latestMoment, subentities) {
  const bySubentity = new Map(subentities.map(item => [item.id, item]));
  replaceChildren("controllers", controllers.map(controller => {
    const card = element("article", "card");
    const entity = bySubentity.get(controller.subentityId);
    card.append(element("h3", "", entity?.name || controller.subentityId), element("p", "meta", `${label(controller.attribution)} · confiance ${unit(controller.confidence).toFixed(2)} · Moment ${latestMoment?.id || "—"}`));
    return card;
  }));
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
    renderSubentities(data.activeSubentities, data.controllers);
    renderControllers(data.controllers, data.latestMoment, data.activeSubentities);
    renderEvents(data.recentEvents);
    renderNarratives(data.narratives);
    renderShadow(shadow);
  } catch (error) {
    connection.className = "status error";
    connection.textContent = `Runtime indisponible · ${error.message}`;
  }
}

await initGraphSelector();
await refresh();
setInterval(refresh, 5000);
