import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

describe("OMG icon assets", () => {
  // The mark must be real outlines, not a bitmap. It shipped for five weeks as
  // a grid of ~680 8.28px <rect>s — a 34x26 pixel image in SVG clothing. The
  // header draws it in a 24px box where the glyph gets ~11.7px for 32 source
  // pixels: 0.36px each, well under one device pixel even at DPR 3, so every
  // stroke was averaged into the background and came out grey instead of white.
  // Outlines rasterize against the actual device grid, so they stay crisp.
  // A handful of <rect>/<path> is normal artwork; hundreds means a pixel grid.
  test("keeps the LFG mark as true vector letterforms, never a bitmap", async () => {
    const source = await readFile("web/public/icon.svg", "utf8");
    expect(source).toContain('viewBox="0 0 512 512"');
    expect(source).not.toContain("<image");

    const rects = source.match(/<rect/g)?.length ?? 0;
    expect(rects).toBeLessThan(12);

    // A traced bitmap also hides as one path of hundreds of L commands.
    for (const [, d] of source.matchAll(/\sd="([^"]+)"/g)) {
      expect((d.match(/L/g)?.length ?? 0)).toBeLessThan(60);
    }
  });

  test("ships the small placement variant as the same crisp vector", async () => {
    const source = await readFile("web/public/icon-small.svg", "utf8");
    expect(source).toContain('viewBox="0 0 512 512"');
    expect(source).not.toContain("<image");
    expect((source.match(/<rect/g)?.length ?? 0)).toBeLessThan(12);

    // Vector needs no size-specific artwork: no variants, no @media swap.
    expect(source).not.toContain("@media");
    expect(source).not.toContain('id="full"');
    expect(source).not.toContain('id="mini"');

    for (const path of [
      "web/src/App.tsx",
      "web/src/components/pwa-install.tsx",
      "web/src/components/embedded-connect-gate.tsx",
    ]) {
      const ui = await readFile(path, "utf8");
      expect(ui).not.toContain('omgAssetUrl("/icon.svg")');
    }

    const server = await readFile("src/commands/serve.ts", "utf8");
    expect(server).toContain('"/icon-small.svg"');

    const paths = await readFile("web/src/lib/icon-assets.ts", "utf8");
    expect(paths).toContain("/icon-small.svg?v=");
  });

  test("keeps the consolidated push-only service worker recovery invariants", async () => {
    const worker = await readFile("web/public/sw.js", "utf8");
    // Push-only worker: intercepting navigations made iOS home-screen installs
    // solid black while Safari on the same origin worked. No fetch handler.
    expect(worker).toContain("lfg-sw-gen-push-only-v1");
    // Historical one-shot markers were collapsed — they only opened empty
    // caches forever after the real fix (no fetch + skipWaiting first).
    expect(worker).not.toContain("lfg-cache-reset-black-shell-v");
    expect(worker).not.toContain("lfg-cache-reset-crisp-icon-v1");
    // Only SKIP_WAITING remains on the message channel.
    expect(worker).toMatch(/event\.data\?\.type === ["']SKIP_WAITING["']/);
    expect(worker).not.toMatch(/event\.data\?\.type === ["']PURGE_SHELL_CACHES["']/);
    expect(worker).not.toMatch(/event\.data\?\.type === ["']UNREGISTER_AND_RELOAD["']/);
    expect(worker).not.toContain('self.addEventListener("fetch"');
    expect(worker).not.toContain("self.addEventListener('fetch'");
    // Open clients are no longer force-navigated on activate — that interrupted
    // active product use on every deploy. Page owns reload (toast / cold open).
    expect(worker).not.toContain("reloadControlledClients");
    expect(worker).not.toContain("reloadClientsOnActivate");
    expect(worker).not.toContain("LFG_FORCE_RELOAD");
    // skipWaiting must NOT be awaited behind cache work — that ordering let a
    // failing Cache API abort the install and strand a stale intercepting
    // worker forever. See test/sw-takeover.test.ts, which executes this.
    expect(worker).not.toContain("await self.skipWaiting()");
    expect(worker).toContain('self.addEventListener("push"');
    expect(worker).toContain("async function syncAppBadge()");

    const index = await readFile("web/index.html", "utf8");
    expect(index).toContain('updateViaCache: "none"');
    // Boot shell must not hard-reload on controllerchange — that yanked open
    // sessions on every deploy. Reload is owned by main.tsx only.
    expect(index).not.toMatch(/addEventListener\(\s*["']controllerchange["']/);
    expect(index).not.toContain("controllerReloading");
    expect(index).not.toContain("LFG_FORCE_RELOAD");
    expect(index).not.toContain('lfg:sw-controller-reload');
    expect(index).toContain("showStuckSplashRecovery");
    // Cancel recovery as soon as the entry module evaluates — do not treat a
    // slow cold load (phone + Tailscale after hard reload) as a dead install.
    expect(index).toContain("__lfgMarkAppModule");
    expect(index).toContain("var STUCK_MS = 12000");
    expect(index).not.toContain("}, 4000);");
    expect(index).toContain("/__lfg_boot");

    const main = await readFile("web/src/main.tsx", "utf8");
    expect(main).toContain('updateViaCache: "none"');
    // main.tsx must NOT listen for controller changes (no auto mid-session reload).
    expect(main).not.toMatch(/addEventListener\(\s*["']controllerchange["']/);
    // Resume must not force-adopt — that interrupted product use.
    expect(main).not.toContain("adoptPendingUpdate");
    // Toast Reload + cold-open adopt hard-reload via activateUpdate.
    expect(main).toMatch(
      /function activateUpdate\([\s\S]*?location\.reload\(\)/,
    );
    expect(main).toContain("promptUpdate");
    // Entry module marks itself so index.html cancels the stuck-splash timer.
    expect(main).toContain("__lfgMarkAppModule");

    const serve = await readFile("src/commands/serve.ts", "utf8");
    expect(serve).toContain("/__lfg_pwa_reset");
    expect(serve).toContain("/__lfg_pwa_diag");
    expect(serve).toContain("Home Screen web-app data SEPARATELY");

    const manifest = await readFile("web/public/manifest.webmanifest", "utf8");
    expect(manifest).toContain('"id": "/lfg-hs-2026-08-05"');
    expect(manifest).toContain('"start_url": "/"');
  });

  // Updates may install while the app is open; never hard-reload mid-session or
  // on resume. Reload only on toast action or cold open with a waiting worker.
  test("reloads only on toast Reload or cold open, never on resume", async () => {
    const main = await readFile("web/src/main.tsx", "utf8");
    expect(main).not.toContain("adoptPendingUpdate");
    expect(main).not.toMatch(
      /visibilitychange[\s\S]{0,400}activateUpdate\(/,
    );
    expect(main).toContain("promptUpdate");
    // Cold open: waiting worker at register time → activateUpdate.
    expect(main).toMatch(
      /if\s*\(\s*reg\.waiting\s*&&\s*navigator\.serviceWorker\.controller\s*\)\s*\{\s*activateUpdate\(reg\.waiting\)/,
    );
    // Reload path: SKIP_WAITING + location.reload.
    expect(main).toMatch(
      /function activateUpdate\([\s\S]*?postMessage\(\{\s*type:\s*["']SKIP_WAITING["']\s*\}\)[\s\S]*?location\.reload\(\)/,
    );
  });

  test("ships each generated PNG at its declared size", async () => {
    const assets = [
      ["web/public/icon-192.png", 192, 192],
      ["web/public/icon-512.png", 512, 512],
      ["web/public/icon-maskable-512.png", 512, 512],
      ["web/public/apple-touch-icon.png", 180, 180],
      ["docs/images/omg-icon.png", 192, 192],
    ] as const;

    for (const [path, width, height] of assets) {
      const metadata = await sharp(path).metadata();
      expect([metadata.width, metadata.height]).toEqual([width, height]);
    }
  });

  // Adding an agent to the picker means adding its mark in three places: the
  // file, the server's static allowlist, and the icon-src mapping. Miss the
  // allowlist and the card renders a broken <img> — the file is right there in
  // web/dist, but an unlisted path never reaches staticAssetResponse.
  test("serves every agent mark referenced by the icon mapping", async () => {
    const mapping = await readFile("web/src/lib/session-ui.tsx", "utf8");
    const marks = [...mapping.matchAll(/\/(agent-[a-z0-9-]+\.svg)/g)].map(([, name]) => name);
    expect(marks.length).toBeGreaterThan(1);

    const server = await readFile("src/commands/serve.ts", "utf8");
    for (const mark of new Set(marks)) {
      const source = await readFile(`web/public/${mark}`, "utf8");
      expect(source).toContain("<svg");
      expect(server).toContain(`"/${mark}"`);
    }
  });

  // The jcode mark shipped as an invented blue "J" letterform, which the real
  // project never used. Upstream (github.com/1jehuang/jcode) brands itself with
  // a dot-matrix torus: jcode.sh/favicon.svg is 109 <circle>s, and
  // assets/app-icons/Jcode.icns rasterizes the same ring. Guessing a monogram
  // from a product's first letter is exactly how a wrong mark ships unnoticed.
  test("draws the jcode mark as the upstream dot-matrix torus, not a J", async () => {
    const source = await readFile("web/public/agent-jcode.svg", "utf8");

    // The real mark is built from circles, and there are many of them.
    const circles = source.match(/<circle/g)?.length ?? 0;
    expect(circles).toBeGreaterThan(100);

    // A letterform mark is a single glyph path. The torus has no glyph path.
    const paths = [...source.matchAll(/<path\b/g)].length;
    expect(paths).toBe(0);

    // Keep the provenance comment so the next redraw traces back to upstream.
    expect(source).toContain("jcode.sh/favicon.svg");

    // The dots must stay inside the 512 squircle: the first refit overflowed
    // the artboard and clipped the ring on all four sides.
    const dots = [...source.matchAll(
      /<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"\/>/g,
    )].map(([, cx, cy, r]) => [Number(cx), Number(cy), Number(r)] as const);
    expect(dots.length).toBe(circles);

    const transform = source.match(
      /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/,
    );
    expect(transform).not.toBeNull();
    const [, tx, ty, scale] = transform!.map(Number) as unknown as number[];
    for (const [cx, cy, r] of dots) {
      const x = tx + cx * scale;
      const y = ty + cy * scale;
      const rad = r * scale;
      expect(x - rad).toBeGreaterThanOrEqual(0);
      expect(y - rad).toBeGreaterThanOrEqual(0);
      expect(x + rad).toBeLessThanOrEqual(512);
      expect(y + rad).toBeLessThanOrEqual(512);
    }
  });

  // Two copies of the icon mapping meant two copies of AGENT_ICON_VERSION, and
  // versioned icon URLs are served immutable for a year: bumping one copy left
  // the other pinned to the stale art in every warm browser cache. One source.
  test("keeps a single agent icon mapping and cache-bust version", async () => {
    const campfire = await readFile("web/src/components/UsageCampfire.tsx", "utf8");
    expect(campfire).toContain('from "@/lib/session-ui"');
    expect(campfire).not.toContain("function agentIconSrc");
    expect(campfire).not.toMatch(/const AGENT_ICON_VERSION\s*=/);
  });

  test("keeps the maskable icon fully opaque", async () => {
    const metadata = await sharp("web/public/icon-maskable-512.png").metadata();
    expect(metadata.hasAlpha).toBe(false);
  });

  test("keeps the iOS touch icon opaque and cache-busted", async () => {
    const metadata = await sharp("web/public/apple-touch-icon.png").metadata();
    expect(metadata.hasAlpha).toBe(false);

    // iOS caches home-screen artwork separately and does not reliably
    // revalidate a stable URL, even when ordinary HTTP cache headers change.
    const index = await readFile("web/index.html", "utf8");
    expect(index).toContain(
      'href="/apple-touch-icon.png?v=20260805-opaque"',
    );
  });
});
