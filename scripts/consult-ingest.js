// npm run consult:ingest -- --consultation=<id> --thread=data/sources/<fichier>.txt --url=<url>
//
// Enregistre qu'une consultation a été publiée, puis découpe le fil rapporté en un squelette
// typé à compléter (artifacts/consultations/<id>-harvest.json).
//
// Le script ne va pas chercher le fil : la passerelle est manuelle, le fil est collé dans un
// fichier. Il ne type pas non plus les réponses — décider qu'une intervention est une hypothèse
// plutôt qu'une objection est un jugement, comme l'est le choix d'un état observable dans
// scripts/propose-work.js. Il produit donc des marqueurs TODO, jamais une incorporation directe.
//
// Format du fil : un bloc par intervention, introduit par une ligne `## u/pseudo`.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildHarvestScaffold, parseThread } from "../src/consultation.js";

const projectDir = new URL("../", import.meta.url);
const consultationsPath = new URL("data/consultations.json", projectDir);
const artifactsDir = new URL("artifacts/consultations/", projectDir);

const flag = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const consultationId = flag("consultation");
const threadPath = flag("thread");
const url = flag("url");
const today = flag("date") || new Date().toISOString().slice(0, 10);

if (!consultationId || !threadPath) {
  console.error("Usage: npm run consult:ingest -- --consultation=<id> --thread=<chemin> [--url=<url>]");
  process.exit(1);
}

const store = JSON.parse(await readFile(consultationsPath, "utf8"));
const consultation = store.nodes.find(node => node.id === consultationId && node.nodeType === "consultation");
if (!consultation) {
  const known = store.nodes.filter(node => node.nodeType === "consultation").map(node => node.id);
  console.error(`Consultation inconnue : ${consultationId}${known.length ? `\nConnues : ${known.join(", ")}` : "\nAucune consultation enregistrée : exécuter d'abord npm run consult:draft -- --apply."}`);
  process.exit(1);
}

// On n'ingère que ce qu'on a publié : sans URL, la provenance des réponses serait invérifiable.
const publishedUrl = url || consultation.sourceUrl;
if (!publishedUrl) {
  console.error(`La consultation ${consultationId} n'a pas d'URL. Passer --url=<lien du fil publié> : une réponse sans fil identifiable n'est pas traçable.`);
  process.exit(1);
}

const thread = parseThread(await readFile(new URL(threadPath, projectDir), "utf8"));
if (!thread.comments.length) {
  console.error(`Aucune intervention trouvée dans ${threadPath}. Attendu : un bloc par intervention, introduit par une ligne « ## u/pseudo ».`);
  process.exit(1);
}

if (consultation.consultationStatus === "draft") {
  consultation.consultationStatus = "published";
  consultation.publishedAt = today;
}
consultation.sourceUrl = publishedUrl;
await writeFile(consultationsPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

const scaffold = buildHarvestScaffold(
  { ...consultation, clusterId: consultation.clusterId || "consultations" },
  { ...thread, authorUrlPattern: consultation.consultationChannel === "reddit" ? "https://www.reddit.com/user/{author}/" : "" },
  { today }
);
await mkdir(artifactsDir, { recursive: true });
const scaffoldPath = new URL(`${consultationId}-harvest.json`, artifactsDir);
await writeFile(scaffoldPath, `${JSON.stringify(scaffold, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  consultation: consultationId,
  status: consultation.consultationStatus,
  url: publishedUrl,
  comments: thread.comments.length,
  authors: [...new Set(thread.comments.map(comment => comment.author))],
  scaffold: `artifacts/consultations/${consultationId}-harvest.json`,
  todo: scaffold.todo,
  rule: scaffold.rule
}, null, 2));
