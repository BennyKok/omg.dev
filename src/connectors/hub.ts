// The MCP aggregator: omg connects, as an MCP client, to each member's remote
// connector servers and re-exposes their tools. This is what replaces the
// Executor daemon for the MCP case — omg is already an MCP host, so it can be
// an MCP client too, with no extra process.
//
// Credentials live only here: the connection's headers are attached to the
// client transport host-side, so the agent that calls a tool never sees them.
// One client is cached per connection and reused; a broken client is dropped
// and rebuilt on the next call.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Connector } from "./store.ts";

export interface ConnectorTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

interface Entry {
  client: Client;
  endpoint: string;
  headersKey: string;
}

const clients = new Map<string, Entry>();

const VERSION = "0.1.0";

function headersKey(headers: Record<string, string>): string {
  return Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("\n");
}

async function connect(connector: Connector): Promise<Client> {
  const key = headersKey(connector.headers);
  const cached = clients.get(connector.id);
  if (cached && cached.endpoint === connector.endpoint && cached.headersKey === key) {
    return cached.client;
  }
  if (cached) await dropClient(connector.id);

  const client = new Client({ name: "omg-connectors", version: VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(connector.endpoint), {
    requestInit: { headers: connector.headers },
  });
  await client.connect(transport);
  clients.set(connector.id, { client, endpoint: connector.endpoint, headersKey: key });
  return client;
}

async function dropClient(id: string): Promise<void> {
  const entry = clients.get(id);
  clients.delete(id);
  if (entry) await entry.client.close().catch(() => {});
}

/** List the tools a connector exposes. Throws with a readable message on failure. */
export async function listConnectorTools(connector: Connector): Promise<ConnectorTool[]> {
  const client = await connect(connector);
  try {
    const result = await client.listTools();
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
    }));
  } catch (e) {
    await dropClient(connector.id);
    throw e;
  }
}

export type CallResult = {
  content: unknown;
  isError: boolean;
};

/** Call one tool on a connector, with the credential injected host-side. */
export async function callConnectorTool(
  connector: Connector,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallResult> {
  const client = await connect(connector);
  try {
    const result = (await client.callTool({ name: toolName, arguments: args })) as {
      content?: unknown;
      isError?: boolean;
    };
    return { content: result.content ?? [], isError: result.isError === true };
  } catch (e) {
    await dropClient(connector.id);
    throw e;
  }
}

/** A quick health probe: can omg reach and initialize this endpoint? */
export async function probeConnector(connector: Connector): Promise<{ ok: boolean; tools?: number; error?: string }> {
  try {
    const tools = await listConnectorTools(connector);
    return { ok: true, tools: tools.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Drop every cached client (a connector was edited or removed). */
export async function resetConnector(id: string): Promise<void> {
  await dropClient(id);
}

export async function resetAllConnectorsForTests(): Promise<void> {
  for (const id of [...clients.keys()]) await dropClient(id);
}
