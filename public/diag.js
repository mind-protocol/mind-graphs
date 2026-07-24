/**
 * L1 Subentities & IRM Diagnostic Engine
 * Multi-Tick Sequence Simulator, Dynamic Activity Stream & Actionable Remediation Engine.
 */

const dynamicTicksHistory = [];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }
  return response.json();
}

function updateStatusBanner(healthy, statusText, drift) {
  const pill = document.getElementById("global-status-pill");
  const text = document.getElementById("global-status-text");
  const badge = document.getElementById("projection-drift-badge");
  const time = document.getElementById("last-check-time");

  time.textContent = `Dernier contrôle : ${new Date().toLocaleTimeString("fr-FR")}`;

  pill.className = "status-pill " + (healthy ? "status-healthy" : "status-warning");
  text.textContent = statusText;

  if (drift === "current" || !drift) {
    badge.textContent = "Drift: Conforme (0)";
    badge.className = "badge";
  } else {
    badge.textContent = `Drift: ${drift}`;
    badge.className = "badge status-warning";
  }
}

function renderMetrics(summary, stateData) {
  const activeCountEl = document.getElementById("metric-active-count");
  const splitEl = document.getElementById("metric-high-low-split");
  const pressureValEl = document.getElementById("metric-capacity-pressure");
  const progressFillEl = document.getElementById("capacity-progress-fill");
  const controllerEl = document.getElementById("metric-controller");
  const controllerAttrEl = document.getElementById("metric-controller-attribution");
  const projStatusEl = document.getElementById("metric-projection-status");
  const revInfoEl = document.getElementById("metric-revision-info");

  const subentities = stateData?.state?.subentities || summary?.subentities || [];
  const activeList = subentities.filter(e => e.status !== "merged");
  const highLevel = activeList.filter(e => e.level === "high").length;
  const lowLevel = activeList.filter(e => e.level !== "high").length;

  activeCountEl.textContent = activeList.length;
  splitEl.textContent = `High: ${highLevel} | Low: ${lowLevel}`;

  // Capacity pressure sigmoid calculation
  const target = 10;
  const softness = 2.5;
  const x = (highLevel - target) / softness;
  const pressureRatio = 1 / (1 + Math.exp(-x));
  const pressurePct = Math.round(pressureRatio * 100);

  pressureValEl.textContent = `${pressurePct}%`;
  progressFillEl.style.width = `${pressurePct}%`;

  // Workspace controller
  const snapshots = stateData?.state?.workspaceSnapshots || [];
  const latestSnapshot = snapshots[snapshots.length - 1];
  const primaryController = latestSnapshot?.controllers?.find(c => c.active && c.attribution === "primary");

  if (primaryController) {
    controllerEl.textContent = primaryController.subentityId;
    controllerAttrEl.textContent = `Confiance: ${Math.round((primaryController.confidence || 1) * 100)}%`;
  } else {
    controllerEl.textContent = "Aucun (Shared)";
    controllerAttrEl.textContent = "Statut: Équilibré / Non capturé";
  }

  // Projection drift
  const projectionStatus = summary?.projection?.status || stateData?.meta?.projectionStatus || "current";
  const revision = stateData?.revision ?? stateData?.state?.revision ?? "--";

  projStatusEl.textContent = projectionStatus.toUpperCase();
  revInfoEl.textContent = `Révision d'état: ${revision}`;
}

function renderSubentities(stateData) {
  const container = document.getElementById("subentities-list");
  const subentities = stateData?.state?.subentities || [];

  if (!subentities.length) {
    container.innerHTML = `<div class="empty-state">Aucune sous-entité active enregistrée dans le graphe L1.</div>`;
    return;
  }

  container.innerHTML = subentities.map(entity => {
    const isHigh = entity.level === "high";
    const isMerged = entity.status === "merged";
    const tagClass = isMerged ? "tag-merged" : (isHigh ? "tag-high" : "tag");
    const weight = entity.weight ?? 1;
    const stability = Math.round((entity.stability ?? 0.5) * 100);
    const certainty = Math.round((entity.certainty ?? 0.5) * 100);

    return `
      <div class="entity-item">
        <div class="entity-info">
          <div class="entity-title">${entity.id} ${isMerged ? `<span class="tag">Fusionné ➔ ${entity.supersededBy}</span>` : ""}</div>
          <div class="entity-tags">
            <span class="${tagClass}">${entity.level || "low"}</span>
            <span class="tag">Poids: ${weight}</span>
            <span class="tag">Stabilité: ${stability}%</span>
            <span class="tag">Certitude: ${certainty}%</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderAudit(stateData) {
  const auditContainer = document.getElementById("conflicts-audit");
  const subentities = stateData?.state?.subentities || [];
  const conflicting = subentities.filter(e => e.conflicts && e.conflicts.length > 0);

  if (!conflicting.length) {
    auditContainer.innerHTML = `<div class="empty-state">Aucun conflit actif détecté. Les sous-entités de haut niveau coexistent sans suppression autoritaire.</div>`;
    return;
  }

  auditContainer.innerHTML = conflicting.map(e => `
    <div class="entity-item">
      <div class="entity-info">
        <div class="entity-title">${e.id} en dissentement</div>
        <div class="entity-tags">
          ${e.conflicts.map(c => `<span class="tag tag-high">Avec ${c.with} (Évidence conservée)</span>`).join(" ")}
        </div>
      </div>
    </div>
  `).join("");
}

function renderWorkspaceAudit(stateData) {
  const snapshots = stateData?.state?.workspaceSnapshots || [];
  const latest = snapshots[snapshots.length - 1];

  const activeBidEl = document.getElementById("ws-active-bid");
  const slotsEl = document.getElementById("ws-support-slots");
  const residenceEl = document.getElementById("ws-residence-ticks");
  const monopolizationEl = document.getElementById("ws-monopolization-status");

  if (!latest) {
    activeBidEl.textContent = "Aucun snapshot récent";
    slotsEl.textContent = "0 slot";
    residenceEl.textContent = "0 tick";
    monopolizationEl.textContent = "Nominal (Pas de Task Lock)";
    return;
  }

  const primary = latest.controllers?.find(c => c.active);
  const alternatives = latest.controllers?.filter(c => c.active && c !== primary) || [];

  activeBidEl.textContent = primary ? primary.subentityId : "Aucune";
  slotsEl.textContent = `${alternatives.length} slot(s) alternatif(s)`;
  residenceEl.textContent = `${latest.residenceTicks || 1} tick(s)`;
  
  if ((latest.residenceTicks || 0) > 8) {
    monopolizationEl.textContent = "Attention : Résidence élevée (Malus appliqué)";
    monopolizationEl.style.color = "var(--color-warning)";
  } else {
    monopolizationEl.textContent = "Nominal (Pas de Task Lock)";
    monopolizationEl.style.color = "var(--color-success)";
  }
}

function renderActivityStream() {
  const container = document.getElementById("dynamic-activity-stream");
  const ticksCountEl = document.getElementById("dynamic-ticks-count");

  ticksCountEl.textContent = dynamicTicksHistory.length;

  if (!dynamicTicksHistory.length) {
    container.innerHTML = `<div class="empty-state">Cliquez sur "5 Ticks" ou "10 Ticks Séquentiels" pour observer la dynamique d'activation, la fluctuation d'énergie et les transitions de contrôleurs.</div>`;
    return;
  }

  container.innerHTML = dynamicTicksHistory.slice().reverse().map(item => `
    <div class="activity-item">
      <span class="tick-id">⚡ ${item.tickId}</span>
      <span class="tick-meta">Micro-ticks: ${item.microTicks} | Stop: ${item.stopReason} | Candidate: ${item.candidateId || "auto"}</span>
      <span class="badge">${item.time}</span>
    </div>
  `).join("");
}

function renderRemediations(testFailures, summaryData, stateData) {
  const container = document.getElementById("remediation-container");
  const remediations = [];

  // Check 1: Projection Drift
  const projectionStatus = summaryData?.projection?.status || stateData?.meta?.projectionStatus || "current";
  if (projectionStatus !== "current") {
    remediations.push({
      type: "fail",
      title: "Dérive de Projection FalkorDB (`repair_required`)",
      reason: "La révision d'état enregistrée en mémoire diffère de la projection matérialisée dans la base FalkorDB.",
      solution: "Lancez la commande de réparation automatique dans votre terminal : <code>npm run l1:subentities:falkor --repair</code> ou réinitialisez la révision via l'endpoint de réconciliation."
    });
  }

  // Check 2: High Level Overpopulation
  const highLevelCount = (stateData?.state?.subentities || []).filter(e => e.status !== "merged" && e.level === "high").length;
  if (highLevelCount > 15) {
    remediations.push({
      type: "warning",
      title: "Surpopulation de Sous-entités Haut Niveau",
      reason: `Le nombre de sous-entités actives de haut niveau (${highLevelCount}) dépasse la cible d'équilibre de 10.`,
      solution: "La pression sigmoïdale de capacité augmente automatiquement le coût de promotion. Pour consolider, déclenchez une réconciliation manuelle via <code>reconcileSubentities()</code>."
    });
  }

  // Check 3: Task Lock / Monopolization
  const snapshots = stateData?.state?.workspaceSnapshots || [];
  const latestSnapshot = snapshots[snapshots.length - 1];
  const residence = latestSnapshot?.residenceTicks || 0;

  if (residence > 8) {
    remediations.push({
      type: "warning",
      title: "Alerte de Monopolisation du Workspace (Task Lock)",
      reason: `La même sous-entité (${latestSnapshot?.controllers?.[0]?.subentityId || "active"}) réside dans le Global Workspace depuis ${residence} ticks consécutifs.`,
      solution: "Injectez un nouveau stimulus sensoriel avec un score de nouveauté (<code>novelty = 1</code>) pour activer la pénalité de monopolisation et forcer le remplacement du contrôleur."
    });
  }

  // Check 4: Test Assertion Failures
  for (const failure of testFailures) {
    remediations.push({
      type: "fail",
      title: `Échec de Vérification : ${failure.test}`,
      reason: failure.error || "Erreur de contrat d'API ou indisponibilité du service.",
      solution: "Vérifiez que le serveur principal est démarré avec <code>npm run dev</code> et que FalkorDB réagit sur le port 6379."
    });
  }

  if (!remediations.length) {
    container.innerHTML = `
      <div class="remediation-card status-healthy-card">
        <div class="remediation-header">
          <span class="status-icon">✔</span>
          <h3>Aucune anomalie critique détectée</h3>
        </div>
        <p class="remediation-body">Le runtime L1 fonctionne nominalement : pas de dérive de projection, population sous les seuils critiques d'attraction, et alternance attentionnelle équilibrée.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = remediations.map(r => `
    <div class="remediation-card ${r.type === "fail" ? "fail-card" : "warning-card"}">
      <div class="remediation-header">
        <span class="status-icon">${r.type === "fail" ? "✖" : "⚠️"}</span>
        <h3>${r.title}</h3>
      </div>
      <div class="remediation-reason"><strong>Raison :</strong> ${r.reason}</div>
      <div class="remediation-solution"><strong>Solution :</strong> ${r.solution}</div>
    </div>
  `).join("");
}

async function runDiagnosticSuite() {
  const testsList = document.getElementById("diag-tests-list");
  const rawOutput = document.getElementById("raw-json-output");
  
  const testFailures = [];

  const updateTestItem = (index, title, pass, detail) => {
    const items = testsList.querySelectorAll("li");
    if (items[index]) {
      items[index].className = `test-item ${pass ? "pass" : "fail"}`;
      items[index].textContent = `${title} : ${detail}`;
    }
  };

  let summaryData = null;
  let stateData = null;

  // Test 1: Endpoint Summary
  try {
    summaryData = await fetchJson("/api/l1/subentities/summary");
    updateTestItem(0, "Endpoint Summary (/summary)", true, "Succès (200 OK)");
  } catch (err) {
    updateTestItem(0, "Endpoint Summary (/summary)", false, err.message);
    testFailures.push({ test: "Endpoint Summary", error: err.message });
  }

  // Test 2: Endpoint State
  try {
    stateData = await fetchJson("/api/l1/subentities/state");
    updateTestItem(1, "Endpoint State (/state)", true, `Révision ${stateData.revision ?? 0}`);
  } catch (err) {
    updateTestItem(1, "Endpoint State (/state)", false, err.message);
    testFailures.push({ test: "Endpoint State", error: err.message });
  }

  // Test 3: Falkor Projection Status
  const projectionStatus = summaryData?.projection?.status || stateData?.meta?.projectionStatus || "current";
  const projectionOk = projectionStatus === "current";
  updateTestItem(2, "Projection FalkorDB", projectionOk, projectionOk ? "Conforme (0 drift)" : `Dérive détectée (${projectionStatus})`);
  if (!projectionOk) testFailures.push({ test: "Projection FalkorDB", error: `Statut = ${projectionStatus}` });

  // Test 4: Invariants & Attractors
  const highLevelCount = (stateData?.state?.subentities || []).filter(e => e.status !== "merged" && e.level === "high").length;
  const invariantOk = highLevelCount <= 20;
  updateTestItem(3, "Invariants d'Attraction Souple", invariantOk, `Population haut niveau = ${highLevelCount} (Cible: 10)`);
  if (!invariantOk) testFailures.push({ test: "Invariants d'Attraction Souple", error: `Population haut niveau = ${highLevelCount}` });

  // Update UI components
  const allHealthy = testFailures.length === 0 && projectionOk;
  updateStatusBanner(allHealthy, allHealthy ? "Système L1 Sain & Opérationnel" : "Avertissement ou Dérive Détectée", projectionStatus);
  renderMetrics(summaryData, stateData);
  renderSubentities(stateData);
  renderAudit(stateData);
  renderWorkspaceAudit(stateData);
  renderRemediations(testFailures, summaryData, stateData);

  const fullReport = {
    timestamp: new Date().toISOString(),
    status: allHealthy ? "HEALTHY" : "WARNING",
    failures: testFailures,
    summary: summaryData,
    state: stateData
  };

  rawOutput.textContent = JSON.stringify(fullReport, null, 2);
}

async function runMultiTicksSequence(count) {
  const progressFill = document.getElementById("multi-tick-progress");
  const btn5 = document.getElementById("btn-run-5-ticks");
  const btn10 = document.getElementById("btn-run-10-ticks");

  btn5.disabled = true;
  btn10.disabled = true;

  for (let i = 1; i <= count; i++) {
    progressFill.style.width = `${Math.round((i / count) * 100)}%`;
    const tickId = `tick-seq-${Date.now()}-${i}`;
    
    try {
      const res = await fetchJson("/api/l1/subentities/integrated-ticks/until-stable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickId, observationId: `obs-seq-${i}` })
      });

      dynamicTicksHistory.push({
        tickId,
        microTicks: res.report?.microTickCount || res.stabilization?.history?.length || 1,
        stopReason: res.report?.stopReason || res.stabilization?.stopReason || "stable",
        candidateId: res.detection?.observation?.candidateId || "auto-coalition",
        time: new Date().toLocaleTimeString("fr-FR")
      });
    } catch (e) {
      dynamicTicksHistory.push({
        tickId,
        microTicks: 0,
        stopReason: "error",
        candidateId: e.message,
        time: new Date().toLocaleTimeString("fr-FR")
      });
    }

    renderActivityStream();
    await new Promise(r => setTimeout(r, 120)); // Subtle pause between ticks for smooth visual effect
  }

  btn5.disabled = false;
  btn10.disabled = false;
  progressFill.style.width = "100%";

  await runDiagnosticSuite();
}

// Event Listeners
document.getElementById("btn-run-diag").addEventListener("click", runDiagnosticSuite);
document.getElementById("btn-run-5-ticks").addEventListener("click", () => runMultiTicksSequence(5));
document.getElementById("btn-run-10-ticks").addEventListener("click", () => runMultiTicksSequence(10));
document.getElementById("btn-copy-json").addEventListener("click", () => {
  const text = document.getElementById("raw-json-output").textContent;
  navigator.clipboard.writeText(text);
  alert("Rapport JSON copié dans le presse-papier !");
});

// Auto-start diagnostic on page load
runDiagnosticSuite();
