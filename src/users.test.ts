import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { PATHS } from "./config.ts";
import { addOnboardingProfile } from "./onboarding.ts";
import { setUserIcon } from "./user-icons.ts";
import { iconIdentityKey, userRoster } from "./users.ts";

describe("iconIdentityKey", () => {
  test("a roster box keys the icon by a roster email", () => {
    const roster = ["benny@example.com", "angel@example.com"];
    expect(iconIdentityKey("benny@example.com", roster, null)).toEqual({
      ok: true,
      key: "benny@example.com",
    });
  });

  test("a roster box normalizes case/whitespace before matching", () => {
    const roster = ["benny@example.com"];
    expect(iconIdentityKey("  Benny@Example.COM ", roster, null)).toEqual({
      ok: true,
      key: "benny@example.com",
    });
  });

  test("a roster box rejects an email that isn't on the roster", () => {
    const roster = ["benny@example.com"];
    expect(iconIdentityKey("stranger@example.com", roster, null)).toEqual({
      ok: false,
      reason: "unknown user",
    });
  });

  test("a roster box rejects an empty/missing email — it never falls back to the box account", () => {
    const roster = ["benny@example.com"];
    expect(iconIdentityKey(null, roster, "benny@example.com").ok).toBe(false);
  });

  test("a roster-less hosted box ignores the requested email and keys by its paired account", () => {
    expect(iconIdentityKey("whatever@example.com", [], "account@omg.dev")).toEqual({
      ok: true,
      key: "account@omg.dev",
    });
    expect(iconIdentityKey(null, [], "account@omg.dev")).toEqual({
      ok: true,
      key: "account@omg.dev",
    });
  });

  test("a roster-less, unpaired box has no identity to key by", () => {
    expect(iconIdentityKey(null, [], null)).toEqual({
      ok: false,
      reason: "no identity available on this box",
    });
  });
});

describe("userRoster icon precedence (integration)", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "omg-users-"));
    PATHS.data = root;
  });

  afterEach(() => {
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("a settings-uploaded icon beats Gravatar in userRoster()", async () => {
    await addOnboardingProfile({ email: "benny@example.com", name: "Benny" });
    expect(userRoster().find((u) => u.email === "benny@example.com")?.avatar).toContain(
      "gravatar.com",
    );

    const bytes = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#336699" },
    })
      .png()
      .toBuffer();
    await setUserIcon("benny@example.com", new Uint8Array(bytes), "image/png");

    const roster = userRoster();
    expect(roster.find((u) => u.email === "benny@example.com")?.avatar).toMatch(
      /^\/api\/avatars\/[a-f0-9]{32}\.webp\?v=1$/,
    );
  });
});
