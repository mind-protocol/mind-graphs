// npm run consult:draft            → liste les points du graphe qui gagneraient à être soumis
// npm run consult:draft -- --apply → écrit les consultations dans data/consultations.json
//                                    et les brouillons de post dans artifacts/consultations/
//
// Ce script ne publie rien et n'appelle aucun réseau. Il prépare un texte ; la publication est un
// acte humain, et un statut `published` écrit par un script affirmerait une action qui n'a pas eu
// lieu. Les consultations naissent donc toutes en `draft`.
//
// Options : --limit=N, --categories=a,b --channel=reddit --date=YYYY-MM-DD

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { analyzeGraph } from "../public/graph-analysis.js";
import { loadCorpus } from "../src/corpus.js";
import {
  CONSULTABLE_CATEGORIES, buildConsultationNode, renderConsultationPost, selectConsultationCandidates
} from "../src/consultation.js";

const projectDir = new URL("../", import.meta.url);
const consultationsPath = new URL("data/consultations.json", projectDir);
const artifactsDir = new URL("artifacts/consultations/", projectDir);

const flag = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const apply = process.argv.includes("--apply");
const limit = Number(flag("limit") || 5);
const channel = flag("channel") || "reddit";
const today = flag("date") || new Date().toISOString().slice(0, 10);
const categories = flag("categories")?.split(",").filter(Boolean) || CONSULTABLE_CATEGORIES;

const unknown = categories.filter(category => !CONSULTABLE_CATEGORIES.includes(category));
if (unknown.length) {
  console.error(`Catégories inconnues : ${unknown.join(", ")}. Connues : ${CONSULTABLE_CATEGORIES.join(", ")}`);
  process.exit(1);
}

const { nodes, links } = await loadCorpus();
const report = analyzeGraph(nodes, links);
const store = JSON.parse(await readFile(consultationsPath, "utf8"));
const existingKeys = new Set(store.nodes.filter(node => node.nodeType === "consultation").map(node => node.id));

const candidates = selectConsultationCandidates(report, { nodes, limit, categories, existingKeys });

const drafts = candidates.map(candidate => ({
  candidate,
  ...buildConsultationNode(candidate, { today, channel }),
  markdown: renderConsultationPost(candidate, { today })
}));

const summary = {
  mode: apply ? "apply" : "dry-run",
  methodVersion: report.methodVersion,
  channel,
  scanned: report.findings.length,
  eligible: report.findings.filter(finding => categories.includes(finding.category)).length,
  alreadyConsulted: existingKeys.size,
  selected: drafts.map(draft => ({
    id: draft.node.id,
    category: draft.candidate.finding.category,
    score: Math.round(draft.candidate.score),
    title: draft.candidate.finding.title,
    consults: draft.links.map(link => link.target)
  }))
};

if (apply && drafts.length) {
  await mkdir(artifactsDir, { recursive: true });
  for (const draft of drafts) {
    await writeFile(new URL(`${draft.node.id}.md`, artifactsDir), draft.markdown, "utf8");
  }
  store.nodes.push(...drafts.map(draft => draft.node));
  store.links.push(...drafts.flatMap(draft => draft.links));
  await writeFile(consultationsPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  summary.written = {
    file: "data/consultations.json",
    consultations: drafts.length,
    links: drafts.reduce((total, draft) => total + draft.links.length, 0),
    drafts: drafts.map(draft => `artifacts/consultations/${draft.node.id}.md`)
  };
  summary.next = "Relire et adapter chaque brouillon, le publier soi-même, puis exécuter npm run consult:ingest.";
} else if (apply) {
  summary.written = { consultations: 0, reason: "aucun point consultable qui ne le soit déjà" };
} else {
  summary.hint = "Relancer avec --apply pour écrire les consultations et leurs brouillons de post.";
}

console.log(JSON.stringify(summary, null, 2));
