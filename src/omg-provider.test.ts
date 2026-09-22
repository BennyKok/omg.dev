import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureOmgProvider, hasHostedOmgAiProxy, hasOmgProviderAccess, isHostedOmgSandbox, OMG_SIGN_IN_REQUIRED } from "./omg-provider.ts";
import { OMG_MODELS, omgThinkingLevels } from "./omg-models.ts";

let home: string;
let apiUrl: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "omg-provider-"));
  apiUrl = process.env.OMG_API_URL;
  process.env.OMG_API_URL = "https://api.example.test/";
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (apiUrl === undefined) delete process.env.OMG_API_URL;
  else process.env.OMG_API_URL = apiUrl;
});
const options = () => ({ home, env: {}, guestConfigPath: join(home, "guest.jsonc") });
function put(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function credentials(kind = "api-key", token = "omg_sk_test") {
  put(join(home, ".omg/credentials.json"), JSON.stringify({ kind, token }));
}
const configPath = () => join(home, ".config/opencode/opencode.json");

test("hosted proxy environment writes the guest provider without credentials", () => {
  // A fresh hosted Computer ships an opencode.jsonc with no omg provider. The
  // omg agent is still reported connected, so the provider has to come from
  // here or every omg/* turn dies with "Model not found".
  const opts = { ...options(), env: { OMG_AI_URL: "http://169.254.0.1:9090/v1/" } };
  const guest = join(home, ".config/opencode/opencode.jsonc");
  put(guest, '{"$schema":"https://opencode.ai/config.json","model":"opencode/nemotron-3.5-lightning-free"}');
  expect(hasHostedOmgAiProxy(opts)).toBe(true);
  expect(isHostedOmgSandbox(opts)).toBe(true);
  expect(hasOmgProviderAccess(opts)).toBe(true);
  ensureOmgProvider(opts);
  const written = JSON.parse(readFileSync(guest, "utf8"));
  expect(written.model).toBe("opencode/nemotron-3.5-lightning-free");
  expect(written.provider.omg.npm).toBe("@ai-sdk/openai-compatible");
  expect(written.provider.omg.options.baseURL).toBe("http://169.254.0.1:9090/v1");
  expect(written.provider.omg.options.apiKey).toBe("omg-guest");
  expect(Object.keys(written.provider.omg.models)).toContain("deepseek/deepseek-v4-flash-0731");
  expect(existsSync(configPath())).toBe(false);
});

test("hosted omg launch installs MCP into the active JSONC config", () => {
  const command = ["/usr/bin/bun", "/opt/omg/src/cli.ts", "mcp"];
  const opts = {
    ...options(),
    env: { OMG_AI_URL: "http://169.254.0.1:9090" },
    mcpCommand: command,
  };
  const guest = join(home, ".config/opencode/opencode.jsonc");
  put(guest, JSON.stringify({
    mcp: { lfg: { type: "local", command: ["old"], enabled: true }, custom: { enabled: true } },
    provider: { omg: { options: {}, models: {} } },
  }));

  ensureOmgProvider(opts);

  const written = JSON.parse(readFileSync(guest, "utf8"));
  expect(written.mcp.lfg).toBeUndefined();
  expect(written.mcp.custom).toEqual({ enabled: true });
  expect(written.mcp.omg).toEqual({ type: "local", command, enabled: true });
  expect(existsSync(configPath())).toBe(false);
});

test("hosted proxy environment leaves a complete guest config alone", () => {
  const opts = { ...options(), env: { OMG_AI_URL: "http://169.254.0.1:9090" } };
  const guest = join(home, ".config/opencode/opencode.jsonc");
  const models = Object.fromEntries(OMG_MODELS.map((model) => {
    const levels = omgThinkingLevels(model);
    return [model.slice(4), levels ? { variants: Object.fromEntries(levels.map((l) => [l, { reasoningEffort: l }])) } : {}];
  }));
  const source = `{ // guest managed\n "provider": { "omg": { "options": { "baseURL": "http://169.254.0.1:9090/v1", "apiKey": "x" }, "models": ${JSON.stringify(models)} } } }`;
  put(guest, source);
  ensureOmgProvider(opts);
  expect(readFileSync(guest, "utf8")).toBe(source);
});

test("hosted guest config that names omg without thinking variants gets them, options intact", () => {
  // A Computer whose template pre-baked the provider before levels existed:
  // the chosen level would ride as a variant OpenCode does not know.
  const opts = { ...options(), env: { OMG_AI_URL: "http://169.254.0.1:9090" } };
  const guest = join(home, ".config/opencode/opencode.jsonc");
  put(guest, '{ // guest managed\n "provider": { "omg": { "options": { "baseURL": "http://169.254.0.1:9090/v1", "apiKey": "x", "timeout": 9 } } } }');
  ensureOmgProvider(opts);
  const config = JSON.parse(readFileSync(guest, "utf8"));
  expect(config.provider.omg.options).toEqual({ baseURL: "http://169.254.0.1:9090/v1", apiKey: "x", timeout: 9 });
  expect(config.provider.omg.models["deepseek/deepseek-v4-pro"].variants.high).toEqual({ reasoningEffort: "high" });
  expect(config.provider.omg.models["qwen/qwen3-coder-next"].variants).toBeUndefined();
});

test("guest's existing omg provider is a no-op and stays byte-for-byte intact", () => {
  const opts = options();
  const source = '{ // guest managed\n "provider": { "omg": { "options": { "baseURL": "http://169.254.0.1:9090/v1" } } } }';
  put(opts.guestConfigPath, source);
  expect(hasHostedOmgAiProxy(opts)).toBe(false);
  expect(isHostedOmgSandbox(opts)).toBe(true);
  ensureOmgProvider(opts);
  expect(readFileSync(opts.guestConfigPath, "utf8")).toBe(source);
  expect(existsSync(configPath())).toBe(false);
});

test("an unrelated proxy environment does not count as a hosted sandbox", () => {
  expect(isHostedOmgSandbox({ ...options(), env: { OMG_AI_URL: "https://external.example" } })).toBe(false);
});

for (const kind of ["api-key", "oauth", "jwt"]) {
  test(`local write uses the saved ${kind} token as the SDK Bearer apiKey`, () => {
    credentials(kind, `test-${kind}-token`);
    expect(hasOmgProviderAccess(options())).toBe(true);
    ensureOmgProvider(options());
    const config = JSON.parse(readFileSync(configPath(), "utf8"));
    expect(config).toEqual({ provider: { omg: {
      npm: "@ai-sdk/openai-compatible",
      name: "omg",
      options: { baseURL: "https://api.example.test/api/cli/llm/v1", apiKey: `test-${kind}-token` },
      models: Object.fromEntries(OMG_MODELS.map((model) => {
        const id = model.slice(4);
        const levels = omgThinkingLevels(model);
        return [id, {
          name: id,
          ...(levels ? { variants: Object.fromEntries(levels.map((level) => [level, { reasoningEffort: level }])) } : {}),
        }];
      })),
    } } });
    // The level rides as an OpenCode variant named after itself.
    expect(config.provider.omg.models["deepseek/deepseek-v4-pro"].variants).toEqual({
      low: { reasoningEffort: "low" }, medium: { reasoningEffort: "medium" }, high: { reasoningEffort: "high" },
    });
    expect(config.provider.omg.models["qwen/qwen3-coder-next"].variants).toBeUndefined();
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  });
}

test("merge preserves other keys, providers, and custom omg options", () => {
  credentials();
  put(configPath(), JSON.stringify({ theme: "dark", mcp: { custom: { enabled: true } }, provider: {
    other: { npm: "other-sdk" }, omg: { options: { timeout: 500, apiKey: "old" }, models: { custom: { name: "Custom" } } },
  } }));
  ensureOmgProvider(options());
  const result = JSON.parse(readFileSync(configPath(), "utf8"));
  expect(result.theme).toBe("dark");
  expect(result.mcp).toEqual({ custom: { enabled: true } });
  expect(result.provider.other).toEqual({ npm: "other-sdk" });
  expect(result.provider.omg.options).toEqual({ timeout: 500, baseURL: "https://api.example.test/api/cli/llm/v1", apiKey: "omg_sk_test" });
  expect(result.provider.omg.models.custom).toEqual({ name: "Custom" });
  const first = readFileSync(configPath(), "utf8");
  ensureOmgProvider(options());
  expect(readFileSync(configPath(), "utf8")).toBe(first);
});

test("prefers existing JSONC, parses comments and trailing commas, honors XDG", () => {
  credentials();
  const xdg = join(home, "xdg");
  const path = join(xdg, "opencode/opencode.jsonc");
  put(path, '{ // comment\n "theme": "light", "provider": {"other": {}}, }');
  ensureOmgProvider({ ...options(), env: { XDG_CONFIG_HOME: xdg } });
  const result = JSON.parse(readFileSync(path, "utf8"));
  expect(result.theme).toBe("light");
  expect(result.provider.other).toEqual({});
  expect(result.provider.omg.options.apiKey).toBe("omg_sk_test");
  expect(existsSync(join(xdg, "opencode/opencode.json"))).toBe(false);
});

test("missing credentials fail with the login instruction before writing", () => {
  expect(hasOmgProviderAccess(options())).toBe(false);
  expect(() => ensureOmgProvider(options())).toThrow(OMG_SIGN_IN_REQUIRED);
  expect(existsSync(configPath())).toBe(false);
});

test("invalid config is not overwritten", () => {
  credentials();
  put(configPath(), "{broken");
  expect(() => ensureOmgProvider(options())).toThrow("Cannot update invalid JSON config:");
  expect(readFileSync(configPath(), "utf8")).toBe("{broken");
});
