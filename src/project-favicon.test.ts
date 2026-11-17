import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findProjectFavicon,
  icnsFaviconResponse,
  pageIconHrefs,
  pngFromIcns,
  projectFaviconMime,
  resetProjectFaviconLookups,
} from "./project-favicon.ts";

describe("project favicon", () => {
  const roots: string[] = [];

  function sandbox(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "omg-project-favicon-")));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    resetProjectFaviconLookups();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("prefers the root favicon over nested conventions", async () => {
    const root = sandbox();
    mkdirSync(join(root, "public"));
    writeFileSync(join(root, "favicon.svg"), "<svg/>");
    writeFileSync(join(root, "public", "favicon.png"), "png");

    expect(await findProjectFavicon(root)).toBe(join(root, "favicon.svg"));
  });

  test("finds the web shell icon in a monorepo", async () => {
    const root = sandbox();
    mkdirSync(join(root, "web", "public"), { recursive: true });
    writeFileSync(join(root, "web", "public", "icon.svg"), "<svg/>");

    expect(await findProjectFavicon(root)).toBe(join(root, "web", "public", "icon.svg"));
  });

  test("does not follow a conventional path outside the configured repo", async () => {
    const root = sandbox();
    const outside = sandbox();
    const secret = join(outside, "favicon.svg");
    writeFileSync(secret, "<svg/>");
    symlinkSync(secret, join(root, "favicon.svg"));

    expect(await findProjectFavicon(root)).toBeNull();
  });

  test("finds the icon a page declares when its name is not a convention", async () => {
    const root = sandbox();
    mkdirSync(join(root, "public"));
    writeFileSync(join(root, "public", "favicon-64.png"), "png");
    writeFileSync(
      join(root, "index.html"),
      '<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" type="image/png" href="/favicon-64.png?v=1">',
    );

    expect(await findProjectFavicon(root)).toBe(join(root, "public", "favicon-64.png"));
  });

  test("finds the web app icon in an apps/ monorepo", async () => {
    const root = sandbox();
    mkdirSync(join(root, "apps", "web", "public"), { recursive: true });
    writeFileSync(join(root, "apps", "web", "public", "favicon.svg"), "<svg/>");

    expect(await findProjectFavicon(root)).toBe(join(root, "apps", "web", "public", "favicon.svg"));
  });

  test("a page cannot point the icon outside the repo", async () => {
    const root = sandbox();
    const outside = sandbox();
    writeFileSync(join(outside, "secret.png"), "png");
    writeFileSync(join(root, "index.html"), `<link rel="icon" href="../../../../${outside}/secret.png">`);

    expect(await findProjectFavicon(root)).toBeNull();
  });

  test("reads only local, drawable icon links, SVG first", () => {
    const html = [
      '<link rel="icon" href="https://cdn.example.com/a.png">',
      '<link rel="icon" href="data:image/png;base64,AAAA">',
      '<link rel="icon" href="/a.png">',
      '<link rel="stylesheet" href="/b.css">',
      '<link rel="shortcut icon" href="/c.svg">',
    ].join("");
    expect(pageIconHrefs(html)).toEqual(["/c.svg", "/a.png"]);
  });

  test("serves a PNG from a macOS app icon", async () => {
    const root = sandbox();
    mkdirSync(join(root, "crates", "app", "assets"), { recursive: true });
    const png = (width: number) => {
      const b = new Uint8Array(32);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      new DataView(b.buffer).setUint32(16, width);
      return b;
    };
    const chunk = (type: string, data: Uint8Array) => {
      const b = new Uint8Array(8 + data.length);
      b.set(new TextEncoder().encode(type));
      new DataView(b.buffer).setUint32(4, b.length);
      b.set(data, 8);
      return b;
    };
    const chunks = [chunk("ic10", png(1024)), chunk("ic07", png(128)), chunk("ic08", png(256))];
    const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
    const icns = new Uint8Array(total);
    icns.set(new TextEncoder().encode("icns"));
    new DataView(icns.buffer).setUint32(4, total);
    let at = 8;
    for (const c of chunks) {
      icns.set(c, at);
      at += c.length;
    }
    const path = join(root, "crates", "app", "assets", "AppIcon.icns");
    writeFileSync(path, icns);

    expect(await findProjectFavicon(root)).toBe(path);
    // The smallest PNG that is still sharp at 2x, not the 1024 px one.
    const picked = pngFromIcns(icns)!;
    expect(new DataView(picked.buffer, picked.byteOffset).getUint32(16)).toBe(128);
    const res = await icnsFaviconResponse(new Request("http://x/"), path);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer()).subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const again = await icnsFaviconResponse(new Request("http://x/", { headers: { "if-none-match": res.headers.get("etag")! } }), path);
    expect(again.status).toBe(304);
  });

  test("maps browser image types", () => {
    expect(projectFaviconMime("favicon.svg")).toBe("image/svg+xml");
    expect(projectFaviconMime("favicon.ico")).toBe("image/x-icon");
    expect(projectFaviconMime("favicon.png")).toBe("image/png");
  });
});

describe("project favicon miss", () => {
  test("a 404 for a project without an icon is cacheable", async () => {
    const { projectFaviconMissResponse, PROJECT_FAVICON_MISS_CACHE_CONTROL } = await import("./project-favicon.ts");
    const res = projectFaviconMissResponse();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe(PROJECT_FAVICON_MISS_CACHE_CONTROL);
    expect(PROJECT_FAVICON_MISS_CACHE_CONTROL).toContain("max-age=");
    expect(await res.json()).toEqual({ error: "project favicon not found" });
  });
});
