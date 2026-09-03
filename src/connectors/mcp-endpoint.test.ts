// End-to-end over the agent-facing endpoint: a real MCP server on loopback,
// two members with different connectors, and a call routed through omg's
// connector surface with the credential injected. Proves scoping and proxying
// without any Executor daemon.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { PATHS } from "../config.ts";
import { ORG_OWNER, createConnector } from "./store.ts";
import { resetAllConnectorsForTests } from "./hub.ts";
import { serveConnectorsMcpRequest, splitConnectorTool } from "./mcp-endpoint.ts";

async function answer(req: Request, label: string): Promise<Response> {
  const server = new McpServer({ name: label, version: "0.0.1" });
  server.registerTool(
    "echo",
    { title: "Echo", description: "echoes", inputSchema: { message: z.string() } },
    async ({ message }) => ({ content: [{ type: "text", text: `${label}:${message}` }] }),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  if (res.headers.get("content-type")?.includes("text/event-stream")) return res;
  const body = await res.arrayBuffer();
  void transport.close().catch(() => {});
  void server.close().catch(() => {});
  return new Response(body, { status: res.status, headers: res.headers });
}

let tmp: string;
const originalData = PATHS.data;
let s1: ReturnType<typeof Bun.serve>, s2: ReturnType<typeof Bun.serve>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-cmcp-"));
  PATHS.data = tmp;
  s1 = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => answer(r, "bennySrv") });
  s2 = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => answer(r, "sharedSrv") });
});

afterEach(async () => {
  await resetAllConnectorsForTests();
  s1.stop(true);
  s2.stop(true);
  PATHS.data = originalData;
  rmSync(tmp, { recursive: true, force: true });
});

function rpc(owner: string, body: unknown) {
  return serveConnectorsMcpRequest(
    new Request("http://box/mcp/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    owner,
  );
}

describe("connectors MCP endpoint", () => {
  test("tools/list is scoped to the member (own + org), namespaced", async () => {
    createConnector({ owner: "benny", name: "Benny", endpoint: `http://127.0.0.1:${s1.port}/mcp` });
    createConnector({ owner: ORG_OWNER, name: "Shared", endpoint: `http://127.0.0.1:${s2.port}/mcp` });
    createConnector({ owner: "angel", name: "Angel", endpoint: `http://127.0.0.1:${s1.port}/mcp` });

    const res = await rpc("benny", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map((t) => t.name).sort();
    // Benny sees his own + shared, never angel's.
    expect(names).toEqual(["benny__echo", "shared__echo"]);
  });

  test("tools/call routes to the right connector and proxies the result", async () => {
    createConnector({ owner: "benny", name: "Benny", endpoint: `http://127.0.0.1:${s1.port}/mcp` });
    const res = await rpc("benny", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "benny__echo", arguments: { message: "hi" } },
    });
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0]!.text).toBe("bennySrv:hi");
  });

  test("an unknown connector tool errors, does not throw", async () => {
    const res = await rpc("benny", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "ghost__x", arguments: {} },
    });
    const body = (await res.json()) as { result: { isError: boolean } };
    expect(body.result.isError).toBe(true);
  });

  test("splitConnectorTool", () => {
    expect(splitConnectorTool("github__list_issues")).toEqual({ slug: "github", tool: "list_issues" });
    expect(splitConnectorTool("noseparator")).toBeNull();
  });

  test("a requireApproval connector is held, not called", async () => {
    createConnector({ owner: "benny", name: "Benny", endpoint: `http://127.0.0.1:${s1.port}/mcp`, requireApproval: true });
    let called = false;
    const res = await serveConnectorsMcpRequest(
      new Request("http://box/mcp/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "benny__echo", arguments: { message: "x" } } }),
      }),
      "benny",
      async () => {
        called = true;
        return { held: true, text: "waiting for the owner" };
      },
    );
    const body = (await res.json()) as { result: { content: { text: string }[] } };
    expect(called).toBe(true);
    expect(body.result.content[0]!.text).toContain("waiting for the owner");
  });
});
