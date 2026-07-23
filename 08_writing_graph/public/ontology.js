import { iconForNode, iconForRelation } from "./iconography.js";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
})[character]);

const humanize = value => String(value ?? "").replaceAll("_", " ");

function constraintLabel(ontology, relationId) {
  const constraint = ontology.relationConstraints?.[relationId];
  if (!constraint) return "non défini";
  if (constraint.allowAny) return "tout type compatible";
  const side = name => [
    ...(constraint[`${name}Groups`] || []).map(group => `groupe:${humanize(group)}`),
    ...(constraint[`${name}Types`] || []).map(humanize)
  ].join(", ");
  return `${side("source")} → ${side("target")}`;
}

function renderOntology(ontology) {
  document.getElementById("schema-version").textContent = `schéma v${ontology.schemaVersion}`;
  document.getElementById("ontology-stats").innerHTML = `
    <span><strong>${ontology.nodeTypes.length}</strong> types de nœuds</span>
    <span><strong>${ontology.relationTypes.length}</strong> prédicats</span>
    <span><strong>${ontology.relationFamilies.length}</strong> familles de relations</span>
    <span><strong>${ontology.epistemicStatuses.length}</strong> statuts</span>`;

  document.getElementById("principle-list").innerHTML = ontology.principles
    .map((principle, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(principle)}</p></li>`).join("");

  document.getElementById("node-types").innerHTML = ontology.nodeTypes.map(type => `
    <article class="ontology-card">
      <div class="card-meta"><code>${escapeHtml(type.id)}</code><span>${escapeHtml(humanize(type.family))}</span></div>
      <h3><span class="ontology-type-icon" aria-hidden="true">${iconForNode(type.id)}</span>${escapeHtml(type.label)}</h3>
      <p>${escapeHtml(type.description)}</p>
      <small>Statut initial · ${escapeHtml(humanize(type.epistemicStatus))}</small>
    </article>`).join("");

  const relationsByFamily = new Map(ontology.relationFamilies.map(family => [family.id, []]));
  ontology.relationTypes.forEach(relation => relationsByFamily.get(relation.family)?.push(relation));
  document.getElementById("relation-families").innerHTML = ontology.relationFamilies.map(family => `
    <details class="relation-family">
      <summary>
        <span><strong>${escapeHtml(family.label)}</strong><small>${escapeHtml(family.description)}</small></span>
        <b>${relationsByFamily.get(family.id).length}</b>
      </summary>
      <div class="relation-table-wrap"><table>
        <thead><tr><th>Prédicat</th><th>Sens</th><th>Types autorisés</th><th>Portée</th><th>Nature</th></tr></thead>
        <tbody>${relationsByFamily.get(family.id).map(relation => `
          <tr>
            <td><code>${escapeHtml(relation.id)}</code><strong><span class="ontology-type-icon" aria-hidden="true">${iconForRelation(relation.id)}</span>${escapeHtml(relation.label)}</strong></td>
            <td>${escapeHtml(relation.direction)}</td>
            <td>${escapeHtml(constraintLabel(ontology, relation.id))}</td>
            <td>${escapeHtml(humanize(relation.scope))}</td>
            <td><span class="relation-nature ${relation.causalClaim ? "is-causal" : ""}">${relation.causalClaim ? "causal" : "structurel"}</span>${relation.status === "reserved" ? `<span class="reserved">réservé</span>` : ""}</td>
          </tr>`).join("")}</tbody>
      </table></div>
    </details>`).join("");

  document.getElementById("epistemic-statuses").innerHTML = ontology.epistemicStatuses.map(status => `
    <article><code>${escapeHtml(status.id)}</code><h3>${escapeHtml(status.label)}</h3><p>${escapeHtml(status.meaning)}</p></article>`).join("");

  const measures = Object.entries(ontology.quantification).filter(([, value]) => !Array.isArray(value));
  document.getElementById("quantification").innerHTML = measures.map(([id, measure]) => `
    <article class="measure-card">
      <div><code>${escapeHtml(id)}</code><span>${escapeHtml(measure.unit)}</span></div>
      <p>${escapeHtml(measure.definition)}</p>
      ${measure.formula ? `<pre>${escapeHtml(measure.formula)}</pre>` : ""}
      <small>Requiert · ${measure.requires.map(humanize).map(escapeHtml).join(" · ")}</small>
    </article>`).join("");

  document.getElementById("traversal-definition").textContent = ontology.traversal.definition;
  document.getElementById("traversal-weights").innerHTML = Object.entries(ontology.traversal.familyDefaults)
    .sort((a, b) => b[1] - a[1])
    .map(([family, weight]) => `<div><span>${escapeHtml(humanize(family))}</span><i><b style="width:${weight * 100}%"></b></i><strong>${weight.toFixed(2)}</strong></div>`).join("");
}

async function loadOntology() {
  let lastError;
  for (const url of ["/api/ontology", "/graph-ontology.json"]) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} · HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

loadOntology()
  .then(renderOntology)
  .catch(error => {
    document.getElementById("schema-version").textContent = "indisponible";
    document.getElementById("ontology-error").textContent = `Impossible de charger l’ontologie : ${error.message}`;
  });
