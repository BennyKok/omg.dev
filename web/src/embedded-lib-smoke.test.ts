// Runtime smoke for the prebuilt @omg-dev/app embed.
//
// The lib build externalizes host-shared packages (react, tanstack router,
// cnfast, vaul, cva). This file is what proves those specifiers resolve and
// that OmgAppSurface still mounts a real router tree — not just that vite
// printed "built in Ns".
//
// The mount tests are not optional. `bun run test` builds dist-lib before Bun
// discovers tests. A direct run of this file fails before registration with
// one actionable prerequisite error when the output is absent. A silent skip
// would report green while proving nothing.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { assertTestBuilds } from "../../scripts/test-builds";

const WEB = join(import.meta.dir, "..");
const REPO = join(WEB, "..");
const DIST = join(WEB, "dist-lib");
const MANIFEST = join(WEB, "package.json");

assertTestBuilds(REPO);

const EXPECTED_PEERS = {
  "@base-ui/react": "^1.6.0",
  "@tanstack/react-router": "^1.170.18",
  "class-variance-authority": "^0.7.1",
  cnfast: "0.0.8",
  react: "^19.2.4",
  "react-dom": "^19.2.4",
  vaul: "^1.1.2",
} as const;

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
      '"@base-ui/react"',
    ]) {
      expect(src).toContain(pkg);
    }
  });

  // @base-ui/react is only safe to externalize while the host declares a range
  // that includes what we compile against. The earlier version of this test
  // asserted the OPPOSITE — it pinned the skip in place — because both repos
  // declared ^1.3.0 while their LOCKS diverged (LFG 1.6.0, host 1.3.0), so a
  // declared-range comparison said "aligned" when the resolutions were not.
  //
  // Once external, the HOST's copy is what LFG runs against, so a host older
  // than our compile target breaks every dialog and menu at runtime — silently,
  // since nothing here would fail to build. Assert the floor explicitly.
  test("@base-ui/react peer floor is >= the version the embed compiles against", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      dependencies: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const compiled = manifest.dependencies["@base-ui/react"];
    const peer = manifest.peerDependencies?.["@base-ui/react"];
    expect(peer).toBe(compiled);
    const minor = (range: string) => {
      const m = /(\d+)\.(\d+)\.(\d+)/.exec(range);
      if (!m) throw new Error(`unparseable range: ${range}`);
      return [Number(m[1]), Number(m[2])] as const;
    };
    // 1.6 is the floor: Dialog.Title/Description gained the `(state) => style`
    // callback there, and the embed is built against it.
    const [major, min] = minor(compiled);
    expect(major).toBe(1);
    expect(min).toBeGreaterThanOrEqual(6);
  });

  test("declares peerDependencies for every externalized host-shared library", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      peerDependencies?: Record<string, string>;
    };
    expect(manifest.peerDependencies).toEqual(EXPECTED_PEERS);
  });
});

describe("built embed resolves host externals and mounts", () => {
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
