// Carte du cerveau, vue de dessus.
//
// Chaque sous-entité est posée au barycentre de son champ attentionnel, projeté
// depuis l'espace vectoriel réel. Une transition CSS relie deux positions
// *mesurées* : l'animation interpole entre deux ticks, elle n'invente aucun
// mouvement entre les deux.
const SVG_NS = "http://www.w3.org/2000/svg";
const byId = id => document.getElementById(id);
const unit = value => Math.max(0, Math.min(1, Number(value) || 0));
const label = value => String(value ?? "—").replaceAll("_", " ");
const shortId = value => String(value || "").length > 38 ? `${String(value).slice(0, 35)}…` : String(value || "—");

const VIEW = { width: 1600, height: 900, pad: 120 };

// Cadrage collant. Le plan vectoriel est projeté dans [-1,1]², mais le contenu
// réel n'en occupe souvent qu'un petit coin : sans zoom, tout se tasse au
// centre et les textes se recouvrent. Le cadrage s'ajuste donc au contenu —
// puis il **reste figé** tant que le contenu y tient. Sinon la vue se
// recadrerait à chaque tick et tout semblerait bouger alors que rien n'aurait
// bougé. Le zoom est uniforme : il change la focale, jamais la géométrie.
let viewport = null;

function fitViewport(points) {
  if (!points.length) return;
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.05);
  const spanY = Math.max(maxY - minY, 0.05);
  const scale = Math.min((VIEW.width - 2 * VIEW.pad) / spanX, (VIEW.height - 2 * VIEW.pad) / spanY);
  const next = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale };

  if (!viewport) { viewport = next; return; }
  // On ne recadre que si le contenu déborde, ou s'il est devenu si petit que la
  // carte serait presque vide.
  const projected = points.map(point => project(point));
  const escapes = projected.some(point =>
    point.x < VIEW.pad * 0.5 || point.x > VIEW.width - VIEW.pad * 0.5
    || point.y < VIEW.pad * 0.5 || point.y > VIEW.height - VIEW.pad * 0.5);
  const tooSmall = scale > viewport.scale * 3;
  if (escapes || tooSmall) viewport = next;
}

function project(point) {
  if (!viewport) return { x: VIEW.width / 2, y: VIEW.height / 2 };
  return {
    x: VIEW.width / 2 + (Number(point.x || 0) - viewport.cx) * viewport.scale,
    y: VIEW.height / 2 + (Number(point.y || 0) - viewport.cy) * viewport.scale
  };
}

// Anti-recouvrement : un texte qui heurterait un texte déjà posé est décalé
// verticalement, et abandonné s'il ne trouve pas de place. Mieux vaut une
// étiquette absente qu'une bouillie illisible.
function createLabelPlacer() {
  const placed = [];
  return (x, y, width, height) => {
    for (const offset of [0, -18, 18, -34, 34, -52, 52, -70, 70]) {
      const box = { left: x, top: y + offset - height, right: x + width, bottom: y + offset };
      const hits = placed.some(other =>
        box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
      if (!hits) { placed.push(box); return y + offset; }
    }
    return null;
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  return node;
}

function replaceChildren(id, children) {
  const target = byId(id);
  target.replaceChildren(...(children.length ? children : [byId("empty-template").content.cloneNode(true)]));
}

function row(name, value) {
  const node = element("div", "row");
  node.append(element("span", "", name), element("span", "", value === null || value === undefined ? "—" : String(value)));
  return node;
}

function unmeasured(block, fallback = "Non mesuré.") {
  return element("p", "unmeasured", block?.reason ? `Non mesuré — ${block.reason}.` : fallback);
}

/** Polygone régulier ; `sides === 0` retombe sur le cercle, la forme par défaut. */
function shapeNode(shape, radius) {
  const sides = Number(shape?.sides) || 0;
  if (sides < 3) return svg("circle", { r: radius, class: "se-shape" });
  const rotation = ((Number(shape.rotation) || 0) * Math.PI) / 180;
  const points = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation - Math.PI / 2 + (index * 2 * Math.PI) / sides;
    points.push(`${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`);
  }
  return svg("polygon", { points: points.join(" "), class: "se-shape" });
}

// ── Carte ──────────────────────────────────────────────────────────────
let selectedId = null;
let lastFrame = null;
// Déplacements manuels, en unités du viewBox. Ils ne touchent jamais la
// position mesurée : la vraie place reste marquée et reliée par un fil, pour
// qu'un rangement à la main ne puisse pas se faire passer pour une mesure.
const manualOffsets = new Map();
let dragging = null;

function renderLandmarks(map) {
  const visible = byId("show-landmarks").checked;
  if (!visible) { byId("layer-landmarks").replaceChildren(); return; }
  const place = createLabelPlacer();
  const nodes = [];
  for (const landmark of map.landmarks || []) {
    if (!landmark.position) continue;
    const point = project(landmark.position);
    // Un repère hors cadre n'est pas ramené de force au bord : il serait faux.
    if (point.x < 0 || point.x > VIEW.width || point.y < 0 || point.y > VIEW.height) continue;
    const group = svg("g", { class: "landmark" });
    group.append(svg("circle", { cx: point.x, cy: point.y, r: 5, fill: `hsl(${landmark.hue} 70% 60%)`, opacity: .7 }));
    const y = place(point.x + 10, point.y + 5, landmark.clusterId.length * 6.5, 14);
    if (y !== null) {
      const text = svg("text", { x: point.x + 10, y, class: "landmark-label", fill: `hsl(${landmark.hue} 55% 68%)` });
      text.textContent = landmark.clusterId;
      group.append(text);
    }
    nodes.push(group);
  }
  byId("layer-landmarks").replaceChildren(...nodes);
}

function offsetOf(id) {
  return manualOffsets.get(id) || { dx: 0, dy: 0 };
}

// Mémoire de la trame précédente : elle sert uniquement à savoir *ce qui a
// changé*, pour le faire clignoter. Un clignotement signale donc toujours une
// différence réelle entre deux mesures.
let previous = { positions: new Map(), fields: new Map(), states: new Map() };

function diffAgainstPrevious(frame) {
  const movedSubentities = new Set();
  const changedStates = new Set();
  const freshNodes = new Set();
  for (const entity of frame.subentities) {
    const key = entity.position.measurementStatus === "derived"
      ? `${entity.position.x.toFixed(4)},${entity.position.y.toFixed(4)}`
      : "none";
    if (previous.positions.has(entity.id) && previous.positions.get(entity.id) !== key) movedSubentities.add(entity.id);
    if (previous.states.has(entity.id) && previous.states.get(entity.id) !== entity.state.id) changedStates.add(entity.id);
    const before = previous.fields.get(entity.id) || new Set();
    for (const node of entity.field.admitted || []) {
      if (previous.fields.has(entity.id) && !before.has(node.id)) freshNodes.add(`${entity.id}::${node.id}`);
    }
  }
  return { movedSubentities, changedStates, freshNodes };
}

function rememberFrame(frame) {
  previous = {
    positions: new Map(frame.subentities.map(entity => [
      entity.id,
      entity.position.measurementStatus === "derived" ? `${entity.position.x.toFixed(4)},${entity.position.y.toFixed(4)}` : "none"
    ])),
    fields: new Map(frame.subentities.map(entity => [entity.id, new Set((entity.field.admitted || []).map(node => node.id))])),
    states: new Map(frame.subentities.map(entity => [entity.id, entity.state.id]))
  };
}

const ROLE_CLASS = { lead: "lead", support: "support", silent: "silent" };

// Couleur par nature de relation. Ce n'est PAS une couleur d'émotion : aucun
// lien du graphe ne porte de vecteur affectif. La légende doit le dire.
const FAMILY_HUES = {
  workflow: 200, normative: 340, design_reasoning: 275, hierarchy: 45,
  evidence: 150, validation: 100, flow: 185, scenario: 20,
  contextual: 300, enablement: 65
};
const familyHue = family => FAMILY_HUES[family] ?? null;

/**
 * Calcule la teinte HSL (.hue) de l'émotion / affect du lien.
 *
 * 🔴 Rouge / Rose Vif   : Conflit, Inhibition, Risque, Alerte, Frustration, Peur (CONSTRAINS, INHIBITS, RISK, WARNS, CONTRADICTS, OVERLOAD)
 * 🟢 Vert Émeraude      : Soin, Protection, Confiance, Sécurité, Apaisement (PROTECTS, JUSTIFIES, SOOTHES, TRUSTS, REPAIRS, RESPONDS_TO_NEED)
 * 🟣 Violet / Magenta   : Drive, Motivation, Ambition, Passion, Énergie (MOTIVATES, DRIVES, EXERCISES, ATTRACTS, DESIRES, CREATES)
 * 🟡 Ambre / Doré       : Attention, Perceptions, Nouveauté, Curiosité (SENSORY, ATTENDS, PERCEIVES, DISCOVERS, OBSERVES)
 * 🔵 Cyan / Bleu Néon   : Cognition, Structure, Provenance, Description (AUTHORED_BY, DESCRIBES, CONVERGES_IN, CONFIGURES, MODULATES)
 */
function edgeEmotionHue(edge, frame) {
  const type = String(edge.predicate || edge.type || "").toUpperCase();
  const kinds = (edge.flowKinds || []).map(k => String(k).toLowerCase());
  const family = String(edge.family || "").toLowerCase();

  // 1. Détection directe par type / prédicat de relation
  if (/INHIBIT|CONSTRAIN|CONTRADICT|RISK|FAIL|CONFLICT|WARN|DENY|RESTRICT|CRISIS|PRESSURE|OVERLOAD/i.test(type)) {
    return 348; // 🔴 Rouge / Crimson (Tension / Inhibition / Risque)
  }
  if (/PROTECT|JUSTIFY|SOOTHE|TRUST|CONFIRM|HEAL|REPAIR|SUPPORT|SAFE|CARE|AFFINITY|NEED/i.test(type)) {
    return 158; // 🟢 Vert Émeraude / Turquoise (Soin / Protection / Confiance)
  }
  if (/MOTIVATE|DRIVE|EXERCISE|ATTRACT|DESIRE|CREATE|PROMOT|GOAL|WANT|PASSION/i.test(type)) {
    return 282; // 🟣 Violet / Magenta (Drive / Intentionalité / Motivation)
  }
  if (/SENSORY|ATTEND|PERCEIVE|OBSERVE|DISCOVER|EMERGE|NOVELTY|STIMUL/i.test(type)) {
    return 42;  // 🟡 Ambre Doré / Jaune (Attention / Perception / Nouveauté)
  }

  // 2. Détection par type de flux (flowKinds)
  if (kinds.some(k => /inhibition|risk|conflict|fear|anxiety|anger/i.test(k))) return 348;
  if (kinds.some(k => /care|soothe|trust|safety|heal|calm/i.test(k))) return 158;
  if (kinds.some(k => /drive|motivation|desire|passion|goal/i.test(k))) return 282;
  if (kinds.some(k => /sensory|stimulus|attention|curiosity/i.test(k))) return 42;

  // 3. Détection par famille de relation
  if (family === "normative" || family === "inhibition") return 348;
  if (family === "validation" || family === "enablement") return 158;
  if (family === "scenario" || family === "drive") return 282;
  if (family === "contextual" || family === "sensory") return 42;

  // 4. Couleur du lien selon l'émotion de la sous-entité source (si colocalisée)
  if (frame?.subentities) {
    const holder = frame.subentities.find(e =>
      (e.field?.admitted || []).some(n => n.id === edge.source || n.id === edge.target)
    );
    if (holder && typeof holder.hue === "number") {
      return holder.hue;
    }
  }

  // 5. Défaut bleu cyan pour la structure cognitive
  return familyHue(edge.family) ?? 195;
}

/** Arêtes vivantes entre les nœuds affichés, colorées par l'émotion et la valence du lien. */
function renderEdges(frame, positions) {
  const energy = frame.energy || {};
  const edges = [];
  const flows = [];

  // Satellites : nœuds hors champ attentionnel mais reliés par une arête vivante.
  for (const satellite of energy.satellites || []) {
    const point = project(satellite.position);
    positions.set(satellite.id, point);
    edges.push(svg("circle", { cx: point.x, cy: point.y, r: 5, class: "satellite", "data-node": satellite.id }));
  }

  for (const edge of energy.edges || []) {
    const from = positions.get(edge.source);
    const to = positions.get(edge.target);
    if (!from || !to) continue;
    const hue = edgeEmotionHue(edge, frame);
    const stroke = `hsl(${hue} 85% 62%)`;
    // Épaisseur et opacité suivent l'énergie stockée, relative à la plus chaude.
    const share = energy.maxEdgeEnergy ? edge.energy / energy.maxEdgeEnergy : 0;
    const line = svg("line", {
      x1: from.x, y1: from.y, x2: to.x, y2: to.y,
      stroke, "stroke-width": 1.4 + 4.2 * share, "stroke-opacity": .35 + .55 * share,
      class: "energy-edge",
      "data-source": edge.source,
      "data-target": edge.target,
      "data-hue": hue
    });

    const emotionLabel =
      hue === 348 ? "Tension / Inhibition / Risque (🔴)"
      : hue === 158 ? "Soin / Protection / Confiance (🟢)"
      : hue === 282 ? "Drive / Motivation / Intention (🟣)"
      : hue === 42 ? "Attention / Nouveauté / Perception (🟡)"
      : "Structure / Cognition (🔵)";

    const title = svg("title");
    title.textContent = `${edge.predicate || edge.type} · ${edge.family || "famille"}\n`
      + `Émotion / Valence : ${emotionLabel}\n`
      + `Énergie ${edge.energy.toFixed(4)} · transfert ${edge.flow.toFixed(4)}`
      + `${edge.flowKinds.length ? ` (${edge.flowKinds.join(", ")})` : ""}`;
    line.append(title);
    edges.push(line);

    if (edge.flow > 0) flows.push({ edge, from, to, stroke, hue });
  }
  byId("layer-edges").replaceChildren(...edges);
  pendingFlows = flows;
  renderEnergyStatus(frame, edges.length, flows.length);
}

function renderEnergyStatus(frame, edgeCount, flowCount) {
  const energy = frame.energy || {};
  const box = byId("energy-status");
  const children = [];
  if (energy.measurementStatus === "observed") {
    children.push(element("strong", "", `Physique L4 · ${edgeCount} lien(s) vivant(s)`));
    children.push(element("span", "", `${flowCount} transfert(s) actif(s) · ${energy.summary?.totalEnergy ? energy.summary.totalEnergy.toFixed(4) : "0"} E au total`));
  } else {
    children.push(element("strong", "warn", "Énergie non mesurée"));
    children.push(element("span", "", energy.reason || "aucune donnée physique"));
    children.push(element("span", "", "La luminosité des nœuds reste neutre : elle n'affiche pas un zéro qui n'a pas été mesuré."));
  }
  children.push(element("span", "dim", energy.affectOnLinks?.reason || ""));
  box.replaceChildren(...children);
  renderFamilyLegend(frame);
}

function renderFamilyLegend(frame) {
  const legend = byId("family-legend");
  const children = [element("p", "family-title", "Émotion & Valence des liens")];

  const emotionTypes = [
    { label: "Tension / Risque / Inhibition", color: "#ff3b5c" },
    { label: "Soin / Protection / Confiance", color: "#10b981" },
    { label: "Drive / Motivation / Intention", color: "#d946ef" },
    { label: "Attention / Nouveauté / Vigilance", color: "#f59e0b" },
    { label: "Structure / Cognition", color: "#38bdf8" }
  ];

  for (const emotion of emotionTypes) {
    const row = element("span", "legend-item");
    const swatch = element("i", "legend-family");
    swatch.style.background = emotion.color;
    swatch.style.boxShadow = `0 0 8px ${emotion.color}`;
    row.append(swatch, document.createTextNode(emotion.label));
    children.push(row);
  }
  legend.replaceChildren(...children);
}

function renderSubentities(frame) {
  const showNodes = byId("show-nodes").checked;
  const showLabels = byId("show-labels").checked;
  const changes = diffAgainstPrevious(frame);

  // Le cadrage tient compte des sous-entités et de tous leurs nœuds.
  const plotted = [];
  for (const entity of frame.subentities) {
    if (entity.position.measurementStatus === "derived") plotted.push(entity.position);
    for (const node of entity.field.admitted || []) if (node.position) plotted.push(node.position);
  }
  fitViewport(plotted);

  const fields = [];
  const labels = [];
  const bodies = [];
  const auras = [];
  const bubbles = [];
  const nodePositions = new Map();
  const place = createLabelPlacer();

  for (const entity of frame.subentities) {
    if (entity.position.measurementStatus !== "derived") continue;
    const anchor = project(entity.position);
    const offset = offsetOf(entity.id);
    const x = anchor.x + offset.dx;
    const y = anchor.y + offset.dy;
    const moved = offset.dx !== 0 || offset.dy !== 0;
    const hue = entity.hue ?? null;
    const stroke = hue === null ? "#9fb2cc" : `hsl(${hue} 90% 68%)`;
    const fill = hue === null ? "rgba(159,178,204,.4)" : `hsl(${hue} 85% 55% / .6)`;
    const role = ROLE_CLASS[entity.doing.role] || "silent";

    // La constellation : chaque nœud admis, relié au centre de gravité.
    if (showNodes) {
      const field = svg("g", { class: "field" });
      // Les nœuds admis, puis ceux de la frontière du champ.
      const fieldNodes = [
        ...(entity.field.admitted || []).map(node => ({ node, zone: "admitted" })),
        ...(entity.field.periphery || []).map(node => ({ node, zone: "periphery" }))
      ];
      for (const { node, zone } of fieldNodes) {
        if (!node.position) continue;
        const point = project(node.position);
        nodePositions.set(node.id, point);
        const shared = (node.sharedWith || []).length > 0;
        const fresh = changes.freshNodes.has(`${entity.id}::${node.id}`);
        // La luminosité suit l'énergie mesurée. Sans mesure, le nœud garde une
        // luminosité neutre : il n'est pas affiché « éteint », ce qui ferait
        // croire à une énergie nulle mesurée.
        const measured = typeof node.brightness === "number";
        const glow = measured ? node.brightness : null;
        const radius = (zone === "periphery" ? 3.5 : 5) + 7 * node.alignment + (measured ? 6 * glow : 0);
        field.append(svg("line", {
          x1: x, y1: y, x2: point.x, y2: point.y, stroke,
          "stroke-opacity": (zone === "periphery" ? .18 : .5) * node.alignment + (zone === "periphery" ? .08 : .25),
          "stroke-dasharray": zone === "periphery" ? "5 5" : null
        }));
        if (measured && glow > 0.02) {
          field.append(svg("circle", {
            cx: point.x, cy: point.y, r: radius + 10 + 16 * glow,
            fill: stroke, "fill-opacity": (0.05 + 0.22 * glow).toFixed(3), class: "node-glow"
          }));
        }
        const dot = svg("circle", {
          cx: point.x, cy: point.y, r: radius,
          fill: stroke, "fill-opacity": measured ? (0.5 + 0.5 * glow).toFixed(3) : 0.75,
          class: `node-dot ${zone}${fresh ? " flash" : ""}${measured ? "" : " unmeasured-energy"}${shared ? " boundary" : ""}`,
          "data-node": node.id, "data-entity": entity.id
        });
        field.append(dot);
        // Un nœud tenu par plusieurs sous-entités est une frontière : il porte
        // un anneau qui n'appartient à aucune des deux couleurs.
        if (shared) {
          field.append(svg("circle", {
            cx: point.x, cy: point.y, r: radius + 6,
            fill: "none", class: "boundary-ring"
          }));
        }
        if (fresh) {
          field.append(svg("circle", { cx: point.x, cy: point.y, r: 5 + 7 * node.alignment, fill: "none", stroke, class: "halo" }));
        }
        if (showLabels) {
          // Le nom entier : le tronquer changerait ce que le nœud dit être.
          const text = node.name || node.id;
          const labelY = place(point.x + 13, point.y + 5, text.length * 6.2, 15);
          if (labelY !== null) {
            const node2 = svg("text", {
              x: point.x + 13, y: labelY,
              class: `node-label ${zone}${fresh ? " flash" : ""}${shared ? " boundary" : ""}`,
              fill: stroke
            });
            node2.textContent = text;
            labels.push(node2);
          }
        }
      }
      fields.push(field);
    }

    // Taille = masse du champ, bornée pour rester lisible.
    const radius = 24 + 22 * unit(entity.field.capacity ? entity.field.capacity.used / entity.field.capacity.maximum : 0);
    const flashing = changes.movedSubentities.has(entity.id) || changes.changedStates.has(entity.id);
    const group = svg("g", {
      class: `subentity ${role}${selectedId === entity.id ? " selected" : ""}${dragging?.id === entity.id ? " dragging" : ""}${flashing ? " flash" : ""}`,
      transform: `translate(${x},${y})`,
      tabindex: "0",
      role: "button"
    });

    // La position mesurée reste visible quand la forme a été rangée à la main.
    if (moved) {
      const tether = svg("g", { class: "tether" });
      tether.append(svg("line", { x1: anchor.x - x, y1: anchor.y - y, x2: 0, y2: 0, stroke, "stroke-dasharray": "5 5", "stroke-opacity": .85 }));
      tether.append(svg("circle", { cx: anchor.x - x, cy: anchor.y - y, r: 6, fill: "none", stroke, "stroke-dasharray": "3 3" }));
      group.append(tether);
    }

    // Appartenance au Global Workspace : la meneuse porte une couronne double,
    // le soutien un anneau simple, le silence un trait pointillé.
    if (role === "lead") {
      group.append(svg("circle", { r: radius + 10, fill: "none", stroke, "stroke-width": 2.5, "stroke-opacity": .9, class: "gw-ring" }));
      group.append(svg("circle", { r: radius + 16, fill: "none", stroke, "stroke-width": 1.2, "stroke-opacity": .5, class: "gw-ring" }));
    } else if (role === "support") {
      group.append(svg("circle", { r: radius + 10, fill: "none", stroke, "stroke-width": 1.6, "stroke-opacity": .65, "stroke-dasharray": "10 6", class: "gw-ring" }));
    }

    const shape = shapeNode(entity.state.shape || { sides: 0 }, radius);
    shape.setAttribute("fill", fill);
    shape.setAttribute("stroke", stroke);
    group.append(shape);
    if (entity.state.shape?.ring) group.append(svg("circle", { r: radius + 6, fill: "none", stroke, "stroke-opacity": .7 }));

    // Deux pastilles : le statut à gauche, l'émotion à droite.
    const status = svg("text", { class: "se-icon", x: -radius * 0.42, y: 9, "text-anchor": "middle" });
    status.textContent = entity.state.icon;
    group.append(status);

    if (entity.reading.feeling.smiley) {
      const smiley = svg("text", { class: "se-icon", x: radius * 0.42, y: 9, "text-anchor": "middle" });
      smiley.textContent = entity.reading.feeling.smiley;
      group.append(smiley);
    } else {
      // Une absence de mesure affective ne reçoit pas de visage : un visage
      // neutre serait une affirmation sur un état non mesuré.
      const blank = svg("circle", { cx: radius * 0.42, cy: 2, r: 8, fill: "none", stroke: "#9fb2cc", "stroke-dasharray": "3 3", "stroke-opacity": .8 });
      const blankTitle = svg("title");
      blankTitle.textContent = "Affect non mesuré — aucun visage n'est affiché plutôt qu'un visage neutre trompeur.";
      blank.append(blankTitle);
      group.append(blank);
    }

    const roleText = role === "lead" ? "MÈNE" : role === "support" ? "SOUTIENT" : "hors workspace";
    const badge = svg("text", { class: `se-role-tag ${role}`, y: -radius - 14, "text-anchor": "middle" });
    badge.textContent = roleText;
    group.append(badge);

    // Aura colorée : elle donne sa couleur à toute la zone qu'occupe la
    // sous-entité, au lieu de la réduire à une petite forme sur fond sombre.
    const auraRadius = radius + 60 + 40 * unit(entity.structure.certainty);
    const aura = svg("circle", { cx: x, cy: y, r: auraRadius, fill: `url(#aura-${idSuffix(entity.id)})`, class: "aura" });
    auras.push(defsFor(entity.id, hue), aura);

    // Bulle de pensée : ce à quoi elle pense, au-dessus d'elle.
    bubbles.push(thoughtBubble(entity, x, y - radius - 34, stroke));

    const caption = svg("text", { class: "se-caption", y: radius + 26, "text-anchor": "middle" });
    caption.textContent = `${entity.state.label} · ${entity.field.capacity?.used ?? 0} nœuds`;
    group.append(caption);

    attachPointer(group, entity, { trueX: anchor.x, trueY: anchor.y });
    group.addEventListener("pointerenter", event => {
      group.classList.add("is-hovered");
      document.querySelectorAll(".subentity").forEach(sub => {
        if (sub !== group) sub.classList.add("is-dimmed");
      });
      showHover(entity, event);
    });
    group.addEventListener("pointermove", event => positionHoverCard(event));
    group.addEventListener("pointerleave", () => {
      group.classList.remove("is-hovered");
      document.querySelectorAll(".subentity").forEach(sub => sub.classList.remove("is-dimmed"));
      hideHover();
    });
    group.addEventListener("focus", event => showHover(entity, event));
    group.addEventListener("blur", hideHover);
    bodies.push(group);
  }

  byId("layer-auras").replaceChildren(...auras);
  byId("layer-fields").replaceChildren(...fields);
  byId("layer-labels").replaceChildren(...labels);
  byId("layer-subentities").replaceChildren(...bodies);
  byId("layer-bubbles").replaceChildren(...bubbles);
  byId("reset-layout").disabled = manualOffsets.size === 0;
  renderEdges(frame, nodePositions);
  attachNodeHovers(frame);

  const placed = frame.subentities.filter(entity => entity.position.measurementStatus === "derived").length;
  const empty = byId("map-empty");
  if (!frame.subentities.length) {
    empty.hidden = false;
    empty.replaceChildren(
      element("strong", "", "Aucune sous-entité n'existe encore."),
      element("p", "", "Le runtime est vide : lancez une pulsation pour que les signaux vivants forment une première coalition.")
    );
  } else if (!placed) {
    empty.hidden = false;
    empty.replaceChildren(
      element("strong", "", "Aucune sous-entité n'est plaçable."),
      element("p", "", "Leurs champs ne portent pas de vecteur exploitable — exécutez `npm run embeddings:ensure`.")
    );
  } else {
    empty.hidden = true;
  }

  const note = [`${placed}/${frame.subentities.length} sous-entité(s) placée(s)`];
  if (frame.map.measurementStatus !== "derived") note.push(frame.map.reason);
  else note.push(`repère : ACP figée sur ${frame.map.basisSampleCount} profils de clusters`);
  if (viewport) note.push(`zoom ×${viewport.scale.toFixed(0)} (cadrage collant, uniforme)`);
  if (frame.map.missingEmbeddings) note.push(`${frame.map.missingEmbeddings} nœud(s) sans vecteur, laissés hors du plan`);
  byId("map-note").textContent = note.join(" · ");
  rememberFrame(frame);
}

// ── Survol : le contenu, pas seulement le nom ─────────────────────────
function positionHoverCard(event) {
  const card = byId("hover-card");
  if (!card || card.hidden) return;
  if (!event || typeof event.clientX !== "number") return;
  const padding = 16;
  const cardWidth = card.offsetWidth || 360;
  const cardHeight = card.offsetHeight || 180;
  let left = event.clientX + 18;
  let top = event.clientY + 18;

  if (left + cardWidth > window.innerWidth - padding) {
    left = Math.max(padding, event.clientX - cardWidth - 18);
  }
  if (top + cardHeight > window.innerHeight - padding) {
    top = Math.max(padding, event.clientY - cardHeight - 18);
  }
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.style.bottom = "auto";
}

function hideHover() {
  const card = byId("hover-card");
  if (card) card.hidden = true;
  document.querySelectorAll(".is-hovered, .is-dimmed, .edge-highlight").forEach(el => {
    el.classList.remove("is-hovered", "is-dimmed", "edge-highlight");
  });
}

function showHoverCard(children, event) {
  const card = byId("hover-card");
  card.replaceChildren(...children);
  card.hidden = false;
  if (event) positionHoverCard(event);
}

function showHover(entity, event) {
  const children = [
    element("p", "hover-title", `${entity.state.icon} ${entity.name || shortId(entity.id)}`),
    element("p", "hover-role", entity.doing.role === "lead" ? "Mène le Global Workspace"
      : entity.doing.role === "support" ? `Admise en soutien, rang ${entity.doing.rank}`
        : "Hors du Global Workspace"),
    element("p", "hover-body", entity.reading.doing),
    element("p", "hover-body dim", entity.reading.seeing)
  ];
  children.push(entity.reading.feeling.measurementStatus === "unavailable"
    ? element("p", "hover-unmeasured", `Affect non mesuré — ${entity.reading.feeling.reason || "aucune mesure disponible"}.`)
    : element("p", "hover-feeling", `${entity.reading.feeling.smiley} ${entity.reading.feeling.text}`));
  children.push(element("p", "hover-rule", `État dérivé de : ${entity.state.rule}. Teinte : ${entity.hueLabel || "indéterminée"}.`));
  showHoverCard(children, event);
}

/** Survol : chaque nœud dessiné renseigne, sans exception. */
function attachNodeHovers(frame) {
  const byKey = new Map();
  for (const entity of frame.subentities) {
    for (const node of entity.field.admitted || []) byKey.set(`${entity.id}::${node.id}`, { entity, node, zone: "admitted" });
    for (const node of entity.field.periphery || []) byKey.set(`${entity.id}::${node.id}`, { entity, node, zone: "periphery" });
  }
  for (const dot of document.querySelectorAll(".node-dot")) {
    const found = byKey.get(`${dot.dataset.entity}::${dot.dataset.node}`);
    if (!found) continue;
    const show = event => {
      const { entity, node, zone } = found;
      dot.classList.add("is-hovered");

      const labelEl = document.querySelector(`.node-label[data-node="${node.id}"], .node-label[data-entity="${entity.id}"][data-node="${node.id}"]`);
      if (labelEl) labelEl.classList.add("is-hovered");

      document.querySelectorAll(`.energy-edge[data-source="${node.id}"], .energy-edge[data-target="${node.id}"]`).forEach(edge => {
        edge.classList.add("edge-highlight");
      });

      const children = [
        element("p", "hover-title", node.name || node.id),
        element("p", "hover-role", `${label(node.semanticType) || "nœud"} · ${zone === "periphery" ? "frontière du champ" : "au cœur du champ"}${node.clusterId ? ` · ${node.clusterId}` : " · sans cluster"}`)
      ];
      children.push(node.content
        ? element("p", "hover-body", node.content)
        : element("p", "hover-unmeasured", "Ce nœud ne porte aucun texte : il n'y a rien à lire derrière son identifiant."));

      if (node.sharedWith?.length) {
        const shared = element("p", "hover-boundary",
          `Terrain partagé avec ${node.sharedWith.map(holder => `« ${holder.label} » (${holder.zone === "periphery" ? "frontière" : "cœur"}, alignement ${holder.alignment.toFixed(2)})`).join(", ")}.`);
        children.push(shared);
      }

      children.push(element("p", "hover-rule",
        `Alignement relatif ${node.alignment.toFixed(2)} dans le champ de « ${entity.name || entity.state.label} »`
        + `${typeof node.energy === "number" ? ` · énergie ${node.energy.toFixed(4)}` : " · énergie non mesurée"}`
        + `${node.epistemicStatus ? ` · ${label(node.epistemicStatus)}` : ""}`
        + `${node.hasEmbedding ? "" : " · sans vecteur"}`));
      showHoverCard(children, event);
    };
    dot.addEventListener("pointerenter", show);
    dot.addEventListener("pointermove", event => positionHoverCard(event));
    dot.addEventListener("pointerleave", hideHover);
  }

  const satellites = new Map((frame.energy?.satellites || []).map(item => [item.id, item]));
  for (const dot of document.querySelectorAll(".satellite")) {
    const satellite = satellites.get(dot.dataset.node);
    if (!satellite) continue;
    dot.addEventListener("pointerenter", event => {
      dot.classList.add("is-hovered");
      showHoverCard([
        element("p", "hover-title", satellite.name || satellite.id),
        element("p", "hover-role", `${label(satellite.semanticType) || "nœud"} · hors du champ attentionnel${satellite.clusterId ? ` · ${satellite.clusterId}` : ""}`),
        satellite.content
          ? element("p", "hover-body", satellite.content)
          : element("p", "hover-unmeasured", "Ce nœud ne porte aucun texte : il n'y a rien à lire derrière son identifiant."),
        element("p", "hover-rule", "Relié au champ par une arête vivante, mais non recruté par une sous-entité.")
      ], event);
    });
    dot.addEventListener("pointermove", event => positionHoverCard(event));
    dot.addEventListener("pointerleave", hideHover);
  }
}

const idSuffix = id => String(id).replace(/[^a-z0-9]/gi, "").slice(-14);

/** Dégradé radial coloré, réutilisé comme aura de la sous-entité. */
function defsFor(id, hue) {
  const defs = svg("defs");
  const gradient = svg("radialGradient", { id: `aura-${idSuffix(id)}` });
  const tint = hue === null ? "200 15%" : `${hue} 85%`;
  gradient.append(svg("stop", { offset: "0%", "stop-color": `hsl(${tint} 60%)`, "stop-opacity": ".38" }));
  gradient.append(svg("stop", { offset: "55%", "stop-color": `hsl(${tint} 55%)`, "stop-opacity": ".14" }));
  gradient.append(svg("stop", { offset: "100%", "stop-color": `hsl(${tint} 50%)`, "stop-opacity": "0" }));
  defs.append(gradient);
  return defs;
}

/** Bulle de pensée : le statut de la sous-entité, écrit au-dessus d'elle. */
function thoughtBubble(entity, x, y, stroke) {
  const lines = wrapText(entity.reading.doing, 40);
  const width = Math.max(...lines.map(line => line.length)) * 7.2 + 26;
  const height = lines.length * 17 + 20;
  const group = svg("g", { class: "thought", transform: `translate(${x},${y})` });
  group.append(svg("rect", {
    x: -width / 2, y: -height, width, height, rx: 14,
    fill: "rgba(9,13,20,.88)", stroke, "stroke-opacity": .8, "stroke-width": 1.6
  }));
  // Les deux petites bulles qui descendent vers la forme, comme une pensée.
  group.append(svg("circle", { cx: 0, cy: -height + height + 8, r: 5, fill: "rgba(9,13,20,.88)", stroke, "stroke-opacity": .7 }));
  group.append(svg("circle", { cx: -4, cy: 20, r: 3, fill: "rgba(9,13,20,.88)", stroke, "stroke-opacity": .55 }));
  lines.forEach((line, index) => {
    const text = svg("text", { x: 0, y: -height + 20 + index * 17, "text-anchor": "middle", class: "thought-text" });
    text.textContent = line;
    group.append(text);
  });
  return group;
}

/**
 * Découpe en lignes sans jamais tronquer : la bulle grandit pour contenir la
 * phrase entière. Couper une phrase changerait ce que la sous-entité dit.
 */
function wrapText(text, perLine) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current && (`${current} ${word}`).length > perLine) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["—"];
}

// Transferts retenus au dernier rendu, relâchés seulement quand un tick tombe.
let pendingFlows = [];

/**
 * Lâche une bulle par transfert mesuré, une seule traversée, rapide. L'énergie
 * ne « coule » pas en continu à l'écran : elle passe au moment du tick, ce qui
 * est exactement ce que la physique mesure.
 */
function emitEnergyTransfers() {
  const layer = byId("layer-flows");
  const bubbles = [];
  const maxFlow = Math.max(0, ...pendingFlows.map(item => item.edge.flow));
  for (const { edge, from, to, stroke } of pendingFlows) {
    const share = maxFlow ? edge.flow / maxFlow : 0;
    const bubble = svg("circle", { r: 4 + 7 * share, fill: stroke, class: "flow-bubble" });
    // Plus le transfert est fort, plus la traversée est rapide.
    const duration = Math.max(0.35, 1.1 - 0.65 * share);
    const motion = svg("animateMotion", {
      dur: `${duration.toFixed(2)}s`,
      repeatCount: "1",
      fill: "remove",
      path: `M ${from.x} ${from.y} L ${to.x} ${to.y}`
    });
    bubble.append(motion);
    const title = svg("title");
    title.textContent = `Transfert ${edge.flow.toFixed(4)} le long de ${edge.predicate || edge.type}${edge.flowKinds.length ? ` (${edge.flowKinds.join(", ")})` : ""}`;
    bubble.append(title);
    bubbles.push(bubble);
    setTimeout(() => bubble.remove(), duration * 1000 + 120);
  }
  layer.replaceChildren(...bubbles);
}

/**
 * Onde émise par chaque sous-entité active quand un tick vient d'être appliqué.
 * Elle ne se déclenche jamais toute seule : une pulsation à l'écran signale
 * toujours qu'un tick a réellement modifié le runtime.
 */
function emitTickPulse() {
  const layer = byId("layer-subentities");
  for (const group of layer.querySelectorAll(".subentity")) {
    const wave = svg("circle", { r: 30, fill: "none", stroke: "currentColor", class: "tick-wave" });
    const shape = group.querySelector(".se-shape");
    if (shape) wave.setAttribute("stroke", shape.getAttribute("stroke"));
    group.append(wave);
    setTimeout(() => wave.remove(), 1600);
  }
}

/** Glisser-déposer. La forme bouge, la mesure ne bouge pas. */
function attachPointer(group, entity, anchor) {
  const svgRoot = byId("map");
  const toViewBox = event => {
    const rect = svgRoot.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * VIEW.width,
      y: ((event.clientY - rect.top) / rect.height) * VIEW.height
    };
  };
  group.addEventListener("pointerdown", event => {
    event.preventDefault();
    const point = toViewBox(event);
    const offset = offsetOf(entity.id);
    dragging = {
      id: entity.id,
      grabX: point.x - (anchor.trueX + offset.dx),
      grabY: point.y - (anchor.trueY + offset.dy),
      anchor,
      moved: false
    };
    group.classList.add("dragging");
    // La capture évite de perdre le pointeur en sortant de la forme ; son
    // absence ne doit pas empêcher de déplacer.
    try { group.setPointerCapture(event.pointerId); } catch { /* pointeur non capturable */ }
  });
  group.addEventListener("pointermove", event => {
    if (dragging?.id !== entity.id) return;
    const point = toViewBox(event);
    dragging.moved = true;
    manualOffsets.set(entity.id, {
      dx: point.x - dragging.grabX - anchor.trueX,
      dy: point.y - dragging.grabY - anchor.trueY
    });
    if (lastFrame) renderSubentities(lastFrame);
  });
  const finish = () => {
    if (dragging?.id !== entity.id) return;
    // Un clic net, sans déplacement, reste une sélection.
    if (!dragging.moved) { selectedId = entity.id; renderNarration(lastFrame); }
    dragging = null;
    group.classList.remove("dragging");
    if (lastFrame) renderSubentities(lastFrame);
  };
  group.addEventListener("pointerup", finish);
  group.addEventListener("pointercancel", finish);
  group.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectedId = entity.id;
      renderNarration(lastFrame);
      renderSubentities(lastFrame);
    }
  });
}

/** Narration permanente : ce que chaque sous-entité fait, voit et ressent, sans avoir à cliquer. */
function renderNarration(frame) {
  if (!frame) return;
  byId("inspect-title").textContent = `${frame.subentities.length} sous-entité(s) · révision ${frame.revision}`;
  if (!frame.subentities.length) {
    replaceChildren("inspect-body", [element("p", "empty-state", "Le runtime est vide : lancez une pulsation pour qu'une première coalition se forme.")]);
    return;
  }
  const body = [];
  for (const entity of frame.subentities) {
    const card = element("article", `narration${selectedId === entity.id ? " selected" : ""}`);
    card.style.setProperty("--hue", entity.hue ?? 210);

    const head = element("div", "narration-head");
    const badges = element("span", "narration-badges");
    // Deux pastilles distinctes : le statut, puis l'émotion.
    const statusBadge = element("span", "badge-icon", entity.state.icon);
    statusBadge.title = `Statut : ${entity.state.label}`;
    badges.append(statusBadge);
    if (entity.reading.feeling.smiley) {
      const feelBadge = element("span", "badge-icon", entity.reading.feeling.smiley);
      feelBadge.title = entity.reading.feeling.text;
      badges.append(feelBadge);
    } else {
      const blank = element("span", "badge-icon blank", "—");
      blank.title = "Affect non mesuré";
      badges.append(blank);
    }
    const gw = element("span", `narration-gw ${entity.doing.role}`,
      entity.doing.role === "lead" ? "MÈNE LE WORKSPACE"
        : entity.doing.role === "support" ? `SOUTIEN · RANG ${entity.doing.rank}`
          : "HORS WORKSPACE");
    head.append(badges, element("span", "narration-state", entity.state.label), gw);
    card.append(head);

    card.append(element("p", "reading", entity.reading.doing));
    card.append(element("p", "reading dim", entity.reading.seeing));

    if (entity.reading.feeling.measurementStatus === "unavailable") {
      card.append(unmeasured(entity.reading.feeling, "Affect non mesuré."));
    } else {
      card.append(element("p", "reading feeling", `${entity.reading.feeling.smiley} ${entity.reading.feeling.text}`));
    }

    // Le contenu des nœuds regardés, pas seulement leurs titres.
    const nodeList = element("div", "node-list");
    for (const node of (entity.field.admitted || []).slice(0, selectedId === entity.id ? 9 : 3)) {
      const item = element("article", "node-item");
      item.style.setProperty("--alignment", `${Math.round(node.alignment * 100)}%`);
      item.append(element("p", "node-name", node.name || shortId(node.id)));
      item.append(node.content
        ? element("p", "node-content", node.content)
        : element("p", "node-content empty", "Ce nœud ne porte aucun texte."));
      item.append(element("p", "node-meta", `alignement ${node.alignment.toFixed(2)}${node.clusterId ? ` · ${node.clusterId}` : " · sans cluster"}${node.hasEmbedding ? "" : " · sans vecteur"}`));
      nodeList.append(item);
    }
    if (entity.field.admitted?.length) card.append(nodeList);
    if (selectedId !== entity.id && (entity.field.admitted?.length || 0) > 3) {
      card.append(element("p", "rule", `+ ${entity.field.admitted.length - 3} autre(s) nœud(s) — cliquez pour déplier.`));
    }

    card.append(element("p", "rule", `État dérivé de : ${entity.state.rule}.`));
    if (selectedId === entity.id) {
      card.append(element("p", "rule", `Teinte : ${entity.hueLabel || "indéterminée"} · poids ${entity.structure.weight.toFixed(2)} · stabilité ${entity.structure.stability.toFixed(2)} · certitude ${entity.structure.certainty.toFixed(2)}`));
      if (entity.position.measurementStatus === "derived") {
        card.append(element("p", "rule", `Position x ${entity.position.x.toFixed(3)} · y ${entity.position.y.toFixed(3)}, barycentre de ${entity.position.basedOn} vecteur(s).`));
      }
    }

    const cardActions = element("div", "narration-actions");
    cardActions.style.marginTop = ".5rem";
    cardActions.style.display = "flex";
    cardActions.style.gap = ".5rem";

    const cockpitBtn = element("button", "btn btn-step btn-small", "Cockpit 🎛️");
    cockpitBtn.type = "button";
    cockpitBtn.style.fontSize = ".78rem";
    cockpitBtn.style.padding = ".25rem .65rem";
    cockpitBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCockpit(entity.id);
    });
    cardActions.append(cockpitBtn);
    card.append(cardActions);

    card.addEventListener("click", () => {
      selectedId = selectedId === entity.id ? null : entity.id;
      renderNarration(frame);
      renderSubentities(frame);
    });
    body.push(card);
  }
  replaceChildren("inspect-body", body);
}

// ── Panneaux ───────────────────────────────────────────────────────────
function renderStats(counts, revision) {
  replaceChildren("stats", [
    ["révision", revision], ["actives", counts.active], ["niveau haut", counts.highLevel],
    ["candidates", counts.candidates], ["admises", counts.admitted], ["fusionnées", counts.merged],
    ["snapshots", counts.snapshots]
  ].map(([text, value]) => {
    const card = element("article", "stat");
    card.append(element("strong", "", value ?? 0), element("span", "", text));
    return card;
  }));
}

function renderSource(source) {
  if (!source || source.measurementStatus === "unavailable") {
    replaceChildren("source", [unmeasured(source, "La source des signaux vivants est indisponible.")]);
    return;
  }
  const rows = [
    row("citoyen", source.citizenId),
    row("workspace", `v${source.workspaceVersion} · ${source.workspaceObservedAt || "—"}`),
    row("empreinte", shortId(source.workspaceContentHash)),
    row("tick L4", source.physicsTick),
    row("énergie totale", Number(source.physicsTotalEnergy).toFixed(3)),
    row("arêtes vivantes", source.liveLinks),
    row("cibles sensorielles", source.sensoryTargetCount),
    row("budget d'attention", `${source.characterBudget} caractères`),
    row("prochain tick", shortId(source.nextTickId))
  ];
  if (source.unavailable?.length) rows.push(element("p", "unmeasured", `Non mesuré dans cette entrée : ${source.unavailable.join(", ")}.`));
  replaceChildren("source", rows);
}

function renderCitizen(citizen) {
  if (!citizen || citizen.measurementStatus === "unavailable") {
    replaceChildren("citizen", [unmeasured(citizen, "Le workspace vivant du citoyen est illisible.")]);
    return;
  }
  const nodes = [
    row("mode", label(citizen.mode)),
    row("état cortical", label(citizen.cortexState)),
    row("tâche active", citizen.activeTask?.name || "—")
  ];
  const conscious = citizen.consciousState;
  if (conscious) {
    nodes.push(
      row("attention", `${label(conscious.attention?.orientation)} · ${conscious.attention?.measurementStatus}`),
      row("tonalité émotionnelle", conscious.emotionalTone?.measurementStatus === "unavailable" ? "non mesurée" : label(conscious.emotionalTone?.dominant)),
      row("contrôleur attribué", conscious.agency?.controllerName || conscious.agency?.controller || `inconnu (${conscious.agency?.measurementStatus})`)
    );
  }
  if (citizen.voice) nodes.push(element("p", "quote", citizen.voice));
  replaceChildren("citizen", nodes);
}

function renderWorkspace(workspace) {
  if (!workspace || workspace.measurementStatus === "unavailable") {
    replaceChildren("workspace", [unmeasured(workspace, "Aucune enchère n'a encore été arbitrée.")]);
    return;
  }
  const nodes = [
    row("snapshot", `v${workspace.version} · ${workspace.occurredAt || "—"}`),
    row("budget utilisé", `${workspace.characterUsed} / ${workspace.characterBudget} caractères`),
    row("contrôleur", workspace.controllerId ? shortId(workspace.controllerId) : `inconnu (${label(workspace.controllerStatus)})`)
  ];
  for (const bid of (workspace.bids || []).slice(0, 6)) {
    nodes.push(row(`enchère #${bid.rank} · ${shortId(bid.controllerId || bid.candidateId)}`, `score ${Number(bid.score).toFixed(3)} · pénalité ${Number(bid.penalty).toFixed(3)}`));
  }
  const flags = Object.entries(workspace.audit || {}).filter(([, value]) => value === true).map(([key]) => key);
  if (flags.length) nodes.push(row("alertes d'arbitrage", flags.join(", ")));
  replaceChildren("workspace", nodes);
}

const journal = [];
function pushJournal(entry) {
  journal.unshift(entry);
  journal.length = Math.min(journal.length, 25);
  replaceChildren("journal", journal.map(item => {
    const node = element("div", `entry ${item.kind}`);
    node.append(element("strong", "", item.title), element("span", "", item.detail));
    if (item.tickId) node.append(element("code", "", item.tickId));
    return node;
  }));
}

// ── Pupitre ────────────────────────────────────────────────────────────
let graphParam = new URLSearchParams(window.location.search).get("graph") || "";
let timer = null;
let inFlight = false;
const counts = { pulses: 0, applied: 0, unchanged: 0 };
const query = () => (graphParam ? `?graph=${encodeURIComponent(graphParam)}` : "");

function setPulseState(text, kind, beat = false) {
  const node = byId("pulse-state");
  node.className = `pill ${kind}${beat ? " beat" : ""}`;
  node.textContent = text;
}

function refreshCounters() {
  byId("count-pulses").textContent = counts.pulses;
  byId("count-applied").textContent = counts.applied;
  byId("count-unchanged").textContent = counts.unchanged;
}

function renderFrame(frame) {
  lastFrame = frame;
  renderStats(frame.counts, frame.revision);
  renderLandmarks(frame.map);
  renderSubentities(frame);
  renderNarration(frame);
  renderSource(frame.source);
  renderCitizen(frame.citizen);
  renderWorkspace(frame.workspace);
}

async function loadFrame() {
  const connection = byId("connection");
  try {
    const response = await fetch(`/api/l1/subentities/brain${query()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { frame, projection } = await response.json();
    connection.className = `status ${projection.status === "current" ? "current" : "error"}`;
    connection.textContent = projection.status === "current" ? `Révision ${frame.revision}` : `Révision ${frame.revision} · projection à réparer`;
    renderFrame(frame);
  } catch (error) {
    connection.className = "status error";
    connection.textContent = `Cerveau illisible · ${error.message}`;
  }
}

async function pulse() {
  if (inFlight) return;
  inFlight = true;
  counts.pulses += 1;
  refreshCounters();
  let applied = false;
  try {
    const response = await fetch(`/api/l1/subentities/pulse${query()}`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const { report, provenance } = payload;
    if (report.status === "already_processed") {
      counts.unchanged += 1;
      setPulseState("Rien de nouveau", "unchanged", true);
      pushJournal({
        kind: "unchanged",
        title: "Aucune observation nouvelle",
        detail: `Le workspace v${provenance.workspaceVersion} et le tick L4 ${provenance.physicsTick} n'ont pas bougé depuis la dernière pulsation.`,
        tickId: report.tickId
      });
    } else {
      counts.applied += 1;
      setPulseState("Tick appliqué", "applied", true);
      applied = true;
      pushJournal({
        kind: "applied",
        title: `Révision ${report.revision} · ${report.microTickCount} micro-tick(s)`,
        detail: `${report.merges.length} fusion(s), ${report.promotions.length} promotion(s), ${report.activeSubentityCount} active(s) · arrêt : ${label(report.stopReason)}`,
        tickId: report.tickId
      });
    }
    refreshCounters();
    await loadFrame();
    // L'onde est émise après le re-rendu : émise avant, elle serait détruite
    // par le remplacement de la couche au moment même où elle démarre.
    if (applied) { emitTickPulse(); emitEnergyTransfers(); }
  } catch (error) {
    setPulseState("Pulsation refusée", "error");
    pushJournal({ kind: "error", title: "Pulsation refusée", detail: error.message });
  } finally {
    inFlight = false;
  }
}

function stopCadence() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const button of document.querySelectorAll(".speed")) button.setAttribute("aria-checked", "false");
  byId("pause").disabled = true;
  setPulseState("À l'arrêt", "");
}

function startCadence(period, button) {
  if (timer) clearInterval(timer);
  for (const other of document.querySelectorAll(".speed")) other.setAttribute("aria-checked", String(other === button));
  byId("pause").disabled = false;
  setPulseState(`Cadence ${period} ms`, "running");
  pulse();
  timer = setInterval(pulse, period);
}

async function initGraphSelector() {
  const select = byId("graph-select");
  try {
    const response = await fetch("/api/l1/graphs");
    if (!response.ok) return;
    const { graphs } = await response.json();
    select.replaceChildren(...(graphs || []).map(graph => {
      const option = document.createElement("option");
      option.value = graph.falkorGraph || graph.id;
      option.textContent = graph.label || graph.id;
      option.selected = Boolean(graphParam) && (graphParam === graph.falkorGraph || graphParam === graph.id);
      return option;
    }));
    if (!graphParam && select.value) graphParam = select.value;
  } catch {
    // La sélection de graphe est un confort : son échec ne doit pas masquer le cerveau.
  }
  select.addEventListener("change", async () => {
    graphParam = select.value;
    const url = new URL(window.location.href);
    url.searchParams.set("graph", graphParam);
    window.history.replaceState({}, "", url);
    await loadFrame();
  });
}

byId("step").addEventListener("click", () => { stopCadence(); pulse(); });
byId("pause").addEventListener("click", stopCadence);
for (const button of document.querySelectorAll(".speed")) {
  button.addEventListener("click", () => startCadence(Number(button.dataset.period), button));
}
for (const toggle of ["show-nodes", "show-labels", "show-landmarks"]) {
  byId(toggle).addEventListener("change", () => { if (lastFrame) { renderLandmarks(lastFrame.map); renderSubentities(lastFrame); } });
}
byId("reset-layout").addEventListener("click", () => {
  manualOffsets.clear();
  if (lastFrame) renderSubentities(lastFrame);
});

await initGraphSelector();
await loadFrame();

// ── think() resolver UI wiring
function prettyJSON(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

function renderThinkResult(obj) {
  const box = byId("think-result");
  box.replaceChildren();
  if (!obj) { box.append(element("pre", "empty-state", "Aucun résultat.")); return; }
  // summary header
  const header = element("div", "think-summary");
  header.append(element("strong", "", obj.actionChosen ? `Action: ${obj.actionChosen}` : "Résultat"));
  if (obj.coalitions) header.append(element("span", "dim", ` · coalitions ${obj.coalitions.length}`));
  box.append(header);
  // full payload
  const pre = document.createElement("pre");
  pre.className = "think-payload";
  pre.textContent = prettyJSON(obj);
  box.append(pre);
}

function thinkFormValues() {
  const actor = byId("think-actor").value || "nlr_ai";
  const stimulus = byId("think-stimulus").value || "";
  const task = byId("think-task").value || null;
  const max_ticks = Math.max(1, Number(byId("think-max-ticks").value || 6));
  const mode = document.querySelector("input[name='think-mode']:checked").value || "simulate";
  return { actor, stimulus, task, max_ticks, mode };
}

byId("think-run").addEventListener("click", async () => {
  const values = thinkFormValues();
  const box = byId("think-result");
  box.replaceChildren(element("p", "dim", "Envoi du think()…"));
  try {
    const response = await fetch(`/api/l1/think${query()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    renderThinkResult(payload);
    pushJournal({ kind: "think", title: `think() ${values.mode}`, detail: `actor=${values.actor} · ticks=${values.max_ticks}` });
    await loadFrame();
  } catch (err) {
    box.replaceChildren(element("p", "error", `Erreur: ${err.message}`));
    pushJournal({ kind: "error", title: "think() échoué", detail: err.message });
  }
});

byId("think-clear").addEventListener("click", () => {
  byId("think-actor").value = "nlr_ai";
  byId("think-stimulus").value = "";
  byId("think-task").value = "";
  byId("think-max-ticks").value = "6";
  document.querySelector("input[name='think-mode'][value='simulate']").checked = true;
  byId("think-result").replaceChildren(element("p", "empty-state", "Aucun résultat."));
});

let currentCockpitSubentityId = null;

async function executeCockpitAction(actionObj, subentityId) {
  const action = typeof actionObj === "string" ? actionObj : actionObj.id;
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
    const response = await fetch(`/api/l1/subentities/manual-control${query()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    await openCockpit(subentityId);
    await loadFrame();
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

  const queryPrefix = graphParam ? `&graph=${encodeURIComponent(graphParam)}` : "";
  try {
    const res = await fetch(`/api/l1/subentities/cockpit?id=${encodeURIComponent(subentityId)}${queryPrefix}`, { cache: "no-store" });
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
      element("p", "meta", `Affect dominant: ${data.subentity.dominantAffect || "aucun"}`),
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

byId("open-global-cockpit-btn")?.addEventListener("click", () => {
  if (lastFrame?.subentities?.length) {
    openCockpit(lastFrame.subentities[0].id);
  } else {
    alert("Aucune sous-entité active observée sur ce tick.");
  }
});
byId("cockpit-close-btn")?.addEventListener("click", closeCockpit);
byId("cockpit-modal")?.addEventListener("click", e => { if (e.target === byId("cockpit-modal")) closeCockpit(); });
