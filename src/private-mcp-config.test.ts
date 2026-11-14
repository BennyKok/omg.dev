import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { PATHS, omgMcpServers } from "./config.ts";
import { claudeMcpConfigFile, cleanupSessionMcpConfigs, reapOrphanMcpConfigs } from "./private-mcp-config.ts";
import { codexMcpEnvironment, codexSessionMcpConfig, withCodexHttpMcpServers } from "./codex-mcp-config.ts";
import { sessionToken, resetSessionSecretForTests } from "./policy/session-token.ts";

const originalData = PATHS.data;
let root: string;
beforeEach(() => {
  const cache = join(homedir(), ".cache/lfg/tmp");
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, "mcp-argv-"));
  PATHS.data = root;
  resetSessionSecretForTests();
});
afterEach(() => {
  PATHS.data = originalData;
  resetSessionSecretForTests();
  rmSync(root, { recursive: true, force: true });
});

function noCredentials(argv: string[], secrets: string[]) {
  // Assert booleans so a regression cannot print credentials in test failures.
  expect(secrets.every((secret) => !argv.join(" ").includes(secret))).toBe(true);
  expect(argv.some((arg) => /(?:Bearer\s|sk-ant-|(?<!env_)http_headers.*=)/.test(arg))).toBe(false);
}

test("Claude SDK launches with a 0600 file, including extra connector credentials", async () => {
  const config = omgMcpServers("claude-test");
  config.mcpServers!.extra = { type: "http", url: "http://127.0.0.1:1", headers: { Authorization: "Bearer test-private-credential" } };
  const resource = claudeMcpConfigFile("claude-test", config);
  const path = resource.options.extraArgs!["mcp-config"]!;
  expect(path.startsWith(root + "/")).toBe(true);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(path, "utf8")).mcpServers.extra.headers.Authorization === "Bearer test-private-credential").toBe(true);
  let argv: string[] = [];
  try { query({ prompt: "test", options: {
    ...resource.options,
    spawnClaudeCodeProcess(options) {
      argv = options.args;
      throw new Error("captured launch");
    },
  } }); } catch {}
  expect(argv.length).toBeGreaterThan(0);
  expect(argv[argv.indexOf("--mcp-config") + 1]).toBe(path);
  noCredentials(argv, [sessionToken("claude-test"), "test-private-credential"]);
  resource[Symbol.dispose]();
  expect(existsSync(path)).toBe(false);
});

test("concurrent Claude queries have independent files; forced close cleans all", () => {
  using a = claudeMcpConfigFile("s", omgMcpServers("s"));
  using b = claudeMcpConfigFile("s", omgMcpServers("s"));
  const first = a.options.extraArgs!["mcp-config"]!;
  const second = b.options.extraArgs!["mcp-config"]!;
  expect(first === second).toBe(false);
  a[Symbol.dispose]();
  expect(existsSync(second)).toBe(true);
  cleanupSessionMcpConfigs("s");
  expect(existsSync(second)).toBe(false);
});

test("orphan cleanup removes crashed owners' files and preserves live queries", () => {
  using config = claudeMcpConfigFile("s", omgMcpServers("s"));
  const path = config.options.extraArgs!["mcp-config"]!;
  expect(reapOrphanMcpConfigs((pid) => pid === process.pid)).toBe(0);
  expect(existsSync(path)).toBe(true);
  expect(reapOrphanMcpConfigs(() => false)).toBe(1);
  expect(existsSync(path)).toBe(false);
  expect(reapOrphanMcpConfigs(() => false)).toBe(0);
});

test("Codex SDK spawned argv and ps contain no credentials; headers reach child env", async () => {
  const capture = join(root, "capture.json");
  const executable = join(root, "codex-fixture");
  writeFileSync(executable, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';
const ps = Bun.spawnSync(['ps', '-ww', '-p', String(process.pid), '-o', 'args=']);
writeFileSync(process.env.CAPTURE, JSON.stringify({args:process.argv.slice(2), ps:new TextDecoder().decode(ps.stdout), header:process.env.OMG_MCP_HEADER_0}));
console.log(JSON.stringify({type:'thread.started',thread_id:'test'}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:0,output_tokens:0,cached_input_tokens:0}}));
`, { mode: 0o700 });
  const secure = codexMcpEnvironment(codexSessionMcpConfig("codex-test", null));
  secure.env.CAPTURE = capture;
  const codex = new Codex({ codexPathOverride: executable, ...secure });
  const { events } = await codex.startThread({ skipGitRepoCheck: true }).runStreamed("test");
  for await (const _ of events) {}
  const result = JSON.parse(readFileSync(capture, "utf8"));
  noCredentials(result.args, [sessionToken("codex-test")]);
  noCredentials([result.ps], [sessionToken("codex-test")]);
  expect(result.header === sessionToken("codex-test")).toBe(true);
  expect(result.args.some((arg: string) => arg.includes("env_http_headers"))).toBe(true);
});

test("Codex scheduled connector credentials do not mutate the parent environment", () => {
  const before = process.env.OMG_MCP_HEADER_0;
  const options = codexMcpEnvironment(withCodexHttpMcpServers({}, {
    connectors: { url: "http://127.0.0.1:1", headers: { Authorization: "Bearer scheduled-secret" } },
  }));
  noCredentials([JSON.stringify(options.config)], ["scheduled-secret"]);
  expect(options.env.OMG_MCP_HEADER_0 === "Bearer scheduled-secret").toBe(true);
  expect(process.env.OMG_MCP_HEADER_0).toBe(before);
});

for (const backend of ["aisdk", "claude-report", "claude-cli", "codex-aisdk", "codex-report", "codex-cli", "opencode", "cursor", "grok", "fx", "copilot", "pi", "jcode", "muse", "deepseek", "devin", "antigravity"]) {
  test(`${backend}: production launch argv has no MCP token or credential literal`, async () => {
    const capture = join(root, "audit.json");
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "test-support/mcp-argv-audit.fixture.ts"), backend], {
      cwd: root,
      env: { ...process.env, HOME: root, XDG_CONFIG_HOME: root, OMG_DATA_DIR: root, LFG_DATA_DIR: root, OMG_SESSION_ID: "argv-audit", LFG_SESSION_ID: "argv-audit", AUDIT_CAPTURE: capture },
      stdout: "ignore", stderr: "pipe",
    });
    const timeout = setTimeout(() => proc.kill(), 10_000);
    try {
      await proc.exited;
      // Do not print subprocess stderr: a failing SDK can echo its arguments.
      expect(existsSync(capture)).toBe(true);
      const evidence = JSON.parse(readFileSync(capture, "utf8"));
      expect(evidence.noToken).toBe(true);
      expect(evidence.noSecretShape).toBe(true);
      if (["aisdk", "claude-report"].includes(backend)) {
        expect(evidence.privateFile).toBe(true);
        expect(evidence.fileHasToken).toBe(true);
      }
      if (["codex-aisdk", "codex-report", "opencode"].includes(backend)) expect(evidence.environmentHasToken).toBe(true);
    } finally {
      clearTimeout(timeout);
      proc.kill();
    }
  }, 15_000);
}
