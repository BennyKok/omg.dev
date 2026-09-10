import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureOmgProvider, hasOmgProviderAccess, isHostedOmgSandbox, OMG_SIGN_IN_REQUIRED } from "./omg-provider.ts";
import { OMG_MODELS } from "./omg-models.ts";

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

test("hosted proxy environment is a no-op without credentials", () => {
  const opts = { ...options(), env: { OMG_AI_URL: "http://169.254.0.1:9090/v1/" } };
  expect(isHostedOmgSandbox(opts)).toBe(true);
  expect(hasOmgProviderAccess(opts)).toBe(true);
  ensureOmgProvider(opts);
  expect(existsSync(configPath())).toBe(false);
});

test("guest's existing omg provider is a no-op and stays byte-for-byte intact", () => {
  const opts = options();
  const source = '{ // guest managed\n "provider": { "omg": { "options": { "baseURL": "http://169.254.0.1:9090/v1" } } } }';
  put(opts.guestConfigPath, source);
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
        return [id, { name: id }];
      })),
    } } });
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
