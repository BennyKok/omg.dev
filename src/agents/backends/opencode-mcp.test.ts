// A managed omg/OpenCode session must see the omg.dev tools on its first turn.
//
// Production failure (CareClean, 2026-10-05): the session ran with only the
// built-in OpenCode tools, checked `command -v omg_build_android`, and stopped.
// Its omg tools came from a box-global stdio entry that OpenCode dropped
// without telling anyone when it did not connect in time. The same session
// worked as soon as it reached the shared `/mcp?session=<id>` endpoint.
//
// The end-to-end test below runs the real `opencode serve` with a global
// config whose stdio `omg` entry never answers, as on that Computer, and checks
// what OpenCode actually sends to the model.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../../config.ts";
import { serveOmgMcpRequest } from "../../mcp-http.ts";
import {
  SESSION_TOKEN_HEADER,
  resetSessionSecretForTests,
  sessionToken,
  verifySessionToken,
} from "../../policy/session-token.ts";
import {
  OMG_MCP_SERVER,
  awaitOpencodeMcp,
  opencodeCallerSessionId,
  opencodeSessionMcpConfig,
  type OpencodeMcpClient,
} from "./opencode-mcp.ts";

let dataDir: string;
const originalData = PATHS.data;
const originalBase = process.env.LFG_BASE;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "omg-opencode-mcp-"));
  PATHS.data = dataDir;
  resetSessionSecretForTests();
  process.env.LFG_BASE = "http://127.0.0.1:65530";
});

afterEach(() => {
  PATHS.data = originalData;
  resetSessionSecretForTests();
  if (originalBase === undefined) delete process.env.LFG_BASE;
  else process.env.LFG_BASE = originalBase;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("opencodeSessionMcpConfig", () => {
  test("registers the shared endpoint under this session's id and token", () => {
    const { mcp } = opencodeSessionMcpConfig("sess-abc");
    const omg = mcp[OMG_MCP_SERVER]!;
    expect(omg.type).toBe("remote");
    expect(omg.url).toBe("http://127.0.0.1:65530/mcp?session=sess-abc");
    expect(omg.enabled).toBe(true);
    expect(omg.oauth).toBe(false);
    expect(verifySessionToken("sess-abc", omg.headers[SESSION_TOKEN_HEADER])).toBe(true);
    // The token is this session's own: it does not let it speak as another.
    expect(verifySessionToken("someone-else", omg.headers[SESSION_TOKEN_HEADER])).toBe(false);
    expect(mcp.connectors?.url).toBe("http://127.0.0.1:65530/mcp/connectors?session=sess-abc");
  });

  test("never registers a local process", () => {
    for (const server of Object.values(opencodeSessionMcpConfig("s").mcp)) {
      expect(server.type).toBe("remote");
      expect("command" in server).toBe(false);
    }
  });
});

describe("opencodeCallerSessionId", () => {
  test("prefers the id the spawner exported, then the harness key", () => {
    expect(opencodeCallerSessionId("key-1", { OMG_SESSION_ID: "omg-id", LFG_SESSION_ID: "lfg-id" })).toBe("omg-id");
    expect(opencodeCallerSessionId("key-1", { LFG_SESSION_ID: "lfg-id" })).toBe("lfg-id");
    expect(opencodeCallerSessionId("key-1", { LFG_SESSION_ID: "  " })).toBe("key-1");
  });
});

function fakeClient(statuses: Array<Record<string, { status: string; error?: string }>>) {
  const connects: string[] = [];
  let i = 0;
  const client: OpencodeMcpClient = {
    mcp: {
      status: async () => ({ data: statuses[Math.min(i++, statuses.length - 1)] }),
      connect: async ({ path }) => {
        connects.push(path.name);
        return {};
      },
    },
  };
  return { client, connects };
}

describe("awaitOpencodeMcp", () => {
  const fast = { timeoutMs: 1_000, intervalMs: 1, sleep: async () => {} };

  test("waits for a server that is still connecting", async () => {
    const { client, connects } = fakeClient([{}, { omg: { status: "pending" } }, { omg: { status: "connected" } }]);
    expect(await awaitOpencodeMcp(client, "/w", ["omg"], fast)).toEqual({ connected: ["omg"], missing: [] });
    expect(connects).toEqual([]);
  });

  test("asks OpenCode to reconnect a server it gave up on", async () => {
    const { client, connects } = fakeClient([
      { omg: { status: "failed", error: "Operation timed out after 30000ms" } },
      { omg: { status: "connected" } },
    ]);
    expect((await awaitOpencodeMcp(client, "/w", ["omg"], fast)).missing).toEqual([]);
    expect(connects).toEqual(["omg"]);
  });

  test("reports a server that never connects instead of hiding it", async () => {
    const { client } = fakeClient([{ omg: { status: "failed", error: "connection refused" } }]);
    const result = await awaitOpencodeMcp(client, "/w", ["omg"], { timeoutMs: 0, sleep: async () => {} });
    expect(result).toEqual({
      connected: [],
      missing: [{ name: "omg", status: "failed", error: "connection refused" }],
    });
  });
});

function opencodeBinary(): string | null {
  const local = join(import.meta.dir, "../../../node_modules/.bin/opencode");
  if (existsSync(local)) return local;
  return Bun.which("opencode");
}

const OPENCODE = opencodeBinary();

describe.skipIf(!OPENCODE)("managed OpenCode session, end to end", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "PATH", "OPENCODE_PERMISSION"];
  let root: string;
  let workspace: string;
  let model: ReturnType<typeof Bun.serve>;
  let toolsSentToModel: string[][];

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "omg-opencode-e2e-"));
    workspace = join(root, "ws");
    mkdirSync(workspace, { recursive: true });
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    for (const dir of ["config", "data", "state", "cache"]) mkdirSync(join(root, dir), { recursive: true });
    process.env.XDG_CONFIG_HOME = join(root, "config");
    process.env.XDG_DATA_HOME = join(root, "data");
    process.env.XDG_STATE_HOME = join(root, "state");
    process.env.XDG_CACHE_HOME = join(root, "cache");
    const binDir = OPENCODE!.slice(0, OPENCODE!.lastIndexOf("/"));
    process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;

    // A model that records the tool list OpenCode offers and answers "ok".
    toolsSentToModel = [];
    model = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const body = (await req.json().catch(() => ({}))) as { tools?: Array<{ function?: { name?: string } }> };
        toolsSentToModel.push((body.tools ?? []).map((t) => t.function?.name ?? ""));
        const chunk = (delta: object, finish: string | null) =>
          `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        return new Response(`${chunk({ role: "assistant", content: "ok" }, null)}${chunk({}, "stop")}data: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    // The box-global config as a hosted Computer had it: the provider, plus a
    // stdio `omg` entry that never answers (a cold start that misses
    // OpenCode's connect window).
    mkdirSync(join(root, "config", "opencode"), { recursive: true });
    writeFileSync(
      join(root, "config", "opencode", "opencode.json"),
      JSON.stringify({
        model: "fake/m",
        small_model: "fake/m",
        provider: {
          fake: {
            npm: "@ai-sdk/openai-compatible",
            name: "fake",
            options: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "test" },
            models: { m: { name: "m" } },
          },
        },
        mcp: { omg: { type: "local", command: ["sh", "-c", "sleep 600"], enabled: true } },
      }),
    );
  });

  afterAll(() => {
    model?.stop(true);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(root, { recursive: true, force: true });
  });

  test("the first turn offers the omg tools, and the endpoint sees this session", async () => {
    // The shared endpoint, as `omg serve` answers it, recording who called.
    const callers: Array<{ session: string | null; tokenValid: boolean }> = [];
    const endpoint = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
        const session = url.searchParams.get("session");
        const tokenValid = !!session && verifySessionToken(session, req.headers.get(SESSION_TOKEN_HEADER));
        callers.push({ session, tokenValid });
        return serveOmgMcpRequest(req, tokenValid ? session! : undefined);
      },
    });
    process.env.LFG_BASE = `http://127.0.0.1:${endpoint.port}`;
    const sessionId = "careclean-regression-session";
    const { createOpencodeServer, createOpencodeClient } = await import("@opencode-ai/sdk");
    const server = await createOpencodeServer({
      port: 0,
      timeout: 30_000,
      config: opencodeSessionMcpConfig(opencodeCallerSessionId("harness-key", { LFG_SESSION_ID: sessionId })),
    });
    try {
      const client = createOpencodeClient({ baseUrl: server.url });
      const gate = await awaitOpencodeMcp(client, workspace, [OMG_MCP_SERVER], { timeoutMs: 20_000 });
      expect(gate.missing).toEqual([]);

      const created = await client.session.create({ body: {}, query: { directory: workspace } });
      const prompt = await client.session.prompt({
        path: { id: created.data!.id },
        query: { directory: workspace },
        body: { model: { providerID: "fake", modelID: "m" }, parts: [{ type: "text", text: "build the APK" }] },
      });
      expect(prompt.error).toBeUndefined();

      // OpenCode names MCP tools `<server>_<tool>`.
      const firstTurn = toolsSentToModel.find((tools) => tools.length) ?? [];
      expect(firstTurn).toContain("omg_omg_build_android");
      expect(firstTurn).toContain("omg_omg_ship");
      // Identity: every call named this session and carried its valid token.
      expect(callers.length).toBeGreaterThan(0);
      expect(callers.every((c) => c.session === sessionId && c.tokenValid)).toBe(true);
      expect(sessionToken(sessionId)).toBeTruthy();
    } finally {
      server.close();
      endpoint.stop(true);
    }
  }, 90_000);
});
