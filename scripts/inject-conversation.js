#!/usr/bin/env node
/**
 * Inject conversations into L1 graph from various sources
 * 
 * Usage:
 *   node scripts/inject-conversation.js --source=reddit --data-dir=path/to/export
 *   node scripts/inject-conversation.js --source=json --file=path/to/conversations.json
 * 
 * Example:
 *   node scripts/inject-conversation.js \
 *     --source=reddit \
 *     --data-dir="C:\Users\reyno\OneDrive\Documents\export_lesterpaintstheworld_20260503"
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Parse CSV manually to avoid external dependencies
function parseCSV(content, delimiter = ",") {
  const lines = content.split("\n");
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));
  const records = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Simple CSV parsing (doesn't handle quoted delimiters, but works for most cases)
    const cells = line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ""));
    const record = {};
    headers.forEach((header, idx) => {
      record[header] = cells[idx] || "";
    });
    records.push(record);
  }
  
  return records;
}

async function readRedditExport(dataDir) {
  if (!dataDir) throw new Error("--data-dir required for reddit source");
  
  const blocks = [];
  const exportName = path.basename(dataDir).toLowerCase();
  
  // Helper to read file safely
  async function readCsv(filename) {
    try {
      const fullPath = path.join(dataDir, filename);
      const content = await fs.readFile(fullPath, "utf8");
      return parseCSV(content);
    } catch (err) {
      console.warn(`⚠ Could not read ${filename}: ${err.message}`);
      return [];
    }
  }
  
  console.log("📂 Reading Reddit export...");
  
  // Parse chat history (direct messages)
  const chatRecords = await readCsv("chat_history.csv");
  console.log(`  📨 chat_history.csv: ${chatRecords.length} records`);
  
  let position = 0;
  for (const record of chatRecords) {
    if (!record.body || !record.body.trim()) continue;
    
    // Determine speaker role
    const author = record.author || "";
    const speakerRole = author.toLowerCase().includes("lesterpaintstheworld") ? "user" : "assistant";
    
    // Parse timestamp (usually Unix timestamp in Reddit exports)
    let occurredAt = new Date().toISOString();
    if (record.timestamp) {
      const timestampNum = Number(record.timestamp);
      if (timestampNum > 1000000000) {
        // Unix timestamp
        occurredAt = new Date(timestampNum * 1000).toISOString();
      } else if (Number.isNaN(timestampNum)) {
        // Try ISO format
        try {
          occurredAt = new Date(record.timestamp).toISOString();
        } catch {
          // Keep default
        }
      }
    }
    
    const blockId = `reddit-chat-${position}`;
    blocks.push({
      conversationId: `reddit-${exportName}`,
      blockId,
      content: record.body.trim(),
      speakerRole,
      occurredAt,
      sourceArtifact: "chat_history.csv",
      sourceLocator: `row:${position}`,
      position
    });
    
    position += 1;
  }
  
  // Parse messages archive
  const msgRecords = await readCsv("messages_archive.csv");
  console.log(`  📧 messages_archive.csv: ${msgRecords.length} records`);
  
  for (const record of msgRecords) {
    if (!record.body || !record.body.trim()) continue;
    
    const author = record.author || "";
    const speakerRole = author.toLowerCase().includes("lesterpaintstheworld") ? "user" : "assistant";
    
    let occurredAt = new Date().toISOString();
    if (record.timestamp) {
      const timestampNum = Number(record.timestamp);
      if (timestampNum > 1000000000) {
        occurredAt = new Date(timestampNum * 1000).toISOString();
      } else {
        try {
          occurredAt = new Date(record.timestamp).toISOString();
        } catch {
          // Keep default
        }
      }
    }
    
    const blockId = `reddit-msg-${position}`;
    blocks.push({
      conversationId: `reddit-${exportName}-archive`,
      blockId,
      content: record.body.trim(),
      speakerRole,
      occurredAt,
      sourceArtifact: "messages_archive.csv",
      sourceLocator: `row:${position - chatRecords.length}`,
      position
    });
    
    position += 1;
  }
  
  // Optional: include comments as conversation
  const commentRecords = await readCsv("comments.csv");
  console.log(`  💬 comments.csv: ${commentRecords.length} records`);
  
  for (const record of commentRecords.slice(0, 50)) { // Limit to first 50
    if (!record.body || !record.body.trim()) continue;
    
    const blockId = `reddit-comment-${position}`;
    blocks.push({
      conversationId: `reddit-${exportName}-comments`,
      blockId,
      content: record.body.trim().slice(0, 1000), // Truncate long comments
      speakerRole: "user",
      occurredAt: record.timestamp ? new Date(Number(record.timestamp) * 1000).toISOString() : new Date().toISOString(),
      sourceArtifact: "comments.csv",
      sourceLocator: `row:${position - chatRecords.length - msgRecords.length}`,
      position
    });
    
    position += 1;
  }
  
  // Sort by date
  blocks.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  
  return blocks;
}

async function readJsonFile(filePath) {
  if (!filePath) throw new Error("--file required for json source");
  
  const content = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(content);
  
  if (!Array.isArray(data)) throw new Error("JSON must be an array of blocks");
  
  return data.map((block, index) => ({
    conversationId: block.conversationId || "import-json",
    blockId: block.blockId || `block-${index}`,
    content: String(block.content || "").trim(),
    speakerRole: block.speakerRole || "user",
    occurredAt: block.occurredAt || new Date().toISOString(),
    sourceArtifact: path.basename(filePath),
    sourceLocator: `index:${index}`,
    position: index
  }));
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const valueOf = (name, fallback) => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg ? arg.slice(name.length + 3) : fallback;
  };
  
  const sourceType = valueOf("source", "redis").toLowerCase();
  const dataDir = valueOf("data-dir", valueOf("dir", null));
  const jsonFile = valueOf("file", null);
  const graphId = valueOf("graph", "l1-nlr-ai");
  const citizenId = valueOf("citizen", "self-nlr-ai");
  const dryRun = args.includes("--dry-run");
  const limit = Number(valueOf("limit", "0")) || Infinity;
  
  console.log("\n🚀 Conversation Injection to L1");
  console.log("================================\n");
  
  if (!sourceType || sourceType === "redis") {
    console.error("❌ Usage: node scripts/inject-conversation.js --source=<type> [--data-dir=path|--file=path]");
    console.error("\nSources: reddit, json");
    console.error("\nExample:");
    console.error(`  node scripts/inject-conversation.js \\
    --source=reddit \\
    --data-dir="C:\\Users\\reyno\\OneDrive\\Documents\\export_lesterpaintstheworld_20260503" \\
    --limit=100
`);
    process.exit(1);
  }
  
  let blocks = [];
  
  try {
    if (sourceType === "reddit") {
      blocks = await readRedditExport(dataDir);
    } else if (sourceType === "json") {
      blocks = await readJsonFile(jsonFile);
    } else {
      throw new Error(`Unknown source: ${sourceType}`);
    }
    
    if (blocks.length === 0) {
      console.error("❌ No blocks found");
      process.exit(1);
    }
    
    console.log(`\n📊 Loaded ${blocks.length} total blocks`);
    console.log(`📌 First block: ${blocks[0].conversationId}/${blocks[0].blockId}`);
    console.log(`📌 Last block: ${blocks[blocks.length - 1].conversationId}/${blocks[blocks.length - 1].blockId}`);
    console.log(`\n⚙️  Configuration:`);
    console.log(`    Graph: ${graphId}`);
    console.log(`    Citizen: ${citizenId}`);
    console.log(`    Mode: ${dryRun ? "dry-run" : "live"}`);
    
    const toInject = blocks.slice(0, limit);
    
    if (dryRun) {
      console.log(`\n✅ Dry run OK - would inject ${toInject.length} blocks\n`);
      
      // Show sample
      console.log("Sample blocks:");
      for (const block of toInject.slice(0, 3)) {
        console.log(`  [${block.conversationId}] ${block.blockId}`);
        console.log(`    Role: ${block.speakerRole}`);
        console.log(`    Content: ${block.content.slice(0, 60)}${block.content.length > 60 ? "..." : ""}`);
        console.log(`    Date: ${block.occurredAt}\n`);
      }
    } else {
      // Import the stimulus function
      const { stimulateConversationBlock } = await import("../src/l1-conversation-stimulus.js");
      
      console.log(`\n💫 Starting injection of ${toInject.length} blocks...\n`);
      
      let success = 0;
      let failed = 0;
      
      for (let i = 0; i < toInject.length; i++) {
        const block = toInject[i];
        
        try {
          await stimulateConversationBlock({
            graphId,
            conversationId: block.conversationId,
            blockId: block.blockId,
            content: block.content,
            sourceArtifact: block.sourceArtifact,
            sourceLocator: block.sourceLocator,
            consentId: "reddit-import-20260724",
            speakerRole: block.speakerRole,
            occurredAt: block.occurredAt,
            timestampBasis: "source_timestamp",
            citizenId
          });
          
          success += 1;
          const progress = Math.round((i + 1) / toInject.length * 100);
          console.log(`[${progress}%] ✓ ${block.conversationId}/${block.blockId}`);
        } catch (err) {
          failed += 1;
          console.log(`[❌] ${block.blockId}: ${err.message}`);
        }
      }
      
      console.log(`\n✅ Complete: ${success} injected, ${failed} failed\n`);
    }
    
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

main();
