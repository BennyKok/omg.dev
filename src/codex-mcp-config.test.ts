// Regression cover for a launch-killing override.
//
// The bug: the codex launcher hardcoded `mcp_servers.lfg.env.LFG_SESSION_ID` as
// a --config override. The MCP server was renamed to `omg`, so on any machine
// whose ~/.codex/config.toml had followed the rename the override named a
// server the config didn't define. Codex does not ignore that — a server table
// with neither `command` nor `url` is an invalid transport, and it refuses to
// load config.toml at all:
//
//     Error loading config.toml: invalid transport
//     in `mcp_servers.lfg`
//
// Every codex turn failed before the model ran. The fix discovers the name from
// the config being overridden; these tests pin that it never invents one.
import { describe, expect, test } from "bun:test";
import { codexOmgMcpConfig, omgStdioServerNames } from "./codex-mcp-config.ts";

const parse = (toml: string) => Bun.TOML.parse(toml) as Record<string, unknown>;

const RENAMED = parse(`
[mcp_servers.omg]
command = "/home/dev/.bun/bin/bun"
args = ["/home/dev/omg-serve-main/src/cli.ts", "mcp"]
`);

describe("omgStdioServerNames", () => {
  test("finds the server under its current name", () => {
    expect(omgStdioServerNames(RENAMED)).toEqual(["omg"]);
  });

  test("still finds the pre-rename name", () => {
    const config = parse(`
[mcp_servers.lfg]
command = "bun"
args = ["/home/dev/lfg-serve-main/src/cli.ts", "mcp"]
`);
    expect(omgStdioServerNames(config)).toEqual(["lfg"]);
  });

  test("ignores other people's MCP servers", () => {
    const config = parse(`
[mcp_servers.openaiDeveloperDocs]
url = "https://developers.openai.com/mcp"

[mcp_servers.github]
command = "gh-mcp"
args = ["serve"]

[mcp_servers.omg]
command = "bun"
args = ["/home/dev/omg-serve-main/src/cli.ts", "mcp"]
`);
    expect(omgStdioServerNames(config)).toEqual(["omg"]);
  });

  test("skips an HTTP entry — env can't reach it and would invalidate the transport", () => {
    const config = parse(`
[mcp_servers.omg]
url = "http://127.0.0.1:8766/mcp"
`);
    expect(omgStdioServerNames(config)).toEqual([]);
  });

  test("survives a missing or malformed config", () => {
    expect(omgStdioServerNames(null)).toEqual([]);
    expect(omgStdioServerNames({})).toEqual([]);
    expect(omgStdioServerNames({ mcp_servers: "nonsense" })).toEqual([]);
    expect(omgStdioServerNames({ mcp_servers: { omg: "nonsense" } })).toEqual([]);
  });
});

describe("codexOmgMcpConfig", () => {
  test("attaches the session id to the server the config actually defines", () => {
    expect(codexOmgMcpConfig("sess-1", RENAMED)).toEqual({
      config: { mcp_servers: { omg: { env: { OMG_SESSION_ID: "sess-1", LFG_SESSION_ID: "sess-1" } } } },
    });
  });

  test("emits NO override when the config defines no server of ours", () => {
    // The whole point: an env-only table for an undefined server is fatal, so
    // the override has to be absent rather than speculative.
    const config = parse(`
[mcp_servers.openaiDeveloperDocs]
url = "https://developers.openai.com/mcp"
`);
    expect(codexOmgMcpConfig("sess-1", config)).toEqual({});
    expect(codexOmgMcpConfig("sess-1", null)).toEqual({});
  });

  test("never names a server that has no transport in the config", () => {
    const config = parse(`
[mcp_servers.omg]
command = "bun"
args = ["cli.ts", "mcp"]
`);
    const servers = codexOmgMcpConfig("sess-1", config).config?.mcp_servers as Record<string, unknown>;
    const defined = new Set(Object.keys((config.mcp_servers ?? {}) as Record<string, unknown>));
    for (const name of Object.keys(servers)) expect(defined.has(name)).toBe(true);
  });

  test("no session id means no override", () => {
    expect(codexOmgMcpConfig("   ", RENAMED)).toEqual({});

    const saved = { omg: process.env.OMG_SESSION_ID, lfg: process.env.LFG_SESSION_ID };
    delete process.env.OMG_SESSION_ID;
    delete process.env.LFG_SESSION_ID;
    try {
      expect(codexOmgMcpConfig(undefined, RENAMED)).toEqual({});
    } finally {
      if (saved.omg === undefined) delete process.env.OMG_SESSION_ID;
      else process.env.OMG_SESSION_ID = saved.omg;
      if (saved.lfg === undefined) delete process.env.LFG_SESSION_ID;
      else process.env.LFG_SESSION_ID = saved.lfg;
    }
  });

  test("defaults to the ambient session when the caller passes none", () => {
    const saved = process.env.OMG_SESSION_ID;
    process.env.OMG_SESSION_ID = "ambient-session";
    try {
      expect(codexOmgMcpConfig(undefined, RENAMED)).toEqual({
        config: {
          mcp_servers: { omg: { env: { OMG_SESSION_ID: "ambient-session", LFG_SESSION_ID: "ambient-session" } } },
        },
      });
    } finally {
      if (saved === undefined) delete process.env.OMG_SESSION_ID;
      else process.env.OMG_SESSION_ID = saved;
    }
  });
});
