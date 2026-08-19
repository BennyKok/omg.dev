import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { PATHS } from "./config.ts";
import { removeUserIcon, setUserIcon, userIconsSync, iconUrl } from "./user-icons.ts";

async function pngBytes(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

describe("user-icons", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "omg-user-icons-"));
    PATHS.data = root;
  });

  afterEach(() => {
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("stores a valid upload and serves it back at a versioned URL", async () => {
    const bytes = await pngBytes(400, 400);
    const { url } = await setUserIcon("benny@example.com", bytes, "image/png");
    expect(url).toMatch(/^\/api\/avatars\/[a-f0-9]{32}\.webp\?v=1$/);

    const icons = userIconsSync();
    expect(iconUrl(icons, "benny@example.com")).toBe(url);
    // Key resolution is case/whitespace insensitive, like every other email
    // key in this codebase.
    expect(iconUrl(icons, "  Benny@Example.com ")).toBe(url);
  });

  test("a replace bumps the version, changing the URL", async () => {
    const first = await setUserIcon("benny@example.com", await pngBytes(400, 400), "image/png");
    const second = await setUserIcon("benny@example.com", await pngBytes(400, 400), "image/png");
    expect(first.url).not.toBe(second.url);
    expect(second.url).toMatch(/\?v=2$/);
    // Same identity key -> same file path (webp, from the md5 of the key) —
    // no orphaned files from the old per-mimetype extension scheme.
    expect(first.url.split("?")[0]).toBe(second.url.split("?")[0]);
  });

  test("rejects an oversized upload", async () => {
    const huge = new Uint8Array(6 * 1024 * 1024);
    await expect(setUserIcon("benny@example.com", huge, "image/png")).rejects.toThrow(/too large/);
  });

  test("rejects an unsupported mime type", async () => {
    await expect(
      setUserIcon("benny@example.com", await pngBytes(400, 400), "image/svg+xml"),
    ).rejects.toThrow(/png, jpeg, webp, or gif/);
  });

  test("rejects an image that is too small to be a meaningful icon", async () => {
    await expect(setUserIcon("benny@example.com", await pngBytes(8, 8), "image/png")).rejects.toThrow(
      /too small/,
    );
  });

  test("rejects an image with an absurd pixel canvas (decompression-bomb guard)", async () => {
    const bytes = await pngBytes(9000, 9000);
    await expect(setUserIcon("benny@example.com", bytes, "image/png")).rejects.toThrow(/too large/);
  });

  test("rejects empty bytes", async () => {
    await expect(setUserIcon("benny@example.com", new Uint8Array(), "image/png")).rejects.toThrow(
      /empty/,
    );
  });

  test("removing an icon deletes the file and the index entry", async () => {
    const { url } = await setUserIcon("benny@example.com", await pngBytes(400, 400), "image/png");
    const file = url.split("/").pop()!.split("?")[0];
    expect(existsSync(join(root, "avatars", file))).toBe(true);

    const removed = await removeUserIcon("benny@example.com");
    expect(removed).toBe(true);
    expect(existsSync(join(root, "avatars", file))).toBe(false);
    expect(iconUrl(userIconsSync(), "benny@example.com")).toBeUndefined();
  });

  test("removing an icon that doesn't exist is a no-op, not an error", async () => {
    expect(await removeUserIcon("nobody@example.com")).toBe(false);
  });

  test("an unrelated key has no icon", () => {
    expect(iconUrl(userIconsSync(), "nobody@example.com")).toBeUndefined();
  });
});
