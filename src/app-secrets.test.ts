import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CloudAppsClient } from "../packages/cloud/src/apps.ts";
import {
  formatDotenvLine,
  formatSecretSavedText,
  saveAppSecret,
  upsertDotenvText,
  validateEnvKey,
} from "./app-secrets.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omg-app-secrets-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeClient(onSet: (body: unknown) => unknown): CloudAppsClient {
  return { setEnv: async (body: unknown) => onSet(body) } as unknown as CloudAppsClient;
}

function linkApp() {
  mkdirSync(join(dir, ".omg"), { recursive: true });
  writeFileSync(join(dir, ".omg", "project.json"), JSON.stringify({ slug: "voice", projectId: "p1", name: "Voice" }));
}

test("env key names follow shell rules", () => {
  expect(validateEnvKey(" FISH_AUDIO_API_KEY ")).toBe("FISH_AUDIO_API_KEY");
  expect(() => validateEnvKey("1KEY")).toThrow();
  expect(() => validateEnvKey("A-B")).toThrow();
  expect(() => validateEnvKey("A=B")).toThrow();
});

test("plain values stay bare and others are quoted", () => {
  expect(formatDotenvLine("K", "sk_live_123")).toBe("K=sk_live_123");
  expect(formatDotenvLine("K", 'a b"c\\d\ne')).toBe('K="a b\\"c\\\\d\\ne"');
});

test("upsert replaces the key's line and keeps every other line", () => {
  const before = "# keys\nA=1\nexport FISH_AUDIO_API_KEY=old\nB=2\n";
  expect(upsertDotenvText(before, "FISH_AUDIO_API_KEY", "new")).toBe("# keys\nA=1\nFISH_AUDIO_API_KEY=new\nB=2\n");
  expect(upsertDotenvText("A=1", "B", "2")).toBe("A=1\nB=2\n");
  expect(upsertDotenvText("", "B", "2")).toBe("B=2\n");
});

test("an undeployed project gets the key in .env only, and .env is git-ignored", async () => {
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  writeFileSync(join(dir, ".env"), "A=1\n");
  let called = false;
  const saved = await saveAppSecret({
    key: "FISH_AUDIO_API_KEY",
    value: "fa_secret_1\n",
    cwd: dir,
    client: fakeClient(() => {
      called = true;
    }),
  });
  expect(called).toBe(false);
  expect(saved).toEqual({
    key: "FISH_AUDIO_API_KEY",
    cloud: "not-linked",
    localFile: join(dir, ".env"),
    gitignoreUpdated: true,
  });
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe("A=1\nFISH_AUDIO_API_KEY=fa_secret_1\n");
  expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(".env\n");
  expect(Bun.spawnSync(["git", "check-ignore", "-q", ".env"], { cwd: dir }).exitCode).toBe(0);
});

test("a new .env is created owner-only", async () => {
  await saveAppSecret({ key: "K", value: "v", cwd: dir, client: null });
  expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
});

test("a deployed project also gets the key on the hosted app", async () => {
  linkApp();
  const sent: unknown[] = [];
  const saved = await saveAppSecret({
    key: "FISH_AUDIO_API_KEY",
    value: "fa_secret_1",
    cwd: dir,
    client: fakeClient((body) => sent.push(body)),
  });
  expect(saved.cloud).toBe("set");
  expect(saved.slug).toBe("voice");
  expect(sent).toEqual([{ slug: "voice", projectId: "p1", vars: { FISH_AUDIO_API_KEY: "fa_secret_1" } }]);
});

test("a Cloud failure keeps the local save and never echoes the value", async () => {
  linkApp();
  const saved = await saveAppSecret({
    key: "K",
    value: "fa_secret_1",
    cwd: dir,
    client: fakeClient(() => {
      throw new Error("bad value fa_secret_1");
    }),
  });
  expect(saved.cloud).toBe("failed");
  expect(saved.cloudError).toBe("bad value [redacted]");
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe("K=fa_secret_1\n");
});

test("an empty value is refused before anything is written", async () => {
  await expect(saveAppSecret({ key: "K", value: "  ", cwd: dir, client: null })).rejects.toThrow("value is required");
  expect(() => statSync(join(dir, ".env"))).toThrow();
});

test("the message to the agent names the key and never holds the value", async () => {
  linkApp();
  const saved = await saveAppSecret({
    key: "FISH_AUDIO_API_KEY",
    value: "fa_secret_1",
    cwd: dir,
    client: fakeClient(() => ({})),
  });
  const text = formatSecretSavedText("abc123", saved);
  expect(text.startsWith("[env-set FISH_AUDIO_API_KEY]")).toBe(true);
  expect(text).toContain("process.env.FISH_AUDIO_API_KEY");
  expect(text).not.toContain("fa_secret_1");
});
