// Scheduled auto agents and connectors. A headless run has no session, so it
// reaches /mcp/connectors with its agent id and a signed token, and gets only
// the connector slugs on its row, as the member who saved it. These tests pin
// the rules that keep that safe:
//   - a run with no grant attaches no connectors server at all;
//   - the token is bound to the agent id and cannot pass as a session token;
//   - the grant is stamped with a member, and a list without one is dropped;
//   - both runners receive the same server (Claude options, Codex config).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";

const originalData = PATHS.data;
let testData = "";
let config: typeof import("../config.ts");
let tokens: typeof import("../policy/session-token.ts");
let store: typeof import("./store.ts");
let codex: typeof import("../codex-mcp-config.ts");

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-auto-conn-"));
  PATHS.data = testData;
  config = await import("../config.ts");
  tokens = await import("../policy/session-token.ts");
  store = await import("./store.ts");
  codex = await import("../codex-mcp-config.ts");
});

afterAll(async () => {
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("auto agent connectors", () => {
  test("no grant attaches no connectors server", () => {
    expect(config.autoAgentConnectorsMcpServer("daily", undefined)).toEqual({});
    expect(config.autoAgentConnectorsMcpServer("daily", [])).toEqual({});
  });

  test("a grant attaches /mcp/connectors?auto=<id> with a token bound to that agent", () => {
    const { mcpServers } = config.autoAgentConnectorsMcpServer("daily report", ["meta-ads"]);
    const server = mcpServers?.[config.CONNECTORS_MCP_SERVER_NAME];
    expect(server?.url).toEndWith("/mcp/connectors?auto=daily%20report");
    const token = server?.headers[tokens.SESSION_TOKEN_HEADER];
    expect(tokens.verifyAutoAgentToken("daily report", token)).toBe(true);
    expect(tokens.verifyAutoAgentToken("other-agent", token)).toBe(false);
    // Separate namespace: an auto agent token never works as a session token.
    expect(tokens.verifySessionToken("daily report", token)).toBe(false);
    expect(tokens.verifyAutoAgentToken("daily report", tokens.sessionToken("daily report"))).toBe(false);
  });

  test("a new list is stamped with the saving member; a list without one is dropped", () => {
    expect(store.connectorAccess(["meta-ads", " meta-ads ", ""], "benny@example.com", undefined)).toEqual({
      connectors: ["meta-ads"],
      connectorUser: "benny@example.com",
    });
    expect(store.connectorAccess(["meta-ads"], undefined, undefined)).toEqual({});
    expect(store.connectorAccess(["meta-ads"], "  ", undefined)).toEqual({});
  });

  test("a plain edit keeps the grant; an empty list removes it", () => {
    const existing = { connectors: ["meta-ads"], connectorUser: "benny@example.com" };
    expect(store.connectorAccess(undefined, undefined, existing)).toEqual(existing);
    expect(store.connectorAccess([], "benny@example.com", existing)).toEqual({});
  });

  test("Codex receives the server as a complete HTTP definition next to the omg servers", () => {
    const { mcpServers } = config.autoAgentConnectorsMcpServer("daily", ["meta-ads"]);
    const base = { config: { mcp_servers: { omg: { env: { OMG_SESSION_ID: "s1" } } }, service_tier: "fast" } };
    const merged = codex.withCodexHttpMcpServers(base, mcpServers);
    const servers = merged.config?.mcp_servers as Record<string, { url?: string; http_headers?: Record<string, string> }>;
    expect(servers.omg).toEqual({ env: { OMG_SESSION_ID: "s1" } } as never);
    expect(servers.connectors?.url).toEndWith("/mcp/connectors?auto=daily");
    expect(servers.connectors?.http_headers?.[tokens.SESSION_TOKEN_HEADER]).toBe(tokens.autoAgentToken("daily"));
    // Headless codex runs with approval policy "never": without this every
    // connector call is refused before it reaches the server.
    expect((servers.connectors as { default_tools_approval_mode?: string }).default_tools_approval_mode).toBe("approve");
    expect(merged.config?.service_tier).toBe("fast");
    expect(codex.withCodexHttpMcpServers(base, undefined)).toBe(base);
  });

  test("saving through the store persists the grant and a later plain edit keeps it", async () => {
    const saved = await store.saveAutoAgent({
      name: "Daily report",
      prompt: "report",
      schedule: "30 9 * * *",
      enabled: true,
      connectors: ["meta-ads"],
      connectorUser: "benny@example.com",
    });
    expect(saved.connectors).toEqual(["meta-ads"]);
    expect(saved.connectorUser).toBe("benny@example.com");
    const edited = await store.saveAutoAgent({ id: saved.id, name: "Daily report", prompt: "report v2", schedule: "30 9 * * *", enabled: true });
    expect(edited.connectors).toEqual(["meta-ads"]);
    expect(edited.connectorUser).toBe("benny@example.com");
  });
});
