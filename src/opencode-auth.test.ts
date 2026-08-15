import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// OpenCode resolves its credential file through XDG_DATA_HOME, so each test
// gets its own store by pointing that at a fresh directory.
let dir: string;
let prevXdg: string | undefined;
let prevKey: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "opencode-auth-"));
  prevXdg = process.env.XDG_DATA_HOME;
  prevKey = process.env.OPENCODE_API_KEY;
  process.env.XDG_DATA_HOME = dir;
  delete process.env.OPENCODE_API_KEY;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdg;
  if (prevKey === undefined) delete process.env.OPENCODE_API_KEY;
  else process.env.OPENCODE_API_KEY = prevKey;
  rmSync(dir, { recursive: true, force: true });
});

async function opencodeAuth() {
  return await import("./opencode-auth.ts");
}

function writeAuth(auth: unknown) {
  mkdirSync(join(dir, "opencode"), { recursive: true });
  writeFileSync(join(dir, "opencode", "auth.json"), JSON.stringify(auth));
}

function readAuth(): Record<string, { type?: string; key?: string }> {
  return JSON.parse(readFileSync(join(dir, "opencode", "auth.json"), "utf8"));
}

test("Go and Zen are offered on a box with no auth.json at all", async () => {
  const { opencodeAuthProviders, hasOpenCodeAccountAuth } = await opencodeAuth();
  // The whole point of the feature: connecting Go must be reachable before
  // anyone has run `opencode auth login`, because that is the box that needs it.
  const providers = opencodeAuthProviders();
  expect(providers.map((p) => p.id)).toEqual(["opencode-go", "opencode"]);
  expect(providers.every((p) => p.method === "api-key")).toBe(true);
  expect(providers.every((p) => !p.connected)).toBe(true);
  expect(hasOpenCodeAccountAuth()).toBe(false);
});

test("a pasted Go key connects the provider and is written in OpenCode's own shape", async () => {
  const { setOpencodeProviderApiKey, opencodeAuthProviders, hasOpenCodeAccountAuth } =
    await opencodeAuth();
  setOpencodeProviderApiKey("opencode-go", "sk-go-test");
  // `{type:"api", key}` is what the CLI writes and what our usage reader looks
  // for; any other shape would store a key the rest of the system cannot see.
  expect(readAuth()["opencode-go"]).toEqual({ type: "api", key: "sk-go-test" });
  expect(opencodeAuthProviders().find((p) => p.id === "opencode-go")?.connected).toBe(true);
  expect(hasOpenCodeAccountAuth()).toBe(true);
});

test("a key is stored 0600 — it is a bearer credential", async () => {
  const { setOpencodeProviderApiKey, opencodeAuthPath } = await opencodeAuth();
  setOpencodeProviderApiKey("opencode-go", "sk-go-test");
  expect(statSync(opencodeAuthPath()).mode & 0o777).toBe(0o600);
});

test("connecting one provider preserves credentials the CLI wrote", async () => {
  const { setOpencodeProviderApiKey } = await opencodeAuth();
  writeAuth({ openai: { type: "oauth", access: "at", refresh: "rt" } });
  setOpencodeProviderApiKey("opencode-go", "sk-go-test");
  // A read-modify-write that dropped the OAuth entry would silently sign the
  // user out of ChatGPT as a side effect of connecting Go.
  expect(readAuth().openai).toEqual({ type: "oauth", access: "at", refresh: "rt" } as never);
  expect(readAuth()["opencode-go"]).toEqual({ type: "api", key: "sk-go-test" });
});

test("a surrounding key is trimmed, and an empty one is refused", async () => {
  const { setOpencodeProviderApiKey } = await opencodeAuth();
  setOpencodeProviderApiKey("opencode-go", "  sk-go-test\n");
  expect(readAuth()["opencode-go"]?.key).toBe("sk-go-test");
  expect(() => setOpencodeProviderApiKey("opencode-go", "   ")).toThrow(/Enter your OpenCode Go/);
});

test("a provider we do not own is refused rather than written", async () => {
  const { setOpencodeProviderApiKey, opencodeAuthPath } = await opencodeAuth();
  // `openai` is a real OpenCode provider, but its credential is an OAuth record
  // the CLI owns. Writing an api entry there would produce a broken login.
  expect(() => setOpencodeProviderApiKey("openai", "sk-test")).toThrow(/not an OpenCode provider/);
  expect(existsSync(opencodeAuthPath())).toBe(false);
});

test("disconnecting removes only that provider", async () => {
  const { setOpencodeProviderApiKey, deleteOpencodeCredential, opencodeAuthProviders } =
    await opencodeAuth();
  setOpencodeProviderApiKey("opencode-go", "sk-go-test");
  setOpencodeProviderApiKey("opencode", "sk-zen-test");
  deleteOpencodeCredential("opencode-go");
  expect(readAuth()["opencode-go"]).toBeUndefined();
  expect(readAuth().opencode).toEqual({ type: "api", key: "sk-zen-test" });
  const providers = opencodeAuthProviders();
  expect(providers.find((p) => p.id === "opencode-go")?.connected).toBe(false);
  expect(providers.find((p) => p.id === "opencode")?.connected).toBe(true);
});

test("disconnecting with no auth.json is a no-op, not a crash", async () => {
  const { deleteOpencodeCredential, opencodeAuthPath } = await opencodeAuth();
  deleteOpencodeCredential("opencode-go");
  expect(existsSync(opencodeAuthPath())).toBe(false);
});

test("a credential with no secret is not a connection", async () => {
  const { opencodeAuthProviders, hasOpenCodeAccountAuth } = await opencodeAuth();
  writeAuth({ "opencode-go": { type: "api" }, openai: { type: "oauth", access: "" } });
  expect(opencodeAuthProviders().every((p) => !p.connected)).toBe(true);
  expect(hasOpenCodeAccountAuth()).toBe(false);
});

test("OPENCODE_API_KEY connects Zen but is not ours to disconnect", async () => {
  const { opencodeAuthProviders } = await opencodeAuth();
  process.env.OPENCODE_API_KEY = "sk-env-test";
  const zen = opencodeAuthProviders().find((p) => p.id === "opencode");
  expect(zen?.connected).toBe(true);
  // `fromEnv` is what hides the delete button; we cannot unset another
  // process's environment, so offering to would be a lie.
  expect(zen?.fromEnv).toBe(true);
});

test("a stored key wins over the environment, so it stays disconnectable", async () => {
  const { setOpencodeProviderApiKey, opencodeAuthProviders } = await opencodeAuth();
  process.env.OPENCODE_API_KEY = "sk-env-test";
  setOpencodeProviderApiKey("opencode", "sk-stored-test");
  expect(opencodeAuthProviders().find((p) => p.id === "opencode")?.fromEnv).toBeUndefined();
});

test("providers the CLI signed into are listed, but not offered for deletion", async () => {
  const { opencodeAuthProviders } = await opencodeAuth();
  writeAuth({ openai: { type: "oauth", access: "at", refresh: "rt" } });
  // "OpenCode is signed in" never said *what to*. An OAuth row we did not
  // create is reported so the page can answer that, and marked as not ours.
  const extra = opencodeAuthProviders().find((p) => p.id === "openai");
  expect(extra?.connected).toBe(true);
  expect(extra?.method).toBe("oauth");
  expect(extra?.fromEnv).toBe(true);
  // `fromEnv` only means "not ours to delete" here. Letting the UI's default
  // caption stand would tell the user this key came from an env var, which is
  // the one thing we know it did not.
  expect(extra?.detail).toBe("Signed in with `opencode auth login`");
});

test("the env-provided Zen key keeps the plain environment caption", async () => {
  const { opencodeAuthProviders } = await opencodeAuth();
  process.env.OPENCODE_API_KEY = "sk-env-test";
  expect(opencodeAuthProviders().find((p) => p.id === "opencode")?.detail).toBeUndefined();
});

test("a corrupt auth.json reads as empty rather than throwing", async () => {
  const { opencodeAuthProviders, hasOpenCodeAccountAuth, setOpencodeProviderApiKey } =
    await opencodeAuth();
  mkdirSync(join(dir, "opencode"), { recursive: true });
  writeFileSync(join(dir, "opencode", "auth.json"), "{not json");
  expect(hasOpenCodeAccountAuth()).toBe(false);
  expect(opencodeAuthProviders().every((p) => !p.connected)).toBe(true);
  // And a connect still succeeds, replacing the unreadable file.
  setOpencodeProviderApiKey("opencode-go", "sk-go-test");
  expect(readAuth()["opencode-go"]?.key).toBe("sk-go-test");
});
