// Cité-jardin — UX spatiale du graphe (v1).
// Le graphe typé est le moteur ; ici le sens d'une relation est porté par une
// affordance (mur, flux, route, racine) plutôt que par une étiquette à lire.
// Rendu hybride : structure en SVG accessible + particules de flux en Canvas.

import {
  affordOf, glyphOf, vitalityOf,
  causalMateriality, CORROBORATING_PREDICATES
} from "./garden-affordance.js";
import {
  LANE_COUNT, CONVERGING_PREDICATES, buildNarrative, objectiveCharge, roleOf, orientationOf
} from "./garden-narrative.js";
import {
  blockageOf, connectorOf, machineStateOf, objectOf, portStateOf
} from "./garden-objects.js";
import { wrapCanvasText } from "./canvas-text.js";
import { installTermReferences } from "./term-references.js";
import { clusterLabel, clusterOptions } from "./garden-clusters.js";
import { chooseStartCluster, clusterHref, parcelScope, walkAvailability } from "./garden-experience.js";
import {
  clientPointToGraph, panViewBox, viewportScale, zoomViewBox
} from "./garden-camera.js";
import { L4_EQUATION, STIPULATIONS, walk } from "./l4-propagation.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const params = new URLSearchParams(location.search);

// --- État ---------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const svg = el("garden-svg");
const canvas = el("garden-flow");
const ctx = canvas.getContext("2d");
const layers = {
  districts: el("garden-districts"), roots: el("garden-roots"), roads: el("garden-roads"),
  walls: el("garden-walls"), nodes: el("garden-nodes"), walk: el("garden-walk")
};
let all = { nodes: [], links: [] };
let view = { nodes: [], links: [], byId: new Map(), flows: [] };
let selectedId = null;
let motion = true;
let rafId = null;
let panGesture = null;
let walker = null;

// --- Données ------------------------------------------------------------------
async function loadGraph() {
  const res = await fetch("/api/graph");
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function buildCluster(clusterId, withNeighbors) {
  // Le cœur Mind Protocol ne porte aucun clusterId ; il vaut district à part
  // entière (`""`), sinon la majorité des affirmations causales reste hors d'atteinte.
  const inCluster = new Set(all.nodes.filter((n) => (n.clusterId || "") === clusterId).map((n) => n.id));
  const touching = all.links.filter((l) => inCluster.has(l.source) || inCluster.has(l.target));
  const keep = new Set(inCluster);
  if (withNeighbors) touching.forEach((l) => { keep.add(l.source); keep.add(l.target); });
  const nodes = all.nodes
    .filter((n) => keep.has(n.id))
    .map((n) => ({ ...n, _core: inCluster.has(n.id) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Corroboration : calculée sur le graphe entier, pas sur le district, sinon un
  // ancrage de preuve disparaîtrait au simple changement de cluster affiché.
  const corroborated = new Set();
  for (const l of all.links) {
    if (!CORROBORATING_PREDICATES.has(l.type)) continue;
    corroborated.add(l.source); corroborated.add(l.target);
  }
  const links = all.links
    .filter((l) => byId.has(l.source) && byId.has(l.target))
    .map((l) => {
      const afford = affordOf(l);
      const enriched = { ...l, afford };
      if (afford.kind === "causal") {
        enriched.causal = causalMateriality(l, {
          corroborated: corroborated.has(l.source) || corroborated.has(l.target)
        });
      }
      return enriched;
    });
  // Le récit du district est calculé une fois : cible, voies, avenue, verrous.
  const story = buildNarrative(nodes, links, { mainCluster: clusterId });
  for (const n of nodes) {
    n.role = roleOf(n);
    n.onPath = story.pathIds.has(n.id);
    // Les ports sont calculés sur le graphe entier : une machine ne devient pas
    // scellée parce qu'on a changé le district affiché.
    n.portState = portStateOf(n, all.links);
    n.machineState = machineStateOf(n, all.links);
    if (n.role === "objective") {
      n.charge = objectiveCharge(n, links);
      n.orientation = orientationOf(n);
    }
  }
  story.path.forEach((n, i) => { n.waypoint = i + 1; });

  // Chaque nœud porte une `phrase` obligatoire qui dit précisément ce qu'il
  // affirme. Elle ne s'écrit que **là où il y a la place de la lire** : dans la
  // clairière, et sur le fruit. La poser sur les cartes de l'avenue et du
  // pourtour les faisait passer de 186×71 à 238×121 — deux fois l'encombrement
  // — pour un texte rendu à 8 px, donc illisible : on payait la place sans
  // obtenir la lecture. Ailleurs, la phrase est dans l'inspecteur, en taille
  // réelle.
  const speaking = new Set();
  if (story.garden) speaking.add(story.garden.node.id);
  if (story.objectives[0]) speaking.add(story.objectives[0].id);
  for (const n of nodes) n.showPhrase = speaking.has(n.id);
  return { nodes, links, byId, mainCluster: clusterId, story };
}

// --- Layout : un axe en voies vers la cible -----------------------------------
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

// Une parcelle est un objet posé, pas une étiquette : sa taille vient de son
// texte, jamais l'inverse. Le texte n'est donc plus tronqué à l'aveugle.
const measureCtx = document.createElement("canvas").getContext("2d");
const LABEL_FONT = '500 13px system-ui, -apple-system, "Segoe UI", sans-serif';
const PHRASE_FONT = '400 11.5px system-ui, -apple-system, "Segoe UI", sans-serif';
// Le chrome d'une carte — gouttière du glyphe, marges, pied de type — est du
// vide payé au prix fort : multiplié par 53 parcelles, il décide de l'échelle à
// laquelle le nom se lit. Il est réduit au strict nécessaire pour loger le
// glyphe et la pastille de vitalité.
const CARD = {
  minW: 112, maxW: 172, gutter: 25, padX: 10, lineH: 16, headY: 23, footH: 13,
  phraseW: 186, phraseLineH: 14
};

// Le nom d'une parcelle n'est jamais tronqué : la carte s'agrandit autant qu'il
// le faut. Couper un nom au même nombre de caractères pour tous rendait la
// moitié des parcelles illisibles — un « Méthodologie de prem… » n'apprend rien.
function cardOf(n) {
  if (n._card) return n._card;
  measureCtx.font = LABEL_FONT;
  const inner = CARD.maxW - CARD.gutter - CARD.padX;
  let lines = wrapCanvasText(measureCtx, shortName(n.name), inner);
  if (!lines.length) lines = [n.id];

  // La phrase du nœud, là où elle doit être lue : la carte s'élargit pour elle
  // plutôt que de la couper, et le texte fait la taille de la carte.
  let phrase = [];
  if (n.showPhrase && n.phrase) {
    measureCtx.font = PHRASE_FONT;
    phrase = wrapCanvasText(measureCtx, n.phrase, CARD.phraseW);
    measureCtx.font = LABEL_FONT;
  }
  const textW = Math.max(...lines.map((l) => measureCtx.measureText(l).width));
  const base = Math.max(CARD.minW, Math.min(CARD.maxW, Math.round(textW + CARD.gutter + CARD.padX)));
  const w = phrase.length ? Math.max(base, CARD.phraseW + CARD.gutter + CARD.padX) : base;
  const h = CARD.headY + lines.length * CARD.lineH + CARD.footH
    + (phrase.length ? phrase.length * CARD.phraseLineH + 8 : 0);
  n._card = { w, h, lines, phrase };
  return n._card;
}

// La ville a un axe, pas un anneau. De gauche à droite : le socle, la
// machinerie, les affirmations, puis la cible observable. La position dit la
// distance à ce que le district cherche à déplacer ; le cluster n'est plus
// qu'une teinte de terrain. Un anneau de districts ne donnait aucun ordre de
// lecture — on ne savait ni par où commencer ni où ça menait.
// Un jardin est dense : les parcelles se touchent presque, séparées par des
// allées, pas par des bretelles d'échangeur. Un vide de 96 unités entre deux
// voies — la moitié d'une carte — n'ajoute aucune information et coûte le tiers
// de l'échelle de lecture.
const LANE_GAP = 46;      // entre deux voies
const STACK_GAP = 12;     // entre deux cartes d'une même colonne
const COLUMN_GAP = 18;    // entre deux colonnes d'une même voie

// À quelle hauteur replier une voie en colonnes. Une hauteur fixe produisait un
// quartier deux fois plus haut que large là où le volet est deux fois plus large
// que haut : la moitié de l'échelle de lecture partait dans les marges
// latérales. On cherche donc le pli qui donne au quartier la forme du volet —
// une recherche déterministe sur la géométrie réelle des cartes, pas un réglage.
function chooseStackHeight(lanes, W, H) {
  const heights = lanes.map((list) => list.map((n) => cardOf(n).h + STACK_GAP));
  const widths = lanes.map((list) => (list.length ? Math.max(...list.map((n) => cardOf(n).w)) : 40));
  const tallest = Math.max(40, ...heights.flat());
  const total = heights.flat().reduce((s, h) => s + h, 0);

  let best = null;
  for (let steps = 0; steps <= 40; steps++) {
    const candidate = tallest + (steps / 40) * Math.max(0, total - tallest);
    let width = 0, height = tallest;
    lanes.forEach((list, lane) => {
      if (!list.length) { width += 40 + LANE_GAP; return; }
      let stack = 0, columns = 1, tallestColumn = 0;
      for (const n of list) {
        const h = cardOf(n).h + STACK_GAP;
        if (stack + h - STACK_GAP > candidate && stack) { columns += 1; tallestColumn = Math.max(tallestColumn, stack); stack = 0; }
        stack += h;
      }
      tallestColumn = Math.max(tallestColumn, stack);
      height = Math.max(height, tallestColumn);
      width += columns * (widths[lane] + COLUMN_GAP) - COLUMN_GAP + LANE_GAP;
    });
    width -= LANE_GAP;
    // l'échelle qu'on obtiendrait : c'est elle qu'on maximise, rien d'autre
    const scale = Math.min(W / (width + 160), H / (height + 160));
    if (!best || scale > best.scale) best = { scale, candidate };
  }
  return best.candidate;
}

function layout(v, W, H) {
  const story = v.story;
  const degree = new Map(v.nodes.map((n) => [n.id, 0]));
  v.links.forEach((l) => { degree.set(l.source, (degree.get(l.source) || 0) + 1); degree.set(l.target, (degree.get(l.target) || 0) + 1); });

  // 1. répartition en voies
  const lanes = Array.from({ length: LANE_COUNT }, () => []);
  for (const n of v.nodes) {
    n.lane = story.lanes.get(n.id) ?? 2;
    n.district = n.clusterId || "";
    n.satellite = n.district !== v.mainCluster;
    lanes[n.lane].push(n);
  }

  // 2. ordre vertical par barycentre : on rapproche un nœud de ses voisins de la
  //    voie précédente, ce qui réduit les croisements sans layout stochastique.
  for (const list of lanes) {
    list.sort((a, b) => (degree.get(b.id) - degree.get(a.id)) || (hash(a.id) - hash(b.id)));
    list.forEach((n, i) => { n._order = i; });
  }
  const neighbours = new Map(v.nodes.map((n) => [n.id, []]));
  for (const l of v.links) {
    if (!neighbours.has(l.source) || !neighbours.has(l.target)) continue;
    neighbours.get(l.source).push(l.target);
    neighbours.get(l.target).push(l.source);
  }
  for (let pass = 0; pass < 6; pass++) {
    for (const list of lanes) {
      for (const n of list) {
        const near = neighbours.get(n.id)
          .map((id) => v.byId.get(id))
          .filter((o) => o && o.lane !== n.lane);
        n._bary = near.length ? near.reduce((s, o) => s + o._order, 0) / near.length : n._order;
      }
      list.sort((a, b) => (a._bary - b._bary) || (hash(a.id) - hash(b.id)));
      list.forEach((n, i) => { n._order = i; });
    }
  }

  // 3. empilement : chaque voie est une bande, repliée en colonnes à la hauteur
  //    qui donne au quartier la forme du volet.
  const maxStack = chooseStackHeight(lanes, W, H);
  let x = 0;
  v.laneBands = [];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const list = lanes[lane];
    if (!list.length) { v.laneBands.push({ lane, x0: x, x1: x + 40, empty: true }); x += 40 + LANE_GAP; continue; }
    const columns = [[]];
    let stack = 0;
    for (const n of list) {
      const k = cardOf(n);
      if (stack + k.h > maxStack && columns[columns.length - 1].length) { columns.push([]); stack = 0; }
      columns[columns.length - 1].push(n);
      stack += k.h + STACK_GAP;
    }
    const laneX0 = x;
    for (const column of columns) {
      const width = Math.max(...column.map((n) => cardOf(n).w));
      const height = column.reduce((s, n) => s + cardOf(n).h + STACK_GAP, -STACK_GAP);
      let y = -height / 2;
      for (const n of column) {
        const k = cardOf(n);
        n.x = x + width / 2;      // colonne alignée à gauche, cartes centrées dessus
        n.y = y + k.h / 2;
        y += k.h + STACK_GAP;
      }
      x += width + COLUMN_GAP;
    }
    x -= COLUMN_GAP;
    v.laneBands.push({ lane, x0: laneX0, x1: x, empty: false });
    x += LANE_GAP;
  }

  // 4. le jardin-endgame : le point de convergence quitte sa colonne et devient
  //    une clairière à droite, entourée en arc des ouvrages qui le définissent.
  //    Un endgame rangé dans une pile de cartes ne se lit pas comme une destination.
  layoutGarden(v);
  tightenLaneBands(v);

  const box = boxOf(v.nodes, 0);
  for (const n of v.nodes) n.x -= box.cx;
  for (const band of v.laneBands) { band.x0 -= box.cx; band.x1 -= box.cx; }
  // La clairière est posée en coordonnées de parcelles : si elle ne suit pas le
  // recentrage, elle est dessinée à des centaines d'unités de ses propres
  // ouvrages — un cercle vide d'un côté, ce qui le définit de l'autre — et le
  // cadrage s'élargit pour contenir ce fantôme, ce qui rétrécit tout le texte.
  if (v.gardenLayout) v.gardenLayout.cx -= box.cx;
  v.centers = new Map();
}

// Le jardin retire des parcelles de leurs voies. Une bande qui garde leur
// ancienne emprise laisse une plaque de sol vide, exactement là où la clairière
// vient ensuite se poser : la voie et le jardin se recouvrent alors sans qu'une
// seule parcelle ne soit en cause.
function tightenLaneBands(v) {
  const members = Array.from({ length: LANE_COUNT }, () => []);
  for (const n of v.nodes) {
    if (n.isGarden || n.onRim || n.isFruit) continue;
    if (members[n.lane]) members[n.lane].push(n);
  }
  v.laneBands = v.laneBands.map((band) => {
    const list = members[band.lane];
    if (!list || !list.length) return { ...band, x1: band.x0 + 40, empty: true };
    const b = boxOf(list, 0);
    return { ...band, x0: b.x0, x1: b.x1, empty: false };
  });
}

// Le jardin est une clairière, pas une case dans une pile. Il est posé à droite
// de tout, et les ouvrages qui le définissent sont plantés en arc sur son
// pourtour, tournés vers l'intérieur : le jardin est décrit par ce qui le
// compose, pas par une étiquette.
// La clairière doit être la plus grande chose de la vue, pas la plus vaste : un
// disque de 500 unités entouré d'un anneau à 363 occupait à lui seul plus que le
// volet, donc obligeait à dézoomer tout le reste pour le contenir.
const GARDEN = { radius: 196, ringGap: 52 };

function layoutGarden(v) {
  const garden = v.story.garden;
  if (!garden) { v.gardenLayout = null; return; }
  const hub = v.byId.get(garden.node.id);
  if (!hub) { v.gardenLayout = null; return; }

  // Les ouvrages qui définissent le jardin sont plantés sur son pourtour. Le
  // rayon de l'arc suit la hauteur réellement occupée par les cartes — porter la
  // phrase les fait grandir. Il se calcule **avant** le centre : sinon le côté
  // gauche de l'arc revient s'écraser sur les voies restées en place.
  const rim = garden.defines.map((e) => v.byId.get(e.node.id)).filter(Boolean);
  const arc = Math.PI * 1.05;                    // un arc ouvert du côté d'où l'on vient
  const gap = 13;
  // L'encombrement d'une carte le long de l'arc dépend de l'angle où elle est
  // posée : à midi c'est sa largeur qui gêne, sur le côté c'est sa hauteur.
  // Espacer sur la seule hauteur laissait se recouvrir des cartes trois fois
  // plus larges que hautes. On converge en quelques passes.
  const tangentSpan = (n, a) => {
    const k = cardOf(n);
    return Math.abs(k.w * Math.sin(a)) + Math.abs(k.h * Math.cos(a)) + gap;
  };
  let ringR = GARDEN.radius + 74;
  let angles = rim.map((_, i) => Math.PI - arc / 2 + ((i + 0.5) / Math.max(1, rim.length)) * arc);
  for (let pass = 0; pass < 6; pass++) {
    const spans = rim.map((n, i) => tangentSpan(n, angles[i]));
    const needed = spans.reduce((s, x) => s + x, 0);
    ringR = Math.max(ringR, needed / arc);
    let cursor = Math.PI - arc / 2 + (arc - needed / ringR) / 2;
    angles = spans.map((span) => {
      const a = cursor + span / ringR / 2;
      cursor += span / ringR;
      return a;
    });
  }
  const needed = rim.reduce((s, n, i) => s + tangentSpan(n, angles[i]), 0);
  const widest = rim.length ? Math.max(...rim.map((n) => cardOf(n).w)) : 0;

  const others = v.nodes.filter((n) => n !== hub && !rim.includes(n));
  const right = others.length ? Math.max(...others.map((n) => n.x + cardOf(n).w / 2)) : 0;
  const cx = right + ringR + widest / 2 + GARDEN.ringGap;
  const cy = 0;
  hub.x = cx; hub.y = cy; hub.isGarden = true;

  rim.forEach((n, i) => {
    const a = angles[i];
    n.x = cx + Math.cos(a) * (ringR + cardOf(n).w * 0.12);
    n.y = cy + Math.sin(a) * ringR;
    n.onRim = true;
  });

  // le fruit : l'état observable, posé à la sortie du jardin
  const fruit = v.story.objectives.find((o) => o.id !== hub.id && v.byId.has(o.id));
  const fruitNode = fruit ? v.byId.get(fruit.id) : null;
  if (fruitNode) {
    fruitNode.x = cx + ringR + cardOf(fruitNode).w * 0.7;
    fruitNode.y = cy;
    fruitNode.isFruit = true;
  }
  v.gardenLayout = { cx, cy, r: GARDEN.radius, ringR, hub, rim, fruit: fruitNode };
}

function renderGarden() {
  const g = view.gardenLayout;
  if (!g) return;
  const layer = layers.districts;
  const wrap = make("g", { class: "endgame-garden" }, layer);
  make("circle", { cx: g.cx, cy: g.cy, r: g.r + 62, class: "garden-halo" }, wrap);
  make("circle", { cx: g.cx, cy: g.cy, r: g.r, class: "garden-clearing" }, wrap);
  make("circle", { cx: g.cx, cy: g.cy, r: g.r - 16, class: "garden-inner" }, wrap);
  make("text", { x: g.cx, y: g.cy - g.r + 34, class: "garden-kicker" }, wrap).textContent = "ENDGAME DU DISTRICT";
  // le nom du jardin est écrit en entier, jamais tronqué
  const lines = wrapVoid(shortName(g.hub.name), 22);
  lines.forEach((line, i) => {
    make("text", { x: g.cx, y: g.cy - (lines.length - 1) * 15 + i * 30, class: "garden-title" }, wrap)
      .textContent = line;
  });
  // Dans la clairière il y a la place : l'énoncé du jardin est écrit en entier,
  // c'est lui qui dit ce que cet endgame est réellement.
  const said = wrapVoid(g.hub.phrase || "", 34);
  const phraseTop = g.cy + lines.length * 15 + 16;
  said.forEach((line, i) => {
    make("text", { x: g.cx, y: phraseTop + i * 20, class: "garden-phrase" }, wrap).textContent = line;
  });
  if (g.hub.stateIndicator) {
    make("text", { x: g.cx, y: phraseTop + said.length * 20 + 8, class: "garden-indicator" }, wrap)
      .textContent = `Indicateur : ${g.hub.stateIndicator}`;
  }
  make("text", { x: g.cx, y: g.cy + g.r - 30, class: "garden-sub" }, wrap)
    .textContent = `${view.story.garden.convergence} ouvrages convergent ici`;
  // Le manque se dit là où il porte : le district a bien une destination, mais
  // rien d'observable n'en sort. Le dire ici plutôt qu'en zone « aucune cible »
  // évite d'annoncer l'absence du but que la clairière vient de nommer.
  if (!g.fruit) {
    make("text", { x: g.cx, y: g.cy + g.r - 11, class: "garden-void" }, wrap)
      .textContent = "aucun état observable n'en sort";
  }
}

// Boîte d'un groupe de cartes, cartes comprises — pas seulement leurs centres,
// sinon les enclos coupent les étiquettes qu'ils sont censés contenir.
function boxOf(members, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of members) {
    const k = cardOf(n);
    x0 = Math.min(x0, n.x - k.w / 2); x1 = Math.max(x1, n.x + k.w / 2);
    y0 = Math.min(y0, n.y - k.h / 2); y1 = Math.max(y1, n.y + k.h / 2);
  }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// --- Géométrie utilitaire -----------------------------------------------------
function make(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}
// --- Rendu --------------------------------------------------------------------
function clearLayers() { for (const k in layers) layers[k].replaceChildren(); }

function render(W, H) {
  clearLayers();
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  view.flows = [];
  buildDefs();

  renderLaneBands();
  renderGarden();

  // liens
  for (const l of view.links) {
    const a = view.byId.get(l.source), b = view.byId.get(l.target);
    const k = l.afford.kind;
    if (k === "root") renderRoot(a, b, l);
    else if (k === "wall" || k === "rampart") renderWall(a, b, l);
    else if (k === "flow") renderFlowPath(a, b, l);
    else if (k === "causal") renderCausalCrossing(a, b, l);
    else renderRoad(a, b, l);
  }

  buildTraffic();
  renderAvenue();
  for (const n of view.nodes) renderParcel(n);
  renderGates();
  // Le marcheur survit à un re-layout : ses tronçons pointent sur les parcelles,
  // dont les coordonnées viennent de changer. On recalcule les longueurs.
  if (walker) {
    const rebuilt = buildWalk();
    if (rebuilt) { walker = { ...walker, ...rebuilt }; renderWalk(); }
  }
  applyToggles();
  buildBriefing();
  buildA11y();
  fitViewBox(W, H);
}

const LANE_TITLES = ["Socle", "Machinerie", "Affirmations", "Approche", "Cible observable"];

function renderLaneBands() {
  const box = boxOf(view.nodes, 70);
  view.laneBands.forEach((band) => {
    // Une voie que le jardin a entièrement vidée ne laisse qu'une plaque de sol
    // et un titre, souvent sous la clairière elle-même. Le manque est déjà dit
    // dans le jardin ; le répéter en sol vide n'ajoute qu'un recouvrement.
    if (band.empty) return;
    const last = band.lane === LANE_COUNT - 1;
    const w = Math.max(60, band.x1 - band.x0);
    make("rect", {
      x: band.x0 - 26, y: box.y0, width: w + 52, height: box.h,
      class: `lane-band lane-${band.lane}${last ? " lane-target" : ""}${band.empty ? " lane-empty" : ""}`
    }, layers.districts);
    make("text", { x: band.x0 - 12, y: box.y0 + 28, class: "lane-title" }, layers.districts)
      .textContent = LANE_TITLES[band.lane];
  });

  // Le vide se dit. Un district sans état observable se termine sur une zone
  // nommée, pas sur un bord de page qui laisserait croire à un hors-champ.
  // Mais quand une clairière annonce une destination, planter « AUCUNE CIBLE »
  // à côté d'elle est une contradiction entre le texte et le dessin : ce qui
  // manque alors n'est pas le but, c'est le fruit observable, et cela se dit
  // dans le jardin lui-même.
  if (view.story.voidReason && !view.story.garden) {
    const band = view.laneBands[LANE_COUNT - 1];
    const g = make("g", { class: "lane-void" }, layers.districts);
    make("rect", { x: band.x0 - 26, y: box.y0, width: 260, height: box.h, rx: 18, class: "void-zone" }, g);
    const lines = wrapVoid(view.story.voidReason, 30);
    lines.forEach((line, i) => {
      make("text", { x: band.x0 + 100, y: box.cy - (lines.length - 1) * 11 + i * 22, class: "void-text" }, g)
        .textContent = line;
    });
    make("text", { x: band.x0 + 100, y: box.cy - (lines.length + 1) * 11 - 18, class: "void-kicker" }, g)
      .textContent = "AUCUNE CIBLE";
  }
}

function wrapVoid(text, perLine) {
  const words = text.split(/\s+/); const lines = []; let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > perLine) { lines.push(line.trim()); line = w; }
    else line += " " + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

// L'avenue principale : une seule route large et éclairée, de l'entrée à la
// cible. C'est elle qui répond à « par où je commence » et « où ça mène ».
function renderAvenue() {
  const path = view.story.path;
  if (path.length < 2) return;
  const d = path.map((n, i) => `${i ? "L" : "M"} ${n.x} ${n.y}`).join(" ");
  make("path", { d, class: "avenue-bed" }, layers.roads);
  make("path", { d, class: "avenue" }, layers.roads);
  // sens de marche : des chevrons qui pointent vers la cible
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ux = b.x - a.x, uy = b.y - a.y; const len = Math.hypot(ux, uy) || 1;
    const nx = ux / len, ny = uy / len; const px = -ny, py = nx;
    make("path", {
      d: `M ${mx - nx * 9 + px * 8} ${my - ny * 9 + py * 8} L ${mx + nx * 9} ${my + ny * 9} L ${mx - nx * 9 - px * 8} ${my - ny * 9 - py * 8}`,
      class: "avenue-chevron"
    }, layers.roads);
  }
}

// Un verrou barre. Il se dresse en travers de l'avenue, devant ce qu'il bloque,
// au lieu de flotter au milieu d'un lien qu'on ne voit pas.
function renderGates() {
  for (const gate of view.story.gates) {
    for (const blocked of gate.blocks) {
      if (!view.byId.has(blocked.id)) continue;
      const target = view.byId.get(blocked.id);
      const k = cardOf(target);
      const bx = target.x - k.w / 2 - 16;
      const half = k.h / 2 + 12;
      // « A bloque B » en quatre temps : la barrière est plantée dans l'entrée de
      // B, le flux qui y arrive s'accumule contre elle, une amorce remonte
      // jusqu'à A pour qu'on sache qui bloque, et un ADDRESSES pose une planche
      // d'échafaudage — franchissable provisoirement, jamais prouvé.
      const blockage = blockageOf(gate.node, blocked, view.links);
      const g = make("g", {
        class: `gate-bar${gate.onCriticalPath ? " on-path" : ""}${blockage.plank ? " answered" : ""}`
          + `${blockage.pooling ? " pooling" : " dry"}`,
        "data-gate": gate.node.id, "data-blocked": blocked.id
      }, layers.walls);

      make("line", { x1: bx, y1: target.y - half, x2: bx, y2: target.y + half, class: "gate-post" }, g);
      for (let i = -1; i <= 1; i++) {
        make("line", { x1: bx - 7, y1: target.y + i * 12, x2: bx + 7, y2: target.y + i * 12, class: "gate-rung" }, g);
      }
      if (blockage.pooling) {
        // le flux bute et s'accumule : on voit une pression qui ne passe pas
        make("path", { d: `M ${bx - 6} ${target.y - 16} q -10 16 0 32`, class: "gate-pool" }, g);
      }
      if (blockage.plank) {
        // planche en matière d'échafaudage : traversable, pas prouvée
        make("line", { x1: bx - 13, y1: target.y, x2: bx + 13, y2: target.y, class: "gate-plank" }, g);
      }
      // amorce vers celui qui bloque, pour qu'on sache qui
      const from = view.byId.get(gate.node.id);
      if (from) {
        make("path", { d: `M ${from.x} ${from.y} L ${bx} ${target.y}`, class: "gate-leader" }, g);
      }
      make("text", { x: bx, y: target.y - half - 6, class: "gate-glyph", "aria-hidden": "true" }, g)
        .textContent = blockage.plank ? "⚿" : "⛔";
      make("title", {}, g).textContent =
        `${gate.node.name} barre « ${blocked.name} » — ${blockage.note}.`;
    }
  }
}

function districtLabel(c) {
  return clusterLabel(c, all?.nodes || []);
}

function populateClusterSelect(nodes) {
  const select = el("garden-cluster");
  select.replaceChildren(...clusterOptions(nodes).map(({ value, label, count }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${label} · ${count}`;
    return option;
  }));
}

function curve(a, b, bow = 0.16) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  return `M ${a.x} ${a.y} Q ${mx - dy * bow} ${my + dx * bow} ${b.x} ${b.y}`;
}

function renderRoad(a, b, l) {
  const cls = { grounds: "grounds", tests: "tests", bridge: "bridge", subcase: "subcase" }[l.afford.kind] || "";
  // Une route qui quitte le district s'estompe : sinon les liaisons lointaines
  // dominent le dessin et masquent la structure locale.
  const far = a.district !== b.district ? " crossing-district" : "";
  const p = make("path", { d: curve(a, b), class: `road ${cls}${far}`, "data-src": l.source, "data-tgt": l.target }, layers.roads);
  p.dataset.role = "road";
}

// Franchissement causal : corde qui pend ↔ pierre qui porte.
// La géométrie fait le travail — une affirmation non chiffrée s'affaisse
// visiblement, une preuve du monde réel tient une arche. Aucune étiquette à lire.
function causalPath(a, b, sag) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const drop = sag * Math.min(52, len * 0.2);           // la corde pend vers le bas
  const rise = sag === 0 ? Math.min(26, len * 0.1) : 0; // la pierre s'arque vers le haut
  const qx = (a.x + b.x) / 2;
  const qy = (a.y + b.y) / 2 + drop - rise;
  const at = (t) => {
    const it = 1 - t;
    return { x: it * it * a.x + 2 * it * t * qx + t * t * b.x, y: it * it * a.y + 2 * it * t * qy + t * t * b.y };
  };
  return { d: `M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`, at, normal: { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } };
}

function renderCausalCrossing(a, b, l) {
  const c = l.causal || causalMateriality(l);
  const m = c.material;
  const g = make("g", {
    class: `causal-crossing ${m.key}${c.corroborated ? " corroborated" : ""}`,
    "data-src": l.source, "data-tgt": l.target, "data-role": "causal"
  }, layers.roads);
  const path = causalPath(a, b, m.sag);
  // La confiance déclarée épaissit le tablier, sans jamais le rendre franchissable
  // si l'arête ne porte pas de taille d'effet.
  const width = (m.rank === 0 ? 1.6 : 2.2 + m.rank * 1.1) + (c.confidence * 1.8);
  make("path", { d: path.d, class: "crossing-deck", "stroke-width": width.toFixed(2) }, g);

  if (m.rank === 0 || m.rank === 1) {
    // effilochage : la corde n'a pas de tablier continu
    make("path", { d: path.d, class: "crossing-fray" }, g);
  }
  if (m.key === "plank") {
    // planches : traverses régulières, on voit sur quoi on marche
    const steps = 6;
    for (let i = 1; i < steps; i++) {
      const p = path.at(i / steps);
      const px = path.normal.x * 6, py = path.normal.y * 6;
      make("line", { x1: p.x - px, y1: p.y - py, x2: p.x + px, y2: p.y + py, class: "crossing-plank" }, g);
    }
  }
  if (m.key === "stone") {
    // culées : la pierre repose sur des appuis visibles
    for (const end of [a, b]) make("circle", { cx: end.x, cy: end.y, r: 5, class: "crossing-abutment" }, g);
  }
  if (c.corroborated) {
    const mid = path.at(0.5);
    make("circle", { cx: mid.x, cy: mid.y, r: 3.6, class: "crossing-anchor" }, g);
  }
  make("title", {}, g).textContent =
    `${l.afford.verb} — ${m.label} : ${m.note}. ${c.reason}.`;
}

function renderRoot(a, b, l) {
  make("path", { d: curve(a, b, 0.28), class: "root-link", "data-src": l.source, "data-tgt": l.target }, layers.roots);
}

function renderFlowPath(a, b, l) {
  // trace discrète sous les particules (repère statique, utile en reduced-motion)
  make("path", { d: curve(a, b), class: "road dim", "data-src": l.source, "data-tgt": l.target, "data-role": "flow" }, layers.roads);
}

function renderWall(a, b, l) {
  // Un mur, pas une flèche : barrière perpendiculaire posée devant la cible.
  const rampart = l.afford.kind === "rampart";
  const fault = !rampart && (a.epistemicStatus === "unresolved" || b.epistemicStatus === "unresolved");
  const dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;           // direction source→cible
  const px = -uy, py = ux;                        // perpendiculaire
  const gx = a.x + ux * len * 0.6, gy = a.y + uy * len * 0.6; // devant la cible
  const half = 30;
  const g = make("g", { class: `wall-glyph ${rampart ? "rampart" : ""}`, "data-src": l.source, "data-tgt": l.target, "data-role": "wall" }, layers.walls);
  // tether ténu vers l'ériger (qui dresse le mur)
  make("line", { x1: a.x, y1: a.y, x2: gx, y2: gy, stroke: "currentColor", "stroke-width": 1, "stroke-dasharray": "1 6", opacity: 0.2 }, g);
  if (fault) {
    // faille en zigzag
    let d = `M ${gx - px * half} ${gy - py * half}`;
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps; const zx = gx - px * half + px * 2 * half * t; const zy = gy - py * half + py * 2 * half * t;
      const off = (i % 2 ? 1 : -1) * 7; d += ` L ${zx + ux * off} ${zy + uy * off}`;
    }
    make("path", { d, class: "fault-line" }, g);
  } else {
    make("line", { x1: gx - px * half, y1: gy - py * half, x2: gx + px * half, y2: gy + py * half, class: "wall-body" }, g);
    // hachures / créneaux
    const teeth = 5;
    for (let i = 0; i <= teeth; i++) {
      const t = i / teeth; const bx = gx - px * half + px * 2 * half * t; const by = gy - py * half + py * 2 * half * t;
      const h = rampart ? 9 : 7;
      make("line", { x1: bx, y1: by, x2: bx + ux * h, y2: by + uy * h, class: "wall-hatch" }, g);
    }
  }
}

// Un objet est tangible quand il a une masse, une lumière et une ombre. Le
// statut épistémique gouverne donc la *solidité* : un bâti achevé pose son ombre
// sur le sol, une proposition n'est qu'un échafaudage qui ne pose rien, et une
// question ouverte est un trou creusé dans le sol (ombre à l'intérieur).
function renderParcel(n) {
  const vit = vitalityOf(n);
  const { w, h, lines } = cardOf(n);
  const g = make("g", {
    class: `parcel plot-${vit.plot} vit-${vit.key} role-${n.role}`
      + `${n.satellite ? " satellite" : ""}${n.onPath ? " on-path" : ""}`
      + `${n.onRim ? " on-rim" : ""}${n.isFruit ? " is-fruit" : ""}${n.isGarden ? " is-garden" : ""}`
      + `${n.orientation ? " orientation-" + n.orientation : ""}`,
    transform: `translate(${n.x} ${n.y})`, tabindex: 0, role: "button",
    "aria-label": ariaFor(n, vit),
    "data-id": n.id, "data-district": n.district, "data-role": n.role
  }, layers.nodes);
  g.style.setProperty("--vit", `var(${vit.var})`);

  if (n.isGarden) {
    // La clairière *est* la représentation du jardin : sa carte ferait doublon.
    // On ne garde qu'une cible de clic et de focus, à la taille du jardin.
    make("circle", { cx: 0, cy: 0, r: GARDEN.radius, class: "garden-hit" }, g);
    bindParcel(n, g);
    return;
  }

  const x0 = -w / 2, y0 = -h / 2;
  // Corps opaque d'abord, matière par-dessus : sans cette base, le dégradé se
  // mélangeait au sol et tout paraissait en calque translucide.
  make("rect", { x: x0, y: y0, width: w, height: h, rx: 13, class: "plot-body" }, g);
  const body = make("rect", { x: x0, y: y0, width: w, height: h, rx: 13, class: "plot" }, g);
  body.setAttribute("fill", `url(#fill-${vit.key})`);

  if (vit.plot === "scaffold") {
    // Chantier : de vrais montants et traverses, plutôt qu'un contour pointillé
    // de plus. On voit que ça n'est pas bâti, sans avoir à lire.
    for (const px of [x0 + 9, -w / 2 + w - 9]) make("line", { x1: px, y1: y0 + 4, x2: px, y2: y0 + h - 4, class: "scaffold-post" }, g);
    for (const py of [y0 + 7, y0 + h - 7]) make("line", { x1: x0 + 4, y1: py, x2: x0 + w - 4, y2: py, class: "scaffold-rail" }, g);
  }
  if (vit.plot === "chasm") {
    // Faille : la lumière n'accroche que la lèvre basse du trou.
    make("path", { d: `M ${x0 + 13} ${y0 + h - 1} H ${x0 + w - 13}`, class: "chasm-lip" }, g);
  }
  if (vit.plot === "ruin") {
    // Ruine : le haut de l'ouvrage manque, il ne reste que des pans et des gravats.
    const notch = `M ${x0 + 4} ${y0 + 10} V ${y0 + 3} H ${x0 + w * 0.32} V ${y0 + 12}`
      + ` M ${x0 + w * 0.58} ${y0 + 13} V ${y0 + 4} H ${x0 + w - 4} V ${y0 + 9}`;
    make("path", { d: notch, class: "ruin-crest" }, g);
    make("line", { x1: x0 + 8, y1: y0 + h - 3, x2: x0 + w - 8, y2: y0 + h - 3, class: "ruin-rubble" }, g);
  }
  if (vit.plot === "mirage") {
    // Mirage : l'ouvrage n'a pas de base, il flotte au-dessus de l'horizon.
    make("line", { x1: x0 + 16, y1: y0 + h - 4, x2: x0 + w - 16, y2: y0 + h - 4, class: "mirage-horizon" }, g);
  }
  if (vit.plot === "foundation") {
    // Fondation balisée : une dalle au sol, rien n'est encore élevé dessus.
    make("line", { x1: x0 + 6, y1: y0 + h - 2, x2: x0 + w - 6, y2: y0 + h - 2, class: "foundation-slab" }, g);
  }
  if (vit.plot === "sprout") {
    // Pousse : des tiges qui sortent de l'assise. Surtout pas un remplissage
    // partiel — un demi-rectangle rempli se lit comme une jauge « à 50 % », ce
    // qui serait un chiffre inventé au lieu d'une catégorie.
    for (let i = 0; i < 3; i++) {
      const sx = x0 + 12 + i * 9;
      make("path", { d: `M ${sx} ${y0 + h - 3} q ${i % 2 ? 4 : -4} -7 0 -13`, class: "sprout-stem" }, g);
    }
  }

  renderSilhouette(n, g, x0, y0, w, h);
  make("rect", { x: x0, y: y0, width: w, height: h, rx: 13, class: "plot-edge" }, g);
  // Le glyphe et la pastille tiennent dans la gouttière, pas dessus : à 19 u du
  // bord, un glyphe de 17 px mordait sur la première ligne du nom.
  make("circle", { cx: x0 + 13, cy: y0 + 13, r: 3.4, class: "vitpip" }, g);
  const glyph = make("text", { class: "glyph", x: x0 + 13, y: 3, "aria-hidden": "true" }, g);
  glyph.textContent = glyphOf(n);

  if (n.waypoint) {
    // L'ordre de lecture est écrit sur la ville, pas laissé à deviner.
    const bx = x0 - 15;
    make("circle", { cx: bx, cy: y0 + 13, r: 12, class: "waypoint-disc" }, g);
    make("text", { x: bx, y: y0 + 13, class: "waypoint-num", "aria-hidden": "true" }, g)
      .textContent = String(n.waypoint);
  }

  const textX = x0 + CARD.gutter;
  lines.forEach((line, i) => {
    const t = make("text", { class: "plabel", x: textX, y: y0 + CARD.headY + i * CARD.lineH }, g);
    t.textContent = line;
  });
  // L'énoncé précis, sous la poignée : c'est lui qui dit ce que le nœud affirme.
  const { phrase = [] } = cardOf(n);
  phrase.forEach((line, i) => {
    make("text", { class: "pphrase", x: textX, y: y0 + CARD.headY + lines.length * CARD.lineH + 12 + i * CARD.phraseLineH }, g)
      .textContent = line;
  });

  const type = make("text", { class: "ptype", x: textX, y: y0 + h - 10 }, g);
  type.textContent = (n.semanticTypeLabel || n.nodeTypeLabel || n.semanticType || n.nodeType || "").toLowerCase();

  bindParcel(n, g);
}

function bindParcel(n, g) {
  g.addEventListener("click", () => select(n.id, { pan: true }));
  g.addEventListener("keydown", (e) => onNodeKey(e, n));
  g.addEventListener("mouseenter", () => highlight(n.id, true));
  g.addEventListener("mouseleave", () => highlight(n.id, false));
  g.addEventListener("focus", () => select(n.id, { pan: true }));
  n._g = g;
}

// Deux canaux orthogonaux et lisibles séparément : la *matière* dit le statut
// épistémique (déjà rendue plus haut), la *silhouette* dit le rôle dans le
// récit. Tout était carré parce que 30 types partageaient une seule forme.
// Un objet par type de nœud. La forme dit la fonction que l'ontologie attribue
// au type ; `garden-objects.js` porte la table et sa traçabilité.
const SHAPES = {
  machine: (g, b) => {
    make("line", { x1: b.x0 + 10, y1: b.y0 + 5, x2: b.x0 + 10, y2: b.y1 - 5, class: "mach-seam" }, g);
    make("line", { x1: b.x1 - 10, y1: b.y0 + 5, x2: b.x1 - 10, y2: b.y1 - 5, class: "mach-seam" }, g);
  },
  meter_machine: (g, b) => {
    SHAPES.machine(g, b);
    make("circle", { cx: b.x1 - 18, cy: b.y0 + 13, r: 6, class: "mach-meter" }, g);
    make("line", { x1: b.x1 - 18, y1: b.y0 + 13, x2: b.x1 - 14, y2: b.y0 + 9, class: "mach-needle" }, g);
  },
  plant: (g, b) => {
    SHAPES.machine(g, b);
    make("rect", { x: b.cx - 9, y: b.y0 - 16, width: 18, height: 16, class: "plant-stack" }, g);
  },
  gatehouse: (g, b) => {
    make("path", { d: `M ${b.x0 + 3} ${b.y0 + 7} L ${b.x0 + 16} ${b.y0 - 5} L ${b.x1 - 16} ${b.y0 - 5} L ${b.x1 - 3} ${b.y0 + 7}`, class: "roofline" }, g);
    make("path", { d: `M ${b.x1 - 22} ${b.y1} v -15 a 6 6 0 0 1 12 0 v 15`, class: "gate-door" }, g);
  },
  jig: (g, b) => make("path", { d: `M ${b.x0 + 8} ${b.y0 - 7} v 7 h ${b.w - 16} v -7`, class: "jig-bracket" }, g),
  key: (g, b) => {
    make("circle", { cx: b.x0 - 9, cy: 0, r: 6, class: "key-bow" }, g);
    make("path", { d: `M ${b.x0 - 3} 0 h 12 m -5 0 v 5`, class: "key-bit" }, g);
  },
  bedrock: (g, b) => make("rect", { x: b.x0 - 6, y: b.y1 - 7, width: b.w + 12, height: 10, rx: 2, class: "bedrock" }, g),
  fissure: (g, b) => make("path", {
    d: `M ${b.x0 + 14} ${b.y1 + 5} l 12 -6 l 10 8 l 14 -7 l 12 6 l 10 -5`, class: "fissure-crack"
  }, g),
  stele: (g, b) => {
    make("path", { d: `M ${b.x0 + 14} ${b.y0} l 6 -9 h ${b.w - 40} l 6 9`, class: "stele-cap" }, g);
    for (let i = 0; i < 3; i++) make("line", { x1: b.x1 - 34, y1: b.y1 - 14 + i * 4, x2: b.x1 - 12, y2: b.y1 - 14 + i * 4, class: "stele-engraving" }, g);
  },
  marker: (g, b) => {
    make("line", { x1: b.x0 - 8, y1: b.y0 + 2, x2: b.x0 - 8, y2: b.y1, class: "marker-post" }, g);
    make("path", { d: `M ${b.x0 - 8} ${b.y0 + 2} l 12 5 l -12 5 z`, class: "marker-flag" }, g);
  },
  plaque: (g, b) => make("rect", { x: b.x0 + 5, y: b.y0 + 5, width: b.w - 10, height: b.h - 10, rx: 3, class: "plaque-border" }, g),
  stakes: (g, b) => {
    for (const [sx, sy] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) {
      make("path", { d: `M ${sx} ${sy} l ${sx < 0 ? 9 : -9} 0 M ${sx} ${sy} l 0 ${sy < 0 ? 9 : -9}`, class: "stake-corner" }, g);
    }
  },
  beacon: (g, b, n) => {
    const charge = n.charge || { charge: 0 };
    const mx = b.x1 - 20;
    make("line", { x1: mx, y1: b.y0 - 26, x2: mx, y2: b.y0 + 2, class: "beacon-mast" }, g);
    make("circle", { cx: mx, cy: b.y0 - 30, r: 9, class: "beacon-lamp-off" }, g);
    if (charge.charge > 0) {
      make("circle", { cx: mx, cy: b.y0 - 30, r: 9, class: "beacon-lamp", "stroke-dasharray": `${(charge.charge * 56.5).toFixed(1)} 56.5` }, g);
    }
    make("path", { d: `M ${b.x0 + 4} ${b.y1} H ${b.x1 - 4}`, class: "beacon-plinth" }, g);
  },
  dial: (g, b) => {
    const cx = b.x1 - 18;
    make("line", { x1: cx, y1: b.y0 - 20, x2: cx, y2: b.y0, class: "dial-mast" }, g);
    make("circle", { cx, cy: b.y0 - 26, r: 10, class: "dial-face" }, g);
    make("line", { x1: cx, y1: b.y0 - 26, x2: cx + 6, y2: b.y0 - 31, class: "dial-needle" }, g);
  },
  gauge: (g, b) => {
    make("path", { d: `M ${b.x0 + 12} ${b.y1 - 6} h ${b.w - 24}`, class: "gauge-scale" }, g);
    make("path", { d: `M ${b.cx - 14} ${b.y1 - 10} v 8 M ${b.cx + 14} ${b.y1 - 10} v 8`, class: "gauge-error" }, g);
    make("path", { d: `M ${b.cx} ${b.y1 - 14} v 12`, class: "gauge-needle" }, g);
  },
  // Piège à mensonge : un effet *voulu* ne doit jamais ressembler à un phare.
  hologram: (g, b) => {
    for (const r of [16, 10, 4]) make("circle", { cx: b.x1 - 20, cy: 0, r, class: "holo-ring" }, g);
  },
  panel: (g, b) => make("path", { d: `M ${b.x0 + 18} ${b.y1} v 8 M ${b.x1 - 18} ${b.y1} v 8`, class: "panel-leg" }, g),
  sprout: (g, b) => {
    for (let i = 0; i < 3; i++) {
      const sx = b.x0 + 12 + i * 9;
      make("path", { d: `M ${sx} ${b.y1 - 3} q ${i % 2 ? 4 : -4} -7 0 -13`, class: "sprout-stem" }, g);
    }
  },
  pin: (g, b) => {
    make("line", { x1: b.x0 - 7, y1: b.y0 + 4, x2: b.x0 - 7, y2: b.y1 + 6, class: "pin-shaft" }, g);
    make("circle", { cx: b.x0 - 7, cy: b.y0 + 4, r: 4.5, class: "pin-head" }, g);
  },
  rig: (g, b) => make("path", {
    d: `M ${b.x0 + 6} ${b.y1 + 6} v -6 h ${b.w - 12} v 6 M ${b.cx} ${b.y1} v 6`, class: "rig-frame"
  }, g),
  tank: (g, b) => {
    make("path", { d: `M ${b.x0 + 8} ${b.y0 + 4} a 22 5 0 0 0 ${b.w - 16} 0`, class: "tank-rim" }, g);
    for (let i = 1; i <= 2; i++) make("line", { x1: b.x0 + 6, y1: b.y0 + i * (b.h / 3), x2: b.x1 - 6, y2: b.y0 + i * (b.h / 3), class: "tank-rib" }, g);
  },
  chasm_gate: (g, b) => {
    for (let i = 1; i <= 4; i++) {
      const bx = b.x0 + (b.w * i) / 5;
      make("line", { x1: bx, y1: b.y0 + 3, x2: bx, y2: b.y1 - 3, class: "gate-slat" }, g);
    }
  },
  switch: (g, b) => {
    make("path", { d: `M ${b.x0 - 4} ${b.y1 + 2} h ${b.w + 8}`, class: "switch-rail" }, g);
    make("path", { d: `M ${b.cx} ${b.y1 + 2} l 14 -12`, class: "switch-lever" }, g);
    make("circle", { cx: b.cx + 14, cy: b.y1 - 10, r: 3.5, class: "switch-knob" }, g);
  },
  siding: (g, b) => make("path", { d: `M ${b.x0 - 8} ${b.y1 + 2} q 14 0 22 -8`, class: "siding-branch" }, g),
  tower: (g, b) => {
    make("path", { d: `M ${b.x1 - 26} ${b.y0} l 6 -30 h 10 l 6 30`, class: "tower-body" }, g);
    make("line", { x1: b.x1 - 24, y1: b.y0 - 14, x2: b.x1 - 8, y2: b.y0 - 14, class: "tower-haze" }, g);
  },
  storm: (g, b) => {
    make("path", { d: `M ${b.x1 - 34} ${b.y0 - 6} a 9 9 0 0 1 18 -3 a 7 7 0 0 1 8 9 z`, class: "storm-cloud" }, g);
    make("path", { d: `M ${b.x1 - 22} ${b.y0 - 1} l -4 7 h 6 l -4 7`, class: "storm-bolt" }, g);
  },
  rostrum: (g, b) => {
    make("path", { d: `M ${b.x0 + 8} ${b.y1 + 5} h ${b.w - 16} l -6 -6 h -${b.w - 28} z`, class: "rostrum-stand" }, g);
    make("path", { d: `M ${b.x1 - 6} ${b.y0 + 8} q 14 12 0 24`, class: "rostrum-return" }, g);
  },
  pennant: (g, b) => {
    make("line", { x1: b.x0 - 7, y1: b.y0 - 6, x2: b.x0 - 7, y2: b.y1, class: "pennant-staff" }, g);
    make("path", { d: `M ${b.x0 - 7} ${b.y0 - 6} l 13 5 l -13 5 z`, class: "pennant-flag" }, g);
  },
  worksign: (g, b) => {
    make("path", { d: `M ${b.x0 + 14} ${b.y1} v 8 M ${b.x1 - 14} ${b.y1} v 8`, class: "panel-leg" }, g);
    make("path", { d: `M ${b.x0 + 6} ${b.y0 + 5} l ${b.w - 12} 0`, class: "worksign-band" }, g);
  },
  milestone: (g, b) => make("path", {
    d: `M ${b.x0 + 12} ${b.y1} v -6 a ${(b.w - 24) / 2} 10 0 0 1 ${b.w - 24} 0 v 6 z`, class: "milestone-stone"
  }, g)
};

// Ports : un port déclaré mais non raccordé se dessine **bouché**. C'est là que
// la donnée manquante se voit, objet par objet, sans compteur ni alarme.
function renderPorts(n, g, b) {
  if (!n.portState) return;
  const draw = (port, wired) => {
    if (port === "intake") {
      make("path", { d: `M ${b.x0 - 7} -9 h 7 v 18 h -7 z`, class: `port intake ${wired ? "wired" : "capped"}` }, g);
      if (!wired) make("line", { x1: b.x0 - 7, y1: -9, x2: b.x0, y2: 9, class: "port-cap-slash" }, g);
    } else if (port === "outlet") {
      make("path", { d: `M ${b.x1} -7 h 9 v 14 h -9 z`, class: `port outlet ${wired ? "wired" : "capped"}` }, g);
      if (!wired) make("line", { x1: b.x1 + 1, y1: -9, x2: b.x1 + 9, y2: 9, class: "port-cap-slash" }, g);
    } else if (port === "footing") {
      make("line", { x1: b.cx - 12, y1: b.y1 + 3, x2: b.cx + 12, y2: b.y1 + 3, class: `port footing ${wired ? "wired" : "capped"}` }, g);
    } else if (port === "cap") {
      make("line", { x1: b.cx - 10, y1: b.y0 - 3, x2: b.cx + 10, y2: b.y0 - 3, class: `port cap ${wired ? "wired" : "capped"}` }, g);
    } else if (port === "sensor") {
      make("circle", { cx: b.x0 + 8, cy: b.y1 - 8, r: 3, class: `port sensor ${wired ? "wired" : "capped"}` }, g);
    }
  };
  for (const port of n.portState.connected) draw(port, true);
  for (const port of n.portState.capped) draw(port, false);
}

function renderSilhouette(n, g, x0, y0, w, h) {
  const b = { x0, y0, x1: x0 + w, y1: y0 + h, w, h, cx: 0, cy: 0 };
  const shape = objectOf(n).shape;
  (SHAPES[shape] || SHAPES.panel)(g, b, n);
  renderPorts(n, g, b);
  if (n.machineState) g.classList.add(`mach-${n.machineState}`);
}


function ariaFor(n, vit) {
  const bits = [n.name, `${vit.label} : ${vit.note}`, n.semanticTypeLabel || n.nodeTypeLabel || n.semanticType || n.nodeType];
  if (n.waypoint) bits.unshift(`Étape ${n.waypoint} du chemin principal`);
  if (n.role === "objective") {
    const c = n.charge || { claimed: 0, quantified: 0 };
    bits.push(`Cible ${n.orientation === "adverse" ? "à éviter" : "visée"}`);
    bits.push(c.claimed
      ? `${c.quantified} des ${c.claimed} affirmations causales qui la visent sont chiffrées`
      : "aucune affirmation causale ne la vise");
  }
  return bits.join(". ") + ".";
}

// Dégradés de matière : la lumière vient du haut, comme sur un objet réel.
function buildDefs() {
  const defs = el("garden-defs");
  if (defs.dataset.built) return;
  // Un dégradé référencé par url() n'hérite pas des variables de l'élément qui
  // le référence : chaque matière nomme donc sa propre couleur de thème.
  const stops = {
    documented: [["0%", "var(--vit-documented)", 0.42], ["100%", "var(--vit-documented)", 0.13]],
    hypothesis: [["0%", "var(--vit-hypothesis)", 0.08], ["100%", "var(--vit-hypothesis)", 0.24]],
    proposal: [["0%", "var(--vit-proposal)", 0.11], ["100%", "var(--vit-proposal)", 0.03]],
    target: [["0%", "var(--vit-target)", 0.26], ["100%", "var(--vit-target)", 0.09]],
    // le mirage s'évapore vers le bas : il ne touche jamais le sol
    scenario: [["0%", "var(--vit-scenario)", 0.24], ["100%", "var(--vit-scenario)", 0]],
    ruin: [["0%", "var(--vit-ruin)", 0.05], ["100%", "var(--vit-ruin)", 0.22]],
    unresolved: [["0%", "var(--chasm-deep)", 0.62], ["100%", "var(--chasm-deep)", 0.2]]
  };
  for (const [key, list] of Object.entries(stops)) {
    const grad = make("linearGradient", { id: `fill-${key}`, x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    for (const [offset, color, opacity] of list) {
      const stop = make("stop", { offset }, grad);
      stop.style.stopColor = color;
      stop.style.stopOpacity = opacity;
    }
  }
  // halo du jardin : la lumière de la destination déborde sur le terrain
  const glow = make("radialGradient", { id: "garden-glow" }, defs);
  const g0 = make("stop", { offset: "55%" }, glow);
  g0.style.stopColor = "var(--el-growth)"; g0.style.stopOpacity = 0.16;
  const g1 = make("stop", { offset: "100%" }, glow);
  g1.style.stopColor = "var(--el-growth)"; g1.style.stopOpacity = 0;

  defs.dataset.built = "1";
}

const shortName = (name) => (name || "").replace(/^[^·]+·\s*/, "");

// Le jardin déborde de la carte de son nœud : la clairière doit entrer dans le
// cadre, sinon la destination sort de l'écran. Son rayon suffit — les ouvrages
// du pourtour sont déjà des parcelles, donc déjà dans la boîte.
function includeClearing(bb, g) {
  if (!g) return bb;
  const reach = g.r + 70;
  bb.x0 = Math.min(bb.x0, g.cx - reach); bb.x1 = Math.max(bb.x1, g.cx + reach);
  bb.y0 = Math.min(bb.y0, g.cy - reach); bb.y1 = Math.max(bb.y1, g.cy + reach);
  bb.w = bb.x1 - bb.x0; bb.h = bb.y1 - bb.y0;
  return bb;
}

// Le SVG cadre en `meet` : une boîte plus étroite que le volet laisse deux
// marges latérales et la moitié du zoom demandé. On l'étire donc à la forme du
// volet, pour que l'échelle affichée soit celle qu'on croit avoir.
function frameToViewport(bb, W, H) {
  const aspect = W / H;
  let w = bb.w, h = bb.h;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  return { x0: cx - w / 2, y0: cy - h / 2, w, h, W, H };
}

// Ce qu'on cadre au chargement : la destination, pas la carte. Un district de
// 53 parcelles occupe trois fois l'aire du volet ; tout montrer d'un coup rend
// chaque nom sous-pixel, c'est-à-dire ne montre rien. Cadrer l'avenue entière
// ne sauve rien non plus — elle traverse toutes les voies par construction.
// La caméra s'ouvre donc sur ce que le briefing annonce en premier : le jardin
// et les ouvrages qui le définissent. « Tout voir » reste la carte complète, et
// toute sélection amène la caméra à la parcelle.
function storyViewBox(W, H) {
  const g = view.gardenLayout;
  const focus = [];
  if (g) {
    focus.push(g.hub, ...g.rim);
    if (g.fruit) focus.push(g.fruit);
  } else {
    // sans jardin, la destination est la cible observable et la fin de l'avenue
    const tail = view.story.path.slice(-3).filter((n) => view.byId.has(n.id));
    const goal = view.story.objectives[0];
    if (goal && view.byId.has(goal.id)) focus.push(view.byId.get(goal.id));
    focus.push(...tail);
  }
  if (focus.length < 2) return null;
  return frameToViewport(includeClearing(boxOf(focus, 110), g), W, H);
}

function fitViewBox(W, H) {
  view.fitVb = frameToViewport(includeClearing(boxOf(view.nodes, 80), view.gardenLayout), W, H);
  const story = storyViewBox(W, H);
  // jamais plus large que la carte entière : sur un petit district, le récit
  // *est* la carte, et l'ouvrir davantage ne montrerait que du vide.
  applyCamera(story && story.w < view.fitVb.w ? story : view.fitVb);
}

function applyCamera(next) {
  view.vb = { ...next };
  svg.setAttribute("viewBox", `${next.x0} ${next.y0} ${next.w} ${next.h}`);
  const zoom = view.fitVb ? view.fitVb.w / next.w : 1;
  el("garden-zoom-level").value = `${Math.round(zoom * 100)} %`;
  if (params.has("debug")) window.__gardenCamera = { ...view.vb, zoom };
}

function zoomCamera(factor, clientX, clientY) {
  if (!view.vb || !view.fitVb) return;
  const rect = svg.getBoundingClientRect();
  const point = clientPointToGraph(view.vb, { width: rect.width, height: rect.height }, {
    x: clientX - rect.left,
    y: clientY - rect.top
  });
  applyCamera(zoomViewBox(view.vb, point, factor, {
    minW: view.fitVb.w / 12,
    maxW: view.fitVb.w * 3
  }));
}

function zoomFromCenter(factor) {
  const rect = svg.getBoundingClientRect();
  zoomCamera(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function bindCamera() {
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomCamera(Math.exp(event.deltaY * 0.0015), event.clientX, event.clientY);
  }, { passive: false });

  svg.addEventListener("pointerdown", (event) => {
    if (!view.vb) return;
    const interactive = event.target.closest?.(".parcel, .garden-hit");
    if ((event.button !== 0 && event.button !== 1) || (event.button === 0 && interactive)) return;
    const rect = svg.getBoundingClientRect();
    panGesture = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scale: viewportScale(view.vb, { width: rect.width, height: rect.height })
    };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-panning");
    event.preventDefault();
  });

  svg.addEventListener("pointermove", (event) => {
    if (!panGesture || panGesture.pointerId !== event.pointerId) return;
    const dx = (event.clientX - panGesture.clientX) / panGesture.scale;
    const dy = (event.clientY - panGesture.clientY) / panGesture.scale;
    applyCamera(panViewBox(view.vb, -dx, -dy));
    panGesture.clientX = event.clientX;
    panGesture.clientY = event.clientY;
  });

  const endPan = (event) => {
    if (!panGesture || panGesture.pointerId !== event.pointerId) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    panGesture = null;
    svg.classList.remove("is-panning");
  };
  svg.addEventListener("pointerup", endPan);
  svg.addEventListener("pointercancel", endPan);
}

// --- Canvas : particules de flux (FEEDS) -------------------------------------
function resizeCanvas() {
  const r = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function vbToPx(x, y, r) {
  // mappe une coordonnée viewBox vers l'espace pixel du canvas (préserve le ratio de meet)
  const vb = view.vb; const scale = Math.min(r.width / vb.w, r.height / vb.h);
  const ox = (r.width - vb.w * scale) / 2, oy = (r.height - vb.h * scale) / 2;
  return { x: (x - vb.x0) * scale + ox, y: (y - vb.y0) * scale + oy, scale };
}
// Le trafic d'un pont dit ce que l'arête ose affirmer, et rien de plus.
// Un pont chiffré fait circuler des porteurs réguliers ; une affirmation nue ne
// laisse passer qu'une lueur rare ; une buse bouchée ne fait rien passer du tout.
// Un pont désert n'est donc pas un oubli de dessin : c'est un mécanisme qui ne
// produit rien, et ça se voit sans lire une seule étiquette.
function buildTraffic() {
  view.flows = [];
  for (const l of view.links) {
    if (!CONVERGING_PREDICATES.has(l.type)) continue;
    const a = view.byId.get(l.source), b = view.byId.get(l.target);
    if (!a || !b) continue;
    const quantified = typeof l.effectSizePct === "number";
    const outletCapped = a.portState?.capped.includes("outlet")
      && (l.type === "CAUSES" || l.type === "LEADS_TO");
    if (outletCapped) continue;                       // rien ne sort d'une buse bouchée
    const confidence = typeof l.confidenceScore === "number" ? l.confidenceScore : 0;
    view.flows.push({
      a, b, quantified,
      count: quantified ? 3 + Math.round(confidence * 3) : 1,
      speed: quantified ? 0.3 + confidence * 0.25 : 0.09,
      alpha: quantified ? 0.85 : 0.3
    });
  }
}

function drawFlows() {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  if (!view.vb) return;
  const t = performance.now() / 1000;
  for (let f = 0; f < view.flows.length; f++) {
    const { a, b, count, speed, alpha, quantified } = view.flows[f];
    if (view.focusId && !view.showDimmedContext && a.id !== view.focusId && b.id !== view.focusId) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y; const qx = mx - dy * 0.16, qy = my + dx * 0.16;
    for (let i = 0; i < count; i++) {
      const u = (t * speed + i / count + f * 0.13) % 1, iu = 1 - u;
      const x = iu * iu * a.x + 2 * iu * u * qx + u * u * b.x;
      const y = iu * iu * a.y + 2 * iu * u * qy + u * u * b.y;
      const p = vbToPx(x, y, r);
      const rad = (quantified ? 2.6 : 1.8) * (0.6 + 0.6 * Math.sin(u * Math.PI)) * (p.scale || 1);
      const hue = 190 + 60 * u; // eau (cyan) → énergie (ambre)
      const a2 = alpha * (0.35 + 0.65 * Math.sin(u * Math.PI));
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.1, rad), 0, 6.283);
      ctx.fillStyle = `hsla(${hue}, 90%, 62%, ${a2})`;
      ctx.shadowColor = `hsla(${hue}, 90%, 62%, .8)`;
      ctx.shadowBlur = (quantified ? 9 : 4) * (p.scale || 1);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
}
let lastFrame = null;
function tick(now) {
  const dt = lastFrame === null ? 0 : Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (motion && view.flows.length) drawFlows();
  if (motion && walker) advanceWalker(dt);
  rafId = requestAnimationFrame(tick);
}

// --- Le marcheur : la loi L4 qui traverse la ville ----------------------------
// Ce n'est pas une animation posée sur le graphe. `l4-physical-propagation-rule`
// est une loi *proposée*, dont le nœud dit lui-même qu'elle n'est pas calibrée :
// la faire marcher sur le corpus réel est le seul moyen de savoir ce qu'elle
// sait faire. Le marcheur porte une lanterne dont l'éclat **est** I(t) ; il ne
// s'arrête jamais, il s'affaiblit — et là où la loi n'a pas de valeur, sa
// lanterne devient creuse plutôt qu'éteinte : indéterminé n'est pas nul.

const WALK = { speed: 260, pause: 0.5 };   // unités/s, et le temps d'un heurt

// Les arêtes réellement empruntées par l'avenue, dans l'ordre de la marche.
function avenueEdges(path, links) {
  const chain = [];
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i], to = path[i + 1];
    const link = links.find((l) => l.source === from.id && l.target === to.id)
      || links.find((l) => l.source === to.id && l.target === from.id);
    if (link) chain.push({ link, from, to });
  }
  return chain;
}

// L'état de la porte, au sens de la loi : « part de l'influence autorisée par un
// sous-graphe de conditions ». Un verrou ouvert ferme ; un verrou traité par un
// ADDRESSES n'est ni ouvert ni validé, et c'est là que la loi devient muette.
function gateStateFor(link, story) {
  let state = "open";
  for (const gate of story.gates) {
    if (!gate.blocks.some((n) => n.id === link.target)) continue;
    if (!gate.answered) return "blocked";
    state = "addressed";
  }
  return state;
}

function buildWalk() {
  const edges = avenueEdges(view.story.path, view.links);
  if (!edges.length) return null;
  const run = walk(edges.map((e) => e.link), {
    gateStateOf: (link) => gateStateFor(link, view.story)
  });
  const segments = edges.map((edge, i) => {
    const step = run.steps[i];
    const length = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
    const gate = gateStateFor(edge.link, view.story);
    return {
      ...edge, step, length, gate,
      // Le heurt est un fait de porte, pas un fait d'influence. Confondre les
      // deux faisait « heurter » un tronçon parfaitement ouvert, au seul motif
      // que son influence était déjà nulle en arrivant : la conséquence prise
      // pour la cause.
      collides: gate === "blocked"
    };
  });
  return { segments, run, total: segments.reduce((s, x) => s + x.length, 0) };
}

function renderWalk() {
  layers.walk.replaceChildren();
  if (!walker) return;
  const g = make("g", { class: "walker", "aria-hidden": "true" }, layers.walk);
  walker.halo = make("circle", { cx: 0, cy: 0, r: 26, class: "walker-halo" }, g);
  walker.lamp = make("circle", { cx: 0, cy: 0, r: 7, class: "walker-lamp" }, g);
  make("circle", { cx: 0, cy: 0, r: 11, class: "walker-ring" }, g);
  walker.readout = make("text", { x: 0, y: -30, class: "walker-readout" }, g);
  walker.g = g;

  // Sans mouvement, la même information sans l'animation : une lanterne posée au
  // milieu de chaque tronçon, à l'éclat que la loi lui donne.
  if (!motion) {
    for (const seg of walker.segments) {
      const mx = (seg.from.x + seg.to.x) / 2, my = (seg.from.y + seg.to.y) / 2;
      const still = make("g", { class: `walker-still ${lampClass(seg.step)}`, transform: `translate(${mx} ${my})` }, layers.walk);
      make("circle", { cx: 0, cy: 0, r: 7, class: "walker-lamp" }, still);
      make("text", { x: 0, y: -16, class: "walker-readout" }, still).textContent = lampLabel(seg.step);
    }
    g.style.display = "none";
  }
}

// Trois états, et ils ne se confondent pas : allumée, éteinte, indéterminée.
// Une influence nulle est un résultat de la loi — la lanterne est éteinte. Une
// influence que la loi ne sait pas calculer n'est pas nulle : la lanterne est
// creuse. Afficher « allumée » à I = 0 laissait croire que quelque chose passe.
const lampClass = (step) => {
  if (!step) return "lamp-out";
  if (step.indeterminate) return "lamp-unknown";
  return step.influence === 0 ? "lamp-out" : "lamp-lit";
};

function lampLabel(step) {
  if (!step) return "";
  if (step.indeterminate) return "I indéterminé";
  return `I = ${step.influence.toFixed(3)}`;
}

// Avance le marcheur. L'éclat de la lanterne est |I| du tronçon courant : il ne
// code rien d'autre, et surtout pas une confiance qu'on aurait choisie.
function advanceWalker(dt) {
  if (!walker || !walker.g) return;
  walker.t += dt;
  let travelled = walker.t * WALK.speed;
  let index = 0;
  while (index < walker.segments.length && travelled > walker.segments[index].length) {
    travelled -= walker.segments[index].length;
    index += 1;
  }
  if (index >= walker.segments.length) {
    const last = walker.segments[walker.segments.length - 1];
    place(last.to.x, last.to.y, last.step);
    if (!walker.reported) { walker.reported = true; reportWalk(); }
    return;
  }
  const seg = walker.segments[index];
  const u = seg.length ? travelled / seg.length : 1;
  // le heurt : devant une porte fermée, le marcheur bute et repart amoindri
  const bump = seg.collides && u > 0.55 && u < 0.75 ? Math.sin((u - 0.55) * 31) * 9 : 0;
  const x = seg.from.x + (seg.to.x - seg.from.x) * u - bump;
  const y = seg.from.y + (seg.to.y - seg.from.y) * u;
  place(x, y, seg.step);
}

function place(x, y, step) {
  walker.g.setAttribute("transform", `translate(${x} ${y})`);
  walker.g.setAttribute("class", `walker ${lampClass(step)}`);
  const intensity = step && !step.indeterminate ? Math.min(1, Math.abs(step.influence)) : 0;
  walker.halo.setAttribute("r", (10 + intensity * 30).toFixed(1));
  walker.halo.style.opacity = (0.12 + intensity * 0.55).toFixed(2);
  walker.readout.textContent = lampLabel(step);
}

// Ce que la marche a produit. Un résultat d'expérience : ce que la loi a calculé,
// ce qu'elle a dû supposer, et ce qu'elle n'a pas su voir.
function reportWalk() {
  const box = el("garden-walk-report");
  box.hidden = false;
  box.replaceChildren();
  const add = (cls, text, tag = "p") => {
    const e = document.createElement(tag); e.className = cls; e.textContent = text; box.appendChild(e); return e;
  };
  add("walk-kicker", "MARCHE L4 · RÉSULTAT");
  add("walk-equation", L4_EQUATION);

  const steps = walker.run.steps;
  const unknown = steps.filter((s) => s.indeterminate).length;
  const arrival = walker.run.arrival;
  add("walk-line", arrival === null
    ? `La loi n'a rien pu calculer jusqu'au bout : ${unknown} pas sur ${steps.length} sont indéterminés.`
    : `Influence à l'arrivée : ${arrival.toFixed(3)} après ${steps.length} pas, partie de 1.`);

  // Une porte fermée met G à zéro, et la loi est un produit : tout ce qui suit
  // est annulé, définitivement. Elle n'a aucun terme qui puisse rétablir une
  // influence éteinte — c'est une propriété de la loi, pas de ce district.
  const blocked = walker.segments.filter((s) => s.gate === "blocked");
  if (blocked.length) {
    add("walk-line", `${blocked.length} porte${blocked.length > 1 ? "s" : ""} fermée${blocked.length > 1 ? "s" : ""} : `
      + "G = 0 annule le produit, et la loi n'a aucun terme capable de rallumer une influence éteinte en aval.");
  }

  // Le résultat central, et il est dur : aucun des trois champs qui portent la
  // preuve dans le corpus n'est une dimension de la loi. La ville montre la
  // différence entre un pont de pierre et un pont de corde ; la loi ne la voit
  // pas. C'est ce que cette expérience mesure.
  const stone = walker.segments.filter((s) => typeof s.link.effectSizePct === "number").length;
  add("walk-finding", stone
    ? `${stone} tronçon${stone > 1 ? "s" : ""} de cette avenue ${stone > 1 ? "sont" : "est"} chiffré${stone > 1 ? "s" : ""}, `
      + "et la loi leur a donné exactement la même influence qu'à une affirmation nue : "
      + "effectSizePct, confidenceScore et evidenceBasis ne sont dimensions d'aucun de ses facteurs."
    : "Aucun tronçon de cette avenue n'est chiffré — et la loi ne l'aurait pas vu de toute façon : "
      + "effectSizePct, confidenceScore et evidenceBasis ne sont dimensions d'aucun de ses facteurs.");

  add("walk-sub", "Ce que l'expérience a dû stipuler faute de donnée :");
  const ul = document.createElement("ul"); ul.className = "walk-stipulations";
  for (const [factor, why] of Object.entries(STIPULATIONS)) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${factor}</strong> — ${why}`;
    ul.appendChild(li);
  }
  box.appendChild(ul);
}

function startWalk() {
  const built = buildWalk();
  const button = el("walk-toggle");
  if (!built) {
    el("garden-walk-report").hidden = false;
    el("garden-walk-report").textContent =
      "Ce district n'a pas d'avenue : sans chemin, la loi n'a rien à parcourir.";
    return;
  }
  walker = { ...built, t: 0, reported: false };
  button.setAttribute("aria-pressed", "true");
  button.textContent = "Arrêter la marche";
  renderWalk();
  // Le résultat de l'expérience est calculé par buildWalk(), pas par l'animation.
  // On le publie donc au lancement : un résultat falsifiable ne doit jamais
  // dépendre du rythme d'affichage (onglet en arrière-plan, rAF gelé). La marche
  // visualise ensuite cette propagation déjà calculée ; elle ne la produit pas.
  reportWalk();
  walker.reported = true;
  // Même contrat que `window.__garden` : la marche doit pouvoir être vérifiée
  // pas à pas depuis la console, sans dépendre du rythme d'affichage.
  if (params.has("debug")) window.__walk = { state: () => walker, advance: advanceWalker };
}

function stopWalk() {
  walker = null;
  layers.walk.replaceChildren();
  // le rapport est vidé, pas seulement masqué : un résultat d'expérience qui
  // survit à son district serait attribué au mauvais corpus
  el("garden-walk-report").replaceChildren();
  el("garden-walk-report").hidden = true;
  const button = el("walk-toggle");
  button.setAttribute("aria-pressed", "false");
  button.textContent = "Tester la propagation L4";
}

function resetInspector() {
  selectedId = null;
  view.focusId = null;
  for (const g of layers.nodes.children) g.classList.remove("selected", "faded", "focus-hidden");
  for (const layer of [layers.roads, layers.walls, layers.roots]) {
    for (const item of layer.children) item.classList.remove("focus-dimmed", "focus-hidden");
  }
  el("garden-detail-kicker").textContent = "Lecture du district";
  el("garden-detail-name").textContent = "Choisis une parcelle";
  el("garden-detail-vitality").textContent = "";
  el("garden-detail-phrase").textContent = "La carte montre d’abord la destination et le chemin principal. Clique sur une parcelle pour comprendre son rôle sans perdre le reste du district.";
  el("garden-detail-summary").textContent = "";
  el("garden-detail-relations").replaceChildren();
}

// --- Interaction --------------------------------------------------------------
function select(id, { pan = false } = {}) {
  selectedId = id; const n = view.byId.get(id); if (!n) return;
  if (pan) revealParcel(n);
  for (const g of layers.nodes.children) g.classList.toggle("selected", g.dataset.id === id);
  const vit = vitalityOf(n);
  el("garden-detail-kicker").textContent = `${n.semanticTypeLabel || n.nodeTypeLabel || n.semanticType || n.nodeType} · district ${districtLabel(n.clusterId)}`;
  el("garden-detail-name").textContent = n.name;
  const chip = `<span class="vit-chip" style="background:var(${vit.var})">${vit.label}</span>`;
  el("garden-detail-vitality").innerHTML = `Matière : ${chip} — ${vit.note}. La forme traduit le statut épistémique, pas une vérité.`;
  el("garden-detail-phrase").textContent = n.phrase || "";
  el("garden-detail-summary").textContent = n.summary || "";
  renderRelations(n);
  // Un `terme` défini expose sa définition et son contexte au survol : le
  // mécanisme existait dans app.js et la cité-jardin l'ignorait.
  installTermReferences(el("garden-details"), all.nodes);
  highlight(id, true, true);
}

// La caméra n'ouvre plus sur la carte entière : « Commencer ici », un clic sur
// une relation ou une flèche du clavier pourraient désigner une parcelle hors
// champ. Sélectionner sans amener la caméra reviendrait à inspecter à l'aveugle.
function revealParcel(n) {
  if (!view.vb) return;
  const k = cardOf(n);
  const marginX = view.vb.w * 0.12, marginY = view.vb.h * 0.12;
  const inside = n.x - k.w / 2 > view.vb.x0 + marginX && n.x + k.w / 2 < view.vb.x0 + view.vb.w - marginX
    && n.y - k.h / 2 > view.vb.y0 + marginY && n.y + k.h / 2 < view.vb.y0 + view.vb.h - marginY;
  if (inside) return;                        // déjà lisible : ne pas bouger le décor pour rien
  applyCamera({ ...view.vb, x0: n.x - view.vb.w / 2, y0: n.y - view.vb.h / 2 });
}

function renderRelations(n) {
  const box = el("garden-detail-relations"); box.replaceChildren();
  const rels = view.links.filter((l) => l.source === n.id || l.target === n.id);
  if (!rels.length) { box.innerHTML = "<p class='detail-source'>Aucune relation dans ce district.</p>"; return; }
  const h = document.createElement("h4"); h.textContent = "Affordances reliées"; h.className = "presentation-relations"; box.appendChild(h);
  for (const l of rels) {
    const out = l.source === n.id; const other = view.byId.get(out ? l.target : l.source);
    const row = document.createElement("div"); row.className = "rel-row";
    const verb = l.afford.verb;
    row.innerHTML = `${out ? "→" : "←"} <strong>${other.name}</strong><span class="rel-verb">${out ? verb : "reçoit : " + verb}</span>`
      + `<span class="rel-afford">affordance : ${l.afford.kind} — ${l.afford.scaffoldNote}</span>`
      + (l.causal ? causalMaterialLine(l.causal) : "");
    row.addEventListener("click", () => select(other.id, { pan: true }));
    row.style.cursor = "pointer";
    box.appendChild(row);
  }
}

// L'information ne passe jamais par la seule forme : la matière d'un
// franchissement causal est aussi dite en toutes lettres dans l'inspecteur.
function causalMaterialLine(c) {
  const anchor = c.corroborated ? " · ancré par une preuve reliée" : "";
  return `<span class="rel-material ${c.material.key}">matière : <strong>${c.material.label}</strong> — ${c.reason}${anchor}</span>`;
}

function highlight(id, on, sticky = false) {
  if (!on && sticky) return;
  const active = on ? id : selectedId;
  const showDimmed = el("toggle-dimmed-context").checked;
  view.focusId = active;
  view.showDimmedContext = showDimmed;
  const neigh = new Set([active]);
  if (active) view.links.forEach((l) => { if (l.source === active) neigh.add(l.target); if (l.target === active) neigh.add(l.source); });
  for (const g of layers.nodes.children) {
    const outside = active && !neigh.has(g.dataset.id);
    g.classList.toggle("faded", outside && showDimmed);
    g.classList.toggle("focus-hidden", outside && !showDimmed);
  }
  const filterLinks = (coll) => { for (const p of coll.children) {
    const s = p.dataset.src, tt = p.dataset.tgt; if (!s) continue;
    const outside = active && s !== active && tt !== active;
    p.classList.toggle("focus-dimmed", outside && showDimmed);
    p.classList.toggle("focus-hidden", outside && !showDimmed);
  } };
  for (const layer of [layers.roads, layers.walls, layers.roots]) filterLinks(layer);
}

function onNodeKey(e, n) {
  const gs = [...layers.nodes.children].filter((g) =>
    !g.classList.contains("focus-hidden") && g.style.display !== "none");
  const i = gs.indexOf(n._g);
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(n.id); return; }
  let next = null;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = gs[(i + 1) % gs.length];
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = gs[(i - 1 + gs.length) % gs.length];
  if (next) { e.preventDefault(); next.focus(); }
}

function applyToggles() {
  layers.roots.style.display = el("toggle-roots").checked ? "" : "none";
  const nb = el("toggle-neighbors").checked;
  for (const g of layers.nodes.children) if (g.classList.contains("satellite")) g.style.display = nb ? "" : "none";
  layers.districts.querySelectorAll(".district-zone.satellite").forEach((z) => z.style.display = nb ? "" : "none");
}

// Le briefing d'entrée de niveau. Il répond, dans l'ordre, aux quatre questions
// qu'un lecteur se pose : où suis-je, où ça va, qu'est-ce qui bloque, par où je
// commence. Sans lui, la vue demandait de deviner les quatre.
function buildBriefing() {
  const story = view.story;
  const box = el("garden-briefing");
  box.replaceChildren();
  const add = (cls, text, tag = "p") => {
    const e = document.createElement(tag); e.className = cls; e.textContent = text; box.appendChild(e); return e;
  };

  add("brief-kicker", districtLabel(view.mainCluster).toUpperCase());

  // De quoi parle ce district, avant de dire où il va. Le document source porte
  // déjà cette note de contexte ; ne pas l'afficher obligeait à deviner le sujet.
  const doc = view.nodes.find((n) => (n.semanticType || n.nodeType) === "source_document" && !n.satellite)
    || view.nodes.find((n) => (n.semanticType || n.nodeType) === "source_document");
  if (doc?.phrase) add("brief-context", doc.phrase);

  // Le briefing annonce ce que la ville montre : le jardin, c'est-à-dire le
  // point sur lequel le district met réellement son poids. Annoncer l'état
  // observable pendant que la clairière en désigne un autre était une
  // contradiction entre le texte et le dessin.
  const garden = story.garden;
  const fruit = story.objectives.find((o) => !garden || o.id !== garden.node.id);
  if (garden) {
    add("brief-goal-label", "Tout ce district converge sur");
    add("brief-goal desirable", shortName(garden.node.name));
    add("brief-indicator", `${garden.convergence} ouvrages le bâtissent : ${garden.defines.map((e) => shortName(e.node.name)).join(", ")}.`);
    if (fruit) {
      add("brief-fruit-label", fruit.orientation === "adverse" ? "Et débouche sur un état à éviter" : "Et débouche sur");
      const f = add("brief-fruit", shortName(fruit.name));
      f.classList.add(fruit.orientation === "adverse" ? "adverse" : "desirable");
      if (fruit.stateIndicator) add("brief-indicator", `Indicateur : ${fruit.stateIndicator}`);
    }
  } else if (fruit) {
    add("brief-goal-label", fruit.orientation === "adverse" ? "État à éviter" : "Ce district cherche à déplacer");
    add("brief-goal", shortName(fruit.name)).classList.add(fruit.orientation === "adverse" ? "adverse" : "desirable");
    if (fruit.stateIndicator) add("brief-indicator", `Indicateur : ${fruit.stateIndicator}`);
  } else {
    add("brief-goal-label void", "Aucune cible observable");
    add("brief-void", story.voidReason || "");
  }
  const c = fruit?.charge;
  if (c) {
    const plural = c.claimed > 1 ? "s" : "";
    add("brief-charge", c.claimed
      ? `${c.quantified}/${c.claimed} affirmation${plural} causale${plural} chiffrée${plural} vers cette cible`
      : "Aucune affirmation causale ne vise cette cible.");
  }

  // Un ADDRESSES dit qu'une proposition traite la question, jamais qu'elle est
  // validée. Annoncer « aucun verrou » parce que tout est adressé serait le
  // mensonge exact que cette vue combat.
  const blocking = story.gates.filter((g) => g.blocks.length);
  const open = blocking.filter((g) => !g.answered);
  const addressed = blocking.length - open.length;
  if (!blocking.length) add("brief-gates", "Aucun verrou ne barre la route.");
  else {
    if (open.length) add("brief-gates open", `${open.length} verrou${open.length > 1 ? "s" : ""} ouvert${open.length > 1 ? "s" : ""} barre${open.length > 1 ? "nt" : ""} la route.`);
    if (addressed) add("brief-gates", `${addressed} verrou${addressed > 1 ? "s" : ""} traité${addressed > 1 ? "s" : ""} par une réponse, mais aucune n'est validée.`);
  }

  if (story.entry) {
    const start = add("brief-start", `Commencer ici → ${shortName(story.entry.name)}`, "button");
    start.type = "button";
    start.addEventListener("click", () => { select(story.entry.id, { pan: true }); story.entry._g?.focus(); });
  }
  if (story.reach.stranded) {
    add("brief-stranded", `${story.reach.stranded} parcelle${story.reach.stranded > 1 ? "s" : ""} sur ${story.reach.total} ne mène${story.reach.stranded > 1 ? "nt" : ""} à aucune cible.`);
  }
}

function buildA11y() {
  const crossings = view.links.filter((l) => l.causal);
  const solid = crossings.filter((l) => l.causal.quantified).length;
  const causalLine = crossings.length
    ? `${crossings.length} franchissements causaux, dont ${solid} chiffrés`
    : "aucun franchissement causal dans ce district";

  el("garden-a11y-count").textContent = `${view.nodes.length} parcelles · ${causalLine}`;
  const ul = el("garden-a11y-list"); ul.replaceChildren();
  for (const n of view.nodes) {
    const li = document.createElement("li");
    li.textContent = `${n.name} — ${vitalityOf(n).label}`;
    ul.appendChild(li);
  }
  const scope = parcelScope(view.nodes);
  el("node-count").textContent = scope.neighbors ? `${scope.district} + ${scope.neighbors} parcelles` : `${scope.district} parcelles`;
  el("garden-cluster-summary").textContent = `${scope.label}. La vue s’ouvre sur la destination ; « Cadrer tout le district » montre l’ensemble.`;
  const stat = el("causal-stat");
  stat.textContent = crossings.length ? `${solid}/${crossings.length} causal chiffré` : "";
  stat.classList.toggle("deficit", crossings.length > 0 && solid < crossings.length);
  stat.title = crossings.length
    ? "Un franchissement non chiffré est rendu en pont de corde : il ne porte ni effectSizePct, ni base de preuve."
    : "";
}

// --- Cycle de vie -------------------------------------------------------------
function updateWalkControl() {
  const state = walkAvailability(view.story);
  const button = el("walk-toggle");
  button.disabled = !state.enabled;
  button.title = state.note;
}

function relayoutAndRender() {
  const r = el("garden-wrap").getBoundingClientRect();
  const W = Math.max(600, r.width), H = Math.max(400, r.height);
  layout(view, W, H);
  render(W, H);
  resizeCanvas();
  if (params.has("debug")) window.__garden = view;
}

async function show(clusterId, { updateUrl = false } = {}) {
  try {
    // Toute reconstruction de la vue (district ou faubourgs) doit d'abord clore
    // la marche : un résultat d'expérience survivant à son corpus serait faux.
    stopWalk();
    view = buildCluster(clusterId, el("toggle-neighbors").checked);
    view.mainCluster = clusterId;
    el("garden-empty").hidden = view.nodes.length > 0;
    relayoutAndRender();
    resetInspector();
    updateWalkControl();
    if (updateUrl) history.replaceState(null, "", clusterHref(location.href, clusterId));
  } catch (err) {
    el("garden-empty").hidden = false; el("garden-empty").textContent = `Erreur : ${err.message}`;
  }
}

function bindControls() {
  el("garden-cluster").addEventListener("change", (e) => show(e.target.value, { updateUrl: true }));
  el("walk-toggle").addEventListener("click", () => (walker ? stopWalk() : startWalk()));
  el("toggle-roots").addEventListener("change", applyToggles);
  el("toggle-neighbors").addEventListener("change", () => show(el("garden-cluster").value));
  el("toggle-dimmed-context").addEventListener("change", () => highlight(selectedId, true, true));
  el("toggle-motion").addEventListener("change", (e) => { motion = e.target.checked; if (!motion) { const r = canvas.getBoundingClientRect(); ctx.clearRect(0, 0, r.width, r.height); } });
  el("garden-zoom-out").addEventListener("click", () => zoomFromCenter(1.25));
  el("garden-zoom-in").addEventListener("click", () => zoomFromCenter(0.8));
  el("garden-fit").addEventListener("click", () => { if (view.fitVb) applyCamera(view.fitVb); });
  el("legend-toggle").addEventListener("click", (e) => {
    const lg = el("garden-legend"); const open = lg.hidden; lg.hidden = !open;
    e.currentTarget.setAttribute("aria-pressed", String(open));
  });
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    motion = false; el("toggle-motion").checked = false;
  }
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(relayoutAndRender, 180); });
  bindCamera();
}

async function main() {
  try {
    el("db-status").textContent = "chargement…";
    all = await loadGraph();
    el("db-status").textContent = `${all.nodes.length} nœuds`;
    populateClusterSelect(all.nodes);
    bindControls();
    // `?cluster=` (vide) désigne le cœur Mind Protocol, pas une absence de choix.
    const values = [...el("garden-cluster").options].map((o) => o.value);
    const start = chooseStartCluster(values, params);
    el("garden-cluster").value = start;
    await show(el("garden-cluster").value);
    tick();
  } catch (err) {
    el("db-status").textContent = "API indisponible";
    el("garden-empty").hidden = false;
    el("garden-empty").textContent = `Le moteur du graphe est injoignable (${err.message}). Lance docker + npm start.`;
  }
}
main();
