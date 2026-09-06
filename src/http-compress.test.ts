import { afterEach, describe, expect, test } from "bun:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compressedAssetResponse,
  maybeCompressResponse,
  resetCompressedAssetCache,
} from "./http-compress.ts";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "omg-compress-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  resetCompressedAssetCache();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BIG = "const x = 1;\n".repeat(400); // ~5 KB, compresses well

describe("compressedAssetResponse", () => {
  test("prefers the precompressed sibling when one exists", async () => {
    const dir = scratch();
    const file = join(dir, "app.js");
    writeFileSync(file, BIG);
    writeFileSync(`${file}.br`, "sibling");
    const res = await compressedAssetResponse(
      new Request("http://x/assets/app.js", { headers: { "accept-encoding": "gzip, br" } }),
      file,
      { "Content-Type": "application/javascript" },
    );
    expect(res?.headers.get("content-encoding")).toBe("br");
    expect(await res?.text()).toBe("sibling");
  });

  test("compresses on the fly when no sibling shipped, and serves the same bytes back", async () => {
    const dir = scratch();
    const file = join(dir, "index.css");
    writeFileSync(file, BIG);
    const req = () =>
      new Request("http://x/assets/index.css", { headers: { "accept-encoding": "br, gzip" } });
    const res = await compressedAssetResponse(req(), file, { "Content-Type": "text/css" });
    expect(res).not.toBeNull();
    expect(res!.headers.get("content-encoding")).toBe("br");
    expect(res!.headers.get("vary")).toBe("Accept-Encoding");
    const body = new Uint8Array(await res!.arrayBuffer());
    expect(body.byteLength).toBeLessThan(BIG.length / 4);
    expect(Number(res!.headers.get("content-length"))).toBe(body.byteLength);
    expect(brotliDecompressSync(body).toString()).toBe(BIG);
    // Second hit is served from the cache: same bytes, no re-encode.
    const again = await compressedAssetResponse(req(), file, { "Content-Type": "text/css" });
    expect(new Uint8Array(await again!.arrayBuffer())).toEqual(body);
  });

  test("falls back to gzip when the client does not accept brotli", async () => {
    const dir = scratch();
    const file = join(dir, "chunk.js");
    writeFileSync(file, BIG);
    const res = await compressedAssetResponse(
      new Request("http://x/assets/chunk.js", { headers: { "accept-encoding": "gzip" } }),
      file,
      { "Content-Type": "application/javascript" },
    );
    expect(res!.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(new Uint8Array(await res!.arrayBuffer())).toString()).toBe(BIG);
  });

  test("leaves tiny files, already-compressed formats and clients without accept-encoding alone", async () => {
    const dir = scratch();
    const tiny = join(dir, "tiny.js");
    writeFileSync(tiny, "x");
    expect(
      await compressedAssetResponse(
        new Request("http://x/a", { headers: { "accept-encoding": "br" } }),
        tiny,
        {},
      ),
    ).toBeNull();
    const png = join(dir, "img.png");
    writeFileSync(png, BIG);
    expect(
      await compressedAssetResponse(
        new Request("http://x/a", { headers: { "accept-encoding": "br" } }),
        png,
        {},
      ),
    ).toBeNull();
    const big = join(dir, "big.js");
    writeFileSync(big, BIG);
    expect(await compressedAssetResponse(new Request("http://x/a"), big, {})).toBeNull();
  });

  test("a rebuilt file under the same name is not served from the stale cache", async () => {
    const dir = scratch();
    const file = join(dir, "dev.js");
    writeFileSync(file, BIG);
    const req = () => new Request("http://x/a", { headers: { "accept-encoding": "gzip" } });
    const first = await compressedAssetResponse(req(), file, {});
    expect(gunzipSync(new Uint8Array(await first!.arrayBuffer())).toString()).toBe(BIG);
    // A real rebuild is seconds apart; in a test two writes can land in the
    // same millisecond, so let the size change carry the key.
    const NEXT = "const y = 22;\n".repeat(400);
    writeFileSync(file, NEXT);
    const second = await compressedAssetResponse(req(), file, {});
    expect(gunzipSync(new Uint8Array(await second!.arrayBuffer())).toString()).toBe(NEXT);
  });
});

describe("maybeCompressResponse", () => {
  const html = `<!doctype html><html><head></head><body>${"<p>hello</p>".repeat(300)}</body></html>`;

  test("compresses the HTML app shell on / and on SPA fallback routes", async () => {
    for (const path of ["/", "/sessions/abc"]) {
      const res = await maybeCompressResponse(
        new Request(`http://x${path}`, { headers: { "accept-encoding": "br" } }),
        path,
        new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      );
      expect(res!.headers.get("content-encoding")).toBe("br");
      expect(brotliDecompressSync(new Uint8Array(await res!.arrayBuffer())).toString()).toBe(html);
    }
  });

  test("still leaves non-HTML, non-API bodies untouched", async () => {
    const res = await maybeCompressResponse(
      new Request("http://x/sw.js", { headers: { "accept-encoding": "br" } }),
      "/sw.js",
      new Response(BIG, { headers: { "Content-Type": "application/javascript" } }),
    );
    expect(res!.headers.get("content-encoding")).toBeNull();
  });

  test("still compresses JSON under /api/", async () => {
    const body = JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ i, name: "session" })) });
    const res = await maybeCompressResponse(
      new Request("http://x/api/sessions", { headers: { "accept-encoding": "gzip" } }),
      "/api/sessions",
      new Response(body, { headers: { "Content-Type": "application/json" } }),
    );
    expect(res!.headers.get("content-encoding")).toBe("gzip");
  });
});
