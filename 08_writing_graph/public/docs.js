// Documentation consultable avec valeurs live.
// Le contenu vient des fichiers .md du projet (via /api/docs) ; les jetons {{stats.*}}
// et {{ontology.*}} sont résolus à l'affichage depuis /api/graph et /api/ontology,
// pour qu'aucun chiffre ne dérive quel que soit l'état rédigé du fichier.

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
})[character]);

let tokens = {};
let graphIndex = { nodeIds: new Set(), clusterIds: new Set(), nameById: new Map() };

function buildGraphIndex(graph) {
  const nodeIds = new Set();
  const clusterIds = new Set();
  const nameById = new Map();
  for (const node of graph.nodes) {
    nodeIds.add(node.id);
    nameById.set(node.id, node.name);
    if (node.clusterId) clusterIds.add(node.clusterId);
  }
  return { nodeIds, clusterIds, nameById };
}

// Syntaxe explicite : [[node:id]] · [[cluster:id]] · [[id]] (nœud par défaut) → lien vers le graphe.
function linkifyWikiSyntax(markdown) {
  return markdown.replace(/\[\[(?:(node|cluster):)?([^\]|]+)\]\]/g, (match, kind, rawId) => {
    const id = rawId.trim();
    const param = kind === "cluster" ? "cluster" : "node";
    const label = graphIndex.nameById.get(id) || id;
    return `[${label}](/?${param}=${encodeURIComponent(id)})`;
  });
}

// Après rendu : tout code inline égal à un id de nœud ou de cluster connu devient un lien vers le graphe.
function crossLinkCodeSpans(container) {
  for (const code of container.querySelectorAll("code")) {
    if (code.closest("pre")) continue;
    const text = code.textContent.trim();
    let href = null;
    let title = null;
    if (graphIndex.nodeIds.has(text)) {
      href = `/?node=${encodeURIComponent(text)}`;
      title = `Ouvrir « ${graphIndex.nameById.get(text) || text} » dans le graphe`;
    } else if (graphIndex.clusterIds.has(text)) {
      href = `/?cluster=${encodeURIComponent(text)}`;
      title = `Ouvrir le cluster « ${text} » dans le graphe`;
    }
    if (!href) continue;
    const link = document.createElement("a");
    link.href = href;
    link.className = "doc-graph-link";
    link.title = title;
    link.append(code.cloneNode(true));
    code.replaceWith(link);
  }
}

async function fetchOntology() {
  for (const url of ["/api/ontology", "/graph-ontology.json"]) {
    const response = await fetch(url);
    if (response.ok) return response.json();
  }
  throw new Error("ontologie indisponible");
}

function computeStats(graph, ontology) {
  const relationFamilies = ontology.relationFamilies?.length
    ?? new Set(ontology.relationTypes.map(type => type.family)).size;
  return {
    "stats.nodes": graph.nodes.length,
    "stats.links": graph.links.length,
    "stats.nodeTypes": ontology.nodeTypes.length,
    "stats.relationFamilies": relationFamilies,
    "stats.activePredicates": ontology.relationTypes.filter(type => type.status === "active").length,
    "stats.reservedPredicates": ontology.relationTypes.filter(type => type.status === "reserved").length,
    "ontology.version": ontology.schemaVersion
  };
}

function resolveTokens(markdown) {
  return markdown.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? String(tokens[key]) : match
  );
}

function renderCorpus() {
  const section = document.getElementById("docs-corpus");
  const stats = document.getElementById("docs-corpus-stats");
  const stamp = document.getElementById("docs-corpus-stamp");
  const cells = [
    ["ontologie", tokens["ontology.version"]],
    ["nœuds", tokens["stats.nodes"]],
    ["relations", tokens["stats.links"]],
    ["types de nœuds", tokens["stats.nodeTypes"]],
    ["familles de relations", tokens["stats.relationFamilies"]],
    ["prédicats actifs", tokens["stats.activePredicates"]]
  ];
  stats.innerHTML = cells.map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong>${escapeHtml(label)}</span>`).join("");
  stamp.textContent = new Date().toLocaleString("fr-FR");
  section.hidden = false;
}

function renderNav(docs, activeSlug) {
  const nav = document.getElementById("docs-nav");
  nav.innerHTML = docs.map(doc =>
    `<a href="/docs.html?doc=${encodeURIComponent(doc.slug)}" data-doc="${escapeHtml(doc.slug)}" class="${doc.slug === activeSlug ? "active" : ""}">${escapeHtml(doc.title)}</a>`
  ).join("");
}

async function renderDoc(slug) {
  const article = document.getElementById("docs-article");
  article.innerHTML = `<p class="docs-loading">Chargement de « ${escapeHtml(slug)} »…</p>`;
  try {
    const response = await fetch(`/api/docs/${encodeURIComponent(slug)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const markdown = await response.text();
    article.innerHTML = window.marked.parse(resolveTokens(linkifyWikiSyntax(markdown)));
    crossLinkCodeSpans(article);
  } catch (error) {
    article.innerHTML = `<p class="docs-error" role="alert">Impossible de charger ce document : ${escapeHtml(error.message)}</p>`;
  }
}

function setActive(slug) {
  document.querySelectorAll("#docs-nav a").forEach(link => {
    link.classList.toggle("active", link.dataset.doc === slug);
  });
}

async function load() {
  try {
    const [graphResponse, ontology, docsResponse] = await Promise.all([
      fetch("/api/graph"),
      fetchOntology(),
      fetch("/api/docs")
    ]);
    if (graphResponse.ok) {
      const graph = await graphResponse.json();
      graphIndex = buildGraphIndex(graph);
      tokens = computeStats(graph, ontology);
      renderCorpus();
    }
    if (!docsResponse.ok) throw new Error(`HTTP ${docsResponse.status}`);
    const { docs } = await docsResponse.json();
    if (!docs.length) {
      document.getElementById("docs-article").innerHTML = "<p class=\"docs-loading\">Aucun document disponible.</p>";
      return;
    }
    const requested = new URL(window.location.href).searchParams.get("doc");
    const activeSlug = docs.some(doc => doc.slug === requested) ? requested
      : docs.find(doc => doc.slug === "README")?.slug || docs[0].slug;
    renderNav(docs, activeSlug);
    await renderDoc(activeSlug);

    document.getElementById("docs-nav").addEventListener("click", event => {
      const link = event.target.closest("a[data-doc]");
      if (!link) return;
      event.preventDefault();
      const slug = link.dataset.doc;
      setActive(slug);
      renderDoc(slug);
      const url = new URL(window.location.href);
      url.searchParams.set("doc", slug);
      history.pushState({ slug }, "", url);
    });

    window.addEventListener("popstate", () => {
      const slug = new URL(window.location.href).searchParams.get("doc") || activeSlug;
      setActive(slug);
      renderDoc(slug);
    });
  } catch (error) {
    document.getElementById("docs-article").innerHTML = `<p class="docs-error" role="alert">Impossible de charger la documentation : ${escapeHtml(error.message)}</p>`;
  }
}

load();
