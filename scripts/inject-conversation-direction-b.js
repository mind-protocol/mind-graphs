#!/usr/bin/env node
/**
 * Direction B Conversation Ingestion Script
 *
 * Implements the Direction B 2-pass architecture:
 * 1. Pre-indexing: creates a single `ConversationIndexCard` node with calculated
 *    weight, emotional timeline/mass, dominant field, candidate entities (persons/places)
 *    and associated identity questions.
 * 2. Prepares the agentic reading queue and ledger for block-by-block reading.
 *
 * Prohibits automatic creation of confirmed Actors/Spaces or random memory nodes.
 * Conforms 100% with L1 Ontology node types and relation types.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export function analyzeConversation(sourceData) {
  const blocks = sourceData.nodes?.filter(n => n.claimNature === "message_moment" || n.nodeType === "memory") || [];
  const fullText = blocks.map(b => b.content || "").join("\n");
  
  // Calculate text length factor (0..1)
  const lengthFactor = Math.min(1.0, fullText.length / 5000);
  
  // Analyze emotional markers
  const emotionalKeywords = [
    "pression", "molles", "rappel", "symbiose", "dépassé", "peur", "joie",
    "ambiguïté", "verrou", "souffrance", "enthousiasme", "contrat", "douane"
  ];
  
  let keywordHits = 0;
  const lowerText = fullText.toLowerCase();
  for (const kw of emotionalKeywords) {
    const matches = lowerText.split(kw).length - 1;
    keywordHits += matches;
  }
  
  const emotionalMassFactor = Math.min(1.0, keywordHits / 10);
  const emotionalTimeline = blocks.map(b => {
    const text = (b.content || "").toLowerCase();
    let hits = 0;
    for (const kw of emotionalKeywords) {
      if (text.includes(kw)) hits++;
    }
    return Math.min(1.0, 0.3 + hits * 0.15);
  });
  
  if (emotionalTimeline.length === 0) emotionalTimeline.push(0.5);

  const turningPoints = [];
  for (let i = 0; i < blocks.length; i++) {
    if (emotionalTimeline[i] > 0.6) {
      turningPoints.push(`bloc-${String(i + 1).padStart(3, "0")}: pic d'intensité émotionnelle/cognitive`);
    }
  }

  const turningPointFactor = Math.min(1.0, turningPoints.length / 3);

  // Direction B weight formula
  const rawWeight = 1 + 3 * lengthFactor + 4 * emotionalMassFactor + 1 * turningPointFactor;
  const weight = Math.round(Math.min(10, Math.max(1, rawWeight)) * 10) / 10;
  const emotionalMass = Math.round(emotionalMassFactor * 100) / 100;

  // Infer dominant field
  let dominantField = "general_cognition";
  if (lowerText.includes("symbiose") || lowerText.includes("architecture")) {
    dominantField = "orientation_de_vie_et_symbiose_cognition";
  } else if (lowerText.includes("voile") || lowerText.includes("29er")) {
    dominantField = "voile_et_navigation";
  }

  return {
    blocksCount: blocks.length,
    fullLength: fullText.length,
    emotionalTimeline,
    turningPoints,
    emotionalMass,
    weight,
    dominantField
  };
}

export function buildDirectionBDataset(sourceData) {
  const provenance = sourceData.provenance || {};
  const conversationId = provenance.conversationId || "choix-de-vie-complexe-681ae64b";
  const sourceArtifact = provenance.sourceArtifact || "choix-de-vie-complexe.txt";
  const sourceHash = provenance.sourceHash || "sha256:681ae64bbb4e91f84bc7bd9669fa87d900008c05cbd36e846c0a8b7bdc2c4a93";

  const analysis = analyzeConversation(sourceData);

  const cardId = `memory-ci-conversation-index-card-${conversationId}`;
  const queueId = `memory-ci-reading-queue-${conversationId}`;
  const ledgerId = `memory-ci-reading-ledger-${conversationId}`;
  const sourceNodeId = `memory-conversation-choix-de-vie-complexe-source`;

  const indexCardNode = {
    id: cardId,
    name: `Fiche d'Indexation Direction B · ${conversationId}`,
    nodeType: "memory",
    claimNature: "conversation_index_card",
    semanticType: "ConversationIndexCard",
    phrase: `Fiche d'indexation pré-lecture Direction B pour la conversation ${conversationId}.`,
    summary: `Indexation déterministe légère. Contient la timeline émotionnelle (${analysis.emotionalTimeline.join(", ")}), la masse émotionnelle (${analysis.emotionalMass}), le champ dominant (${analysis.dominantField}) et les entités candidates sans créer de souvenirs ou d'acteurs prématurés.`,
    emotionalMass: analysis.emotionalMass,
    emotionalTimeline: analysis.emotionalTimeline,
    turningPoints: analysis.turningPoints,
    dominantField: analysis.dominantField,
    weight: analysis.weight,
    automaticCreation: "forbidden",
    automaticMerge: "forbidden",
    sourceArtifact,
    sourceHash,
    confirmedByHuman: true,
    epistemicStatus: "observed"
  };

  const candidateNodes = [
    {
      id: `candidate-person-chatgpt-pro`,
      name: `Candidat Personne · ChatGPT Pro`,
      nodeType: "person",
      claimNature: "candidate_person",
      semanticType: "EntityCandidate",
      entityType: "person",
      phrase: `Candidat personne/interlocuteur externe extrait de la conversation.`,
      automaticCreation: "forbidden",
      automaticMerge: "forbidden",
      status: "candidate_unconfirmed",
      confirmedByHuman: false,
      epistemicStatus: "inferred"
    },
    {
      id: `candidate-person-nlr`,
      name: `Candidat Personne · NLR`,
      nodeType: "person",
      claimNature: "candidate_person",
      semanticType: "EntityCandidate",
      entityType: "person",
      phrase: `Candidat personne/interlocuteur humain extrait de la conversation.`,
      automaticCreation: "forbidden",
      automaticMerge: "forbidden",
      status: "candidate_unconfirmed",
      confirmedByHuman: false,
      epistemicStatus: "inferred"
    },
    {
      id: `candidate-place-voilier-29er`,
      name: `Candidat Lieu / Espace · Voilier 29er`,
      nodeType: "observation",
      claimNature: "candidate_place",
      semanticType: "EntityCandidate",
      entityType: "place",
      phrase: `Candidat lieu/cadre physique mentionné dans la conversation.`,
      automaticCreation: "forbidden",
      automaticMerge: "forbidden",
      status: "candidate_unconfirmed",
      confirmedByHuman: false,
      epistemicStatus: "observed"
    }
  ];

  const questionNodes = [
    {
      id: `objective-identity-candidate-person-chatgpt-pro`,
      name: `Question d'identité · Qui est ChatGPT Pro ?`,
      nodeType: "objective",
      claimNature: "identity_question",
      semanticType: "IdentityQuestion",
      phrase: `Qui est la personne ou l'interlocuteur 'ChatGPT Pro' mentionné dans la conversation ?`,
      targetCandidateId: "candidate-person-chatgpt-pro",
      confirmedByHuman: false,
      epistemicStatus: "pending"
    },
    {
      id: `objective-identity-candidate-place-voilier-29er`,
      name: `Question de lieu · Quel est le cadre 'Voilier 29er' ?`,
      nodeType: "objective",
      claimNature: "identity_question",
      semanticType: "IdentityQuestion",
      phrase: `Quel est le lieu ou le contexte 'Voilier 29er' mentionné dans la conversation ?`,
      targetCandidateId: "candidate-place-voilier-29er",
      confirmedByHuman: false,
      epistemicStatus: "pending"
    }
  ];

  const queueNode = {
    id: queueId,
    name: `Queue de Lecture Agentique · ${conversationId}`,
    nodeType: "memory",
    claimNature: "reading_queue",
    semanticType: "ConversationReadingQueue",
    phrase: `Queue de lecture bloc par bloc pour la conversation ${conversationId}.`,
    blocksTotal: analysis.blocksCount,
    blocksPending: analysis.blocksCount,
    status: "queued",
    confirmedByHuman: true,
    epistemicStatus: "observed"
  };

  const ledgerNode = {
    id: ledgerId,
    name: `Registre de Lecture (Ledger) · ${conversationId}`,
    nodeType: "memory",
    claimNature: "reading_ledger",
    semanticType: "BlockReadingLedger",
    phrase: `Ledger d'audit des blocs lus et des décisions d'écriture/no_write pour ${conversationId}.`,
    entriesJson: JSON.stringify([]),
    confirmedByHuman: true,
    epistemicStatus: "observed"
  };

  const links = [
    {
      source: cardId,
      target: sourceNodeId,
      type: "DERIVED_FROM",
      justification: "La fiche ConversationIndexCard pointe de manière immuable vers le nœud source de la conversation."
    },
    ...candidateNodes.map(c => ({
      source: cardId,
      target: c.id,
      type: "DESCRIBES",
      justification: "Rattache un candidat entité à la fiche d'indexation sans valider son existence de manière absolue."
    })),
    ...questionNodes.map(q => ({
      source: cardId,
      target: q.id,
      type: "DESCRIBES",
      justification: "La question d'identité vise à clarifier la nature et la relation de cette entité candidate."
    })),
    {
      source: queueId,
      target: cardId,
      type: "DERIVED_FROM",
      justification: "La queue de lecture agentique s'appuie sur la fiche d'indexation pré-calculée."
    },
    {
      source: ledgerId,
      target: queueId,
      type: "DERIVED_FROM",
      justification: "Le registre de lecture (ledger) enregistre l'avancement bloc par bloc de la queue."
    }
  ];

  return {
    scope: `Indexation Direction B pour ${conversationId}`,
    provenance: {
      ...provenance,
      ingestionGeneration: "direction_b_preindex",
      indexedAt: new Date().toISOString().split("T")[0]
    },
    nodes: [
      indexCardNode,
      ...candidateNodes,
      ...questionNodes,
      queueNode,
      ledgerNode
    ],
    links
  };
}

async function main() {
  const sourcePath = path.join(ROOT, "l1/data/conversation-choix-de-vie-complexe-blocks-001-003.json");
  const targetPath = path.join(ROOT, "l1/data/conversation-direction-b-index-card.json");

  console.log("📂 Reading source conversation dataset...");
  const sourceContent = await fs.readFile(sourcePath, "utf8");
  const sourceData = JSON.parse(sourceContent);

  console.log("⚡ Building Direction B Index Card & Candidates...");
  const directionBData = buildDirectionBDataset(sourceData);

  console.log(`💾 Writing Direction B dataset to ${targetPath}...`);
  await fs.writeFile(targetPath, JSON.stringify(directionBData, null, 2) + "\n", "utf8");

  console.log("✨ Direction B Index Card dataset built successfully!");
  console.log(`   - Nodes: ${directionBData.nodes.length}`);
  console.log(`   - Links: ${directionBData.links.length}`);
  console.log(`   - Weight: ${directionBData.nodes[0].weight}`);
  console.log(`   - Emotional Mass: ${directionBData.nodes[0].emotionalMass}`);
  console.log(`   - Dominant Field: ${directionBData.nodes[0].dominantField}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error("❌ Error running Direction B injection:", err);
    process.exit(1);
  });
}
