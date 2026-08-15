// Runtime smoke for the prebuilt @omg-dev/app embed.
//
// The lib build externalizes host-shared packages (react, tanstack router,
// cnfast, vaul, cva). This file is what proves those specifiers resolve and
// that OmgAppSurface still mounts a real router tree — not just that vite
// printed "built in Ns".
//
// The mount tests are not optional. If dist-lib/index.js is missing they
// build it; if the build fails they fail the suite. A silent skip reports
// green while proving nothing.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

const WEB = join(import.meta.dir, "..");
const REPO = join(WEB, "..");
const DIST = join(WEB, "dist-lib");
const INDEX = join(DIST, "index.js");
const MANIFEST = join(WEB, "package.json");

const EXPECTED_PEERS = {
  "@tanstack/react-router": "^1.170.18",
  "class-variance-authority": "^0.7.1",
  cnfast: "0.0.8",
  react: "^19.2.4",
  "react-dom": "^19.2.4",
  vaul: "^1.1.2",
} as const;

function ensureLibBuild(): void {
  if (existsSync(INDEX)) return;
  const result = spawnSync("bun", ["run", "--cwd", "web", "build:lib"], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 180_000,
  });
  if (result.status !== 0 || !existsSync(INDEX)) {
    throw new Error(
      [
        "embed smoke test requires web/dist-lib/index.js and will not skip.",
        "bun run --cwd web build:lib failed:",
        result.stdout ?? "",
        result.stderr ?? "",
        result.error ? String(result.error) : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

const win = new Window({ url: "https://app.omg.dev/" });
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  for (const key of [
    "window",
    "document",
    "navigator",
    "location",
    "history",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "MutationObserver",
    "ResizeObserver",
    "IntersectionObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
    "matchMedia",
    "localStorage",
    "sessionStorage",
    "DOMParser",
  ]) {
    const value = (win as unknown as Record<string, unknown>)[key];
    if (value !== undefined) g[key] = value;
  }
  if (typeof g.matchMedia !== "function") {
    g.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    });
  }
  if (typeof g.ResizeObserver !== "function") {
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("vite.lib.config host-shared externals", () => {
  const src = readFileSync(join(WEB, "vite.lib.config.ts"), "utf8");

  test("externalizes the host-shared libraries the dashboard already ships", () => {
    for (const pkg of [
      '"@tanstack/react-router"',
      '"cnfast"',
      '"class-variance-authority"',
      '"vaul"',
      '"react"',
    ]) {
      expect(src).toContain(pkg);
    }
  });

  test("does not externalize @base-ui/react (host 1.3.0 vs LFG 1.6.0)", () => {
    expect(src).toContain("Deliberately NOT external");
    expect(src).toMatch(/@base-ui\/react\s+—/);
    expect(src).not.toMatch(/HOST_SHARED_EXTERNALS = \[[^\]]*@base-ui\/react/);
  });

  test("declares peerDependencies for every externalized host-shared library", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      peerDependencies?: Record<string, string>;
    };
    expect(manifest.peerDependencies).toEqual(EXPECTED_PEERS);
  });
});

describe("built embed resolves host externals and mounts", () => {
  beforeAll(ensureLibBuild);

  let host: HTMLElement | null = null;
  let reactRoot: { unmount: () => void } | null = null;

  afterEach(() => {
    reactRoot?.unmount();
    host?.remove();
    reactRoot = null;
    host = null;
  });

  test("eager chunk imports the shared libs instead of inlining them", () => {
    const embedded = readdirSync(DIST).find((name) => name.startsWith("embedded-") && name.endsWith(".js"));
    expect(embedded).toBeTruthy();
    const code = readFileSync(join(DIST, embedded!), "utf8");
    expect(code).toContain('from "@tanstack/react-router"');
    expect(code).toContain('from "cnfast"');
    expect(code).toContain('from "vaul"');
    expect(code).toContain('from "class-variance-authority"');
    expect(code).not.toContain("isViewTransitionTypesSupported");
    expect(code).not.toContain("isThemeGetter");
  });

  test("OmgAppSurface mounts a memory-router tree against a mock transport", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { OmgAppSurface } = await import("../dist-lib/index.js");

    const transport = {
      fetch: async () => new Response("{}", { status: 200 }),
      request: async () => ({}),
      openSocket: async () => ({
        send() {},
        close() {},
        addEventListener() {},
        removeEventListener() {},
      }),
      openLiveSocket: async () => ({
        send() {},
        close() {},
        addEventListener() {},
        removeEventListener() {},
      }),
    };

    host = win.document.createElement("div") as unknown as HTMLElement;
    win.document.body.appendChild(host as unknown as Element);
    const root = createRoot(host);
    reactRoot = root;

    await act(async () => {
      root.render(
        React.createElement(OmgAppSurface, {
          transport,
          connectionOnboarding: false,
        }),
      );
    });

    const surface = win.document.querySelector("[data-lfg-app-surface]");
    expect(surface).not.toBeNull();
  });
});
