import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxAccountEmail, jwtEmailClaim, resetBoxAccountCache } from "./box-account.ts";

const dirs: string[] = [];

function credentialFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "box-account-"));
  dirs.push(dir);
  const path = join(dir, "credentials.json");
  writeFileSync(path, contents);
  return path;
}

function tokenWith(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${encoded}.signature`;
}

afterEach(() => {
  resetBoxAccountCache();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("jwtEmailClaim", () => {
  test("reads and normalizes the email claim", () => {
    expect(jwtEmailClaim(tokenWith({ email: "  Benny@Example.COM ", sub: "x" }))).toBe(
      "benny@example.com",
    );
  });

  test("ignores expiry because attribution is not authentication", () => {
    expect(jwtEmailClaim(tokenWith({ email: "benny@example.com", exp: 1 }))).toBe(
      "benny@example.com",
    );
  });

  test("returns null for malformed values", () => {
    expect(jwtEmailClaim(undefined)).toBeNull();
    expect(jwtEmailClaim(null)).toBeNull();
    expect(jwtEmailClaim(42)).toBeNull();
    expect(jwtEmailClaim("")).toBeNull();
    expect(jwtEmailClaim("not-a-jwt")).toBeNull();
    expect(jwtEmailClaim("a.!!!not-base64!!!.c")).toBeNull();
    expect(jwtEmailClaim(tokenWith({ sub: "x" }))).toBeNull();
    expect(jwtEmailClaim(tokenWith({ email: 42 }))).toBeNull();
    expect(jwtEmailClaim(tokenWith({ email: "   " }))).toBeNull();
  });
});

describe("boxAccountEmail", () => {
  test("reads the token from the credentials file", () => {
    const path = credentialFile(
      JSON.stringify({ token: tokenWith({ email: "benny@example.com" }) }),
    );
    expect(boxAccountEmail(path)).toBe("benny@example.com");
  });

  test("returns null for a missing or corrupt credentials file", () => {
    expect(boxAccountEmail(join(tmpdir(), "definitely-absent-creds.json"))).toBeNull();
    expect(boxAccountEmail(credentialFile("{ not json"))).toBeNull();
  });

  test("picks up a different account without a restart", () => {
    const path = credentialFile(
      JSON.stringify({ token: tokenWith({ email: "first@example.com" }) }),
    );
    expect(boxAccountEmail(path)).toBe("first@example.com");
    writeFileSync(
      path,
      JSON.stringify({ token: tokenWith({ email: "second@example.com" }), pad: "xxxxxxxx" }),
    );
    expect(boxAccountEmail(path)).toBe("second@example.com");
  });
});
