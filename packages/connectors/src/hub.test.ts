// A live aggregation test: stand up a real MCP server on loopback that a
// header gates, then prove omg's hub connects with the connector's headers,
// lists the tool, and calls it — and that a wrong/absent header is refused.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Connector } from "./store.ts";
import { callConnectorTool, listConnectorTools, probeConnector, resetAllConnectorsForTests } from "./hub.ts";

const KEY = "x-conn-key";
const SECRET = "s3cret";

function buildServer(): McpServer {
  const server = new McpServer({ name: "test-connector", version: "0.0.1" });
  server.registerTool(
    "echo",
    { title: "Echo", description: "Return the message", inputSchema: { message: z.string() } },
    async ({ message }) => ({ content: [{ type: "text", text: `echo:${message}` }] }),
  );
  return server;
}

async function answer(req: Request): Promise<Response> {
  // Gate on the header, proving omg injects the connector credential.
  if (req.headers.get(KEY) !== SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  if (res.headers.get("content-type")?.includes("text/event-stream")) return res;
  const body = await res.arrayBuffer();
  void transport.close().catch(() => {});
  void server.close().catch(() => {});
  return new Response(body, { status: res.status, headers: res.headers });
}

let httpServer: ReturnType<typeof Bun.serve> | null = null;
let endpoint = "";

beforeEach(() => {
  httpServer = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => answer(req) });
  endpoint = `http://127.0.0.1:${httpServer.port}/mcp`;
});

afterEach(async () => {
  await resetAllConnectorsForTests();
  httpServer?.stop(true);
  httpServer = null;
});

function connector(headers: Record<string, string>): Connector {
  return {
    id: "c1",
    owner: "benny",
    name: "Test",
    slug: "test",
    kind: "mcp",
    endpoint,
    headers,
    requireApproval: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("connector hub", () => {
  test("lists and calls a remote MCP tool with the injected header", async () => {
    const c = connector({ [KEY]: SECRET });
    const tools = await listConnectorTools(c);
    expect(tools.map((t) => t.name)).toContain("echo");

    const result = await callConnectorTool(c, "echo", { message: "hi" });
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.content)).toContain("echo:hi");
  });

  test("probe reports tool count", async () => {
    const p = await probeConnector(connector({ [KEY]: SECRET }));
    expect(p.ok).toBe(true);
    expect(p.tools).toBeGreaterThanOrEqual(1);
  });

  test("a wrong credential is refused, not silently allowed", async () => {
    const p = await probeConnector(connector({ [KEY]: "wrong" }));
    expect(p.ok).toBe(false);
  });
});
