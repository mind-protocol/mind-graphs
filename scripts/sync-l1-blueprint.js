import { getClient } from "../src/db.js";
import { formatL1BlueprintSync, syncDeclaredL1Blueprints } from "../src/l1-blueprint-sync.js";

const valueOf = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes("--apply");
const graphId = valueOf("graph") || null;

try {
  const result = await syncDeclaredL1Blueprints({ graphId, apply });
  console.log(formatL1BlueprintSync(result));
  if (!apply) console.log("Aucune écriture effectuée. Relance avec --apply pour accepter la migration structurelle.");
} finally {
  await (await getClient()).close().catch(() => {});
}
