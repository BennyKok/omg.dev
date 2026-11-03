import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import { autoAgentToken, boxSecretMaterial, resetSessionSecretForTests, sessionToken, verifyAutoAgentToken, verifySessionToken } from "./session-token.ts";
import { rotateSessionTokenSecret, sessionTokenKeyRing, sessionTokenSecretStatus, SESSION_TOKEN_GRACE_MS } from "./session-token-secret.ts";
import { configureConnectors } from "../../packages/connectors/src/context.ts";
import { getOAuthState, saveTokens } from "../../packages/connectors/src/oauth-store.ts";
import { resolveMcpCaller } from "./caller.ts";

const originalData = PATHS.data;
let root: string;
beforeEach(() => {
  const cache = join(homedir(), ".cache/lfg/tmp");
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, "session-key-"));
  PATHS.data = root;
  resetSessionSecretForTests();
});
afterEach(() => {
  PATHS.data = originalData;
  resetSessionSecretForTests();
  configureConnectors({ dataDir: () => PATHS.data, secret: boxSecretMaterial, baseUrl: () => "http://127.0.0.1:8766" });
  rmSync(root, { recursive: true, force: true });
});

test("fresh installs use independent session and at-rest keys", () => {
  const key = sessionTokenKeyRing();
  expect(key.current.version === "legacy").toBe(false);
  expect(existsSync(join(root, "session-secret"))).toBe(false);
  expect(key.current.secret === boxSecretMaterial()).toBe(false);
  expect(statSync(join(root, "session-token-secret")).mode & 0o777).toBe(0o600);
  const token = sessionToken("s");
  expect(token.startsWith(key.current.version + ".")).toBe(true);
  expect(verifySessionToken("s", token)).toBe(true);
  expect(verifySessionToken("another", token)).toBe(false);
});

test("upgrade preserves legacy tokens until explicit rotation, then grace expires", () => {
  const legacy = boxSecretMaterial();
  const old = createHmac("sha256", legacy).update("s").digest("base64url");
  expect(sessionToken("s") === old).toBe(true);
  expect(verifySessionToken("s", old, Date.now() + 10 * SESSION_TOKEN_GRACE_MS)).toBe(true);
  const now = Date.now();
  const status = rotateSessionTokenSecret(SESSION_TOKEN_GRACE_MS, now);
  const fresh = sessionToken("s");
  expect(fresh === old).toBe(false);
  expect(status.previous?.version).toBe("legacy");
  expect(verifySessionToken("s", old, now)).toBe(true);
  expect(verifySessionToken("s", old, now + SESSION_TOKEN_GRACE_MS - 1)).toBe(true);
  expect(verifySessionToken("s", old, now + SESSION_TOKEN_GRACE_MS)).toBe(false);
  expect(verifySessionToken("s", fresh, now + SESSION_TOKEN_GRACE_MS)).toBe(true);
  expect(boxSecretMaterial() === legacy).toBe(true);
});

test("versioned sessions and auto-agent tokens share grace but not identity", () => {
  const old = sessionToken("s");
  const oldAuto = autoAgentToken("a");
  const now = Date.now();
  rotateSessionTokenSecret(1000, now);
  const fresh = sessionToken("s");
  const freshAuto = autoAgentToken("a");
  expect(verifySessionToken("s", old, now + 999)).toBe(true);
  expect(verifyAutoAgentToken("a", oldAuto, now + 999)).toBe(true);
  expect(verifySessionToken("s", old, now + 1000)).toBe(false);
  expect(verifyAutoAgentToken("a", oldAuto, now + 1000)).toBe(false);
  expect(verifySessionToken("s", fresh, now + 1000)).toBe(true);
  expect(verifyAutoAgentToken("a", freshAuto, now + 1000)).toBe(true);
  expect(verifySessionToken("a", freshAuto)).toBe(false);
  expect(verifyAutoAgentToken("s", fresh)).toBe(false);
  expect(verifySessionToken("s", "wrong-version." + fresh.split(".")[1])).toBe(false);
});

test("rotation cannot discard a previous key during its grace window", () => {
  const now = Date.now();
  rotateSessionTokenSecret(1000, now);
  const token = sessionToken("s");
  expect(() => rotateSessionTokenSecret(1000, now + 999)).toThrow("still in its grace period");
  expect(sessionToken("s") === token).toBe(true);
  rotateSessionTokenSecret(1000, now + 1000);
  expect(verifySessionToken("s", token, now + 1999)).toBe(true);
  expect(verifySessionToken("s", token, now + 2000)).toBe(false);
  expect(() => rotateSessionTokenSecret(0)).toThrow("Grace must");
});

test("connector ciphertext and box key remain unchanged and decrypt after rotation", () => {
  configureConnectors({ dataDir: () => root, secret: boxSecretMaterial, baseUrl: () => "http://127.0.0.1:8766" });
  saveTokens("connector", { access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "Bearer" });
  const ciphertext = readFileSync(join(root, "connector-oauth.enc"));
  const box = readFileSync(join(root, "session-secret"));
  rotateSessionTokenSecret();
  resetSessionSecretForTests();
  expect(readFileSync(join(root, "session-secret")).equals(box)).toBe(true);
  expect(readFileSync(join(root, "connector-oauth.enc")).equals(ciphertext)).toBe(true);
  expect(getOAuthState("connector")?.tokens?.access_token === "test-access-token").toBe(true);
  expect(getOAuthState("connector")?.tokens?.refresh_token === "test-refresh-token").toBe(true);
});

test("corrupt key files fail closed and never echo or replace their contents", () => {
  writeFileSync(join(root, "session-token-secret"), "test-secret-that-is-not-json", { mode: 0o600 });
  expect(() => sessionToken("s")).toThrow("Invalid session-token-secret; refusing to replace it");
  expect(() => verifySessionToken("s", "test")).toThrow("Invalid session-token-secret");
  expect(readFileSync(join(root, "session-token-secret"), "utf8") === "test-secret-that-is-not-json").toBe(true);
});

test("concurrent first launches publish one complete key and mint the same token", async () => {
  const module = join(import.meta.dir, "session-token.ts");
  const script = `import {sessionToken} from ${JSON.stringify(module)}; console.log(sessionToken('parallel'));`;
  const tokens = await Promise.all(Array.from({ length: 8 }, async () => {
    const proc = Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, OMG_DATA_DIR: root, LFG_DATA_DIR: root }, stdout: "pipe", stderr: "ignore" });
    const token = (await new Response(proc.stdout).text()).trim();
    expect(await proc.exited).toBe(0);
    return token;
  }));
  expect(tokens.every((token) => token.length > 0 && token === tokens[0])).toBe(true);
  expect(verifySessionToken("parallel", tokens[0])).toBe(true);
});

test("admin CLI rotates across processes, reports fingerprints only, and live verification reloads", async () => {
  const old = sessionToken("s");
  const secret = sessionTokenKeyRing().current.secret;
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../cli.ts"), "computer", "session-token", "rotate"], {
    env: { ...process.env, OMG_DATA_DIR: root, LFG_DATA_DIR: root }, stdout: "pipe", stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(output.includes(secret) || output.includes(old)).toBe(false);
  const status = JSON.parse(output);
  expect(status.current.fingerprint.length).toBe(12);
  expect(sessionTokenSecretStatus().current.version).toBe(status.current.version);
  expect(sessionToken("s") === old).toBe(false);
  expect(verifySessionToken("s", old)).toBe(true);
  expect(verifySessionToken("s", old, status.previous.expiresAt)).toBe(false);
});

test("a held rotation lock blocks mutation", () => {
  const token = sessionToken("s");
  writeFileSync(join(root, "session-token-secret.lock"), String(process.pid));
  expect(() => rotateSessionTokenSecret()).toThrow("rotation is locked");
  expect(sessionToken("s") === token).toBe(true);
});

test("MCP HTTP boundary rejects expired claims for active and ended sessions", async () => {
  const old = sessionToken("s");
  rotateSessionTokenSecret(1000, Date.now() - 1001);
  const fresh = sessionToken("s");
  const row = { tmuxName: "s", cwd: "/", createdAt: 1, sessionId: "s", mcpTokenRequired: true };
  for (const endpoint of ["/mcp", "/mcp/computer", "/mcp/connectors"]) {
    const request = (token: string) => new Request(`http://127.0.0.1${endpoint}?session=s`, { headers: { "x-omg-session-token": token } });
    for (const lookup of [() => row, () => undefined]) {
      const denied = resolveMcpCaller(request(old), lookup);
      expect(denied instanceof Response).toBe(true);
      expect((denied as Response).status).toBe(401);
      expect((await (denied as Response).text()).includes(old)).toBe(false);
      const allowed = resolveMcpCaller(request(fresh), lookup);
      expect(allowed instanceof Response).toBe(false);
      if (!(allowed instanceof Response)) expect(allowed.sessionId).toBe("s");
    }
  }
});
