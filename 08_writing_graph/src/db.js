import { FalkorDB } from "falkordb";

const host = process.env.FALKORDB_HOST || "127.0.0.1";
const port = Number(process.env.FALKORDB_PORT || 6379);
const graphName = process.env.FALKORDB_GRAPH || "mind_causal_graph";
const connectTimeout = Number(process.env.FALKORDB_CONNECT_TIMEOUT_MS || 1500);

let clientPromise;

export async function getClient() {
  if (!clientPromise) {
    clientPromise = FalkorDB.connect({
      socket: {
        host,
        port,
        connectTimeout,
        reconnectStrategy: retries => retries < 2 ? Math.min(100 * (retries + 1), 500) : false
      }
    }).catch(error => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

export async function getGraph() {
  const client = await getClient();
  return client.selectGraph(graphName);
}

export async function getGraphByName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Invalid FalkorDB graph name: ${name}`);
  const client = await getClient();
  return client.selectGraph(name);
}

export async function getL1Graph() {
  return getGraphByName(process.env.FALKORDB_L1_GRAPH || "l1_nlr_graph");
}

export { graphName, host, port };
