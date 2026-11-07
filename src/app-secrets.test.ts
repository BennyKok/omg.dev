import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("the key goes to the project .env only, private, and .env is git-ignored", async () => {
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  writeFileSync(join(dir, ".env"), "A=1\n");
  const saved = await saveAppSecret({ key: "FISH_AUDIO_API_KEY", value: "fa_secret_1\n", cwd: dir });
  expect(saved).toEqual({ key: "FISH_AUDIO_API_KEY", localFile: join(dir, ".env"), gitignoreUpdated: true });
  expect(readFileSync(join(dir, ".env"), "utf8")).toBe("A=1\nFISH_AUDIO_API_KEY=fa_secret_1\n");
  expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(".env\n");
});

test("a request with no project folder, a missing folder or an empty value is refused", async () => {
  await expect(saveAppSecret({ key: "K", value: "v" })).rejects.toThrow("no project folder");
  await expect(saveAppSecret({ key: "K", value: "v", cwd: join(dir, "missing") })).rejects.toThrow("not found");
  await expect(saveAppSecret({ key: "K", value: "  ", cwd: dir })).rejects.toThrow("value is required");
});

test("the agent reads the key name and file, never the value or a hosted destination", async () => {
  const saved = await saveAppSecret({ key: "K", value: "super-secret-value", cwd: dir });
  const text = formatSecretSavedText("abc123", saved);
  expect(text).toContain("[env-set K]");
  expect(text).toContain(join(dir, ".env"));
  expect(text).not.toContain("super-secret-value");
  expect(text).not.toContain("hosted");
  expect(text).not.toContain("omg_deploy");
});
