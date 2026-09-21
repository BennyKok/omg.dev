// A live aggregation test: stand up a real MCP server on loopback that a
// header gates, then prove omg's hub connects with the connector's headers,
// lists the tool, and calls it — and that a wrong/absent header is refused.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Connector } from "./store.ts";
import { callConnectorTool, isUnauthorizedError, listConnectorTools, probeConnector, resetAllConnectorsForTests } from "./hub.ts";

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

// What a catalog "openapi" entry serves at its connectUrl: a spec, not MCP.
const OPENAPI_DOC = {
  openapi: "3.1.0",
  info: { title: "Gmail API", version: "v1" },
  servers: [{ url: "https://www.googleapis.com/" }],
  paths: {},
  components: {},
  security: [],
  "x-executor-origin": "https://integrations.sh",
};

async function answer(req: Request): Promise<Response> {
  if (new URL(req.url).pathname === "/spec.json") return Response.json(OPENAPI_DOC);
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
  test("an endpoint that serves an OpenAPI document probes as one readable line, not a Zod dump", async () => {
    const c = { ...connector({}), endpoint: endpoint.replace(/\/mcp$/, "/spec.json") };
    const probe = await probeConnector(c);
    expect(probe.ok).toBe(false);
    expect(probe.needsAuth).toBe(false);
    expect(probe.error).toMatch(/not an MCP server/);
    expect(probe.error).not.toContain("invalid_union");
    expect((probe.error ?? "").length).toBeLessThan(200);
  });

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

  test("a probe of a protected server reports that a sign-in is needed", async () => {
    // No credential at all: the endpoint answers 401, which is the signal the
    // host uses to offer a sign-in for a connector the catalog called open.
    const p = await probeConnector(connector({}));
    expect(p.ok).toBe(false);
    expect(p.needsAuth).toBe(true);
  });

  test("an unreachable server is not reported as a sign-in problem", async () => {
    const c = { ...connector({ [KEY]: SECRET }), endpoint: "http://127.0.0.1:1/mcp" };
    const p = await probeConnector(c);
    expect(p.ok).toBe(false);
    expect(p.needsAuth).toBe(false);
  });

  test("isUnauthorizedError reads the transport status code", () => {
    expect(isUnauthorizedError(Object.assign(new Error("Streamable HTTP error"), { code: 401 }))).toBe(true);
    expect(isUnauthorizedError(new Error("Unauthorized"))).toBe(true);
    expect(isUnauthorizedError(new Error("Error POSTing to endpoint (HTTP 403)"))).toBe(true);
    expect(isUnauthorizedError(new Error("fetch failed"))).toBe(false);
    expect(isUnauthorizedError(new Error("Streamable HTTP error: 500"))).toBe(false);
  });
});
