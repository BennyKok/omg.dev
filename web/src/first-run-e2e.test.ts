// App-level guard for the hosted first run.
//
// This mounts the REAL OmgAppSurface — router, shell, live view — against a
// mock transport that answers /api/bootstrap the way a brand new hosted
// Computer does, and asserts on the resulting DOM. It exists because the bug
// it covers slipped through a suite of 2000+ passing tests:
// `onboarding.hosted.coach` was written, sanitized, reset and unit-tested,
// while no screen read it, so a fresh account saw an empty home. Every test
// asked whether the STATE was right. None mounted the app and looked.
//
// Mounted from source rather than from web/dist-lib, deliberately. The embed
// smoke test exercises the built artifact, but this file must certify the code
// in the current tree — precisely the "green while proving nothing" failure
// its own header warns about.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { assertTestBuilds } from "../../scripts/test-builds";

const REPO = join(import.meta.dir, "..", "..");

assertTestBuilds(REPO);

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
    "localStorage",
    "sessionStorage",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "MutationObserver",
    "DOMParser",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
  ]) {
    const value = (win as unknown as Record<string, unknown>)[key];
    if (typeof value === "function" && key.startsWith("request")) {
      g[key] = (value as (...a: unknown[]) => unknown).bind(win);
    } else if (key === "getComputedStyle") {
      g[key] = win.getComputedStyle.bind(win);
    } else {
      g[key] = value;
    }
  }
  // Not implemented by happy-dom; the shell measures with both.
  g.matchMedia ??= () => ({
    matches: false,
    media: "",
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
  (win as unknown as Record<string, unknown>).matchMedia ??= g.matchMedia;
  for (const name of ["ResizeObserver", "IntersectionObserver"]) {
    const stub = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
    g[name] ??= stub;
    (win as unknown as Record<string, unknown>)[name] ??= stub;
  }
  g.scrollTo ??= () => {};
});

/** The hosted coach steps the SERVER declares, so this test cannot drift. */
function serverCoachKeys(): string[] {
  const src = readFileSync(join(REPO, "src/onboarding.ts"), "utf8");
  const block = src.match(/const DEFAULT_HOSTED:[\s\S]*?coach:\s*\{([^}]*)\}/);
  if (!block) throw new Error("could not parse DEFAULT_HOSTED.coach");
  return [...block[1]!.matchAll(/(\w+)\s*:/g)].map((m) => m[1]!);
}

/**
 * A brand new hosted Computer that is PAST the connect gate: no sessions, no
 * roster, no auto agents, intro done, nothing recorded on the coach block.
 * This is the exact state that used to render a blank home.
 */
const freshHostedBootstrap = {
  sessions: [],
  users: [],
  repos: [],
  autoAgents: [],
  findings: [],
  bots: [],
  settings: {},
  onboarding: {
    profiles: [],
    steps: { profile: false, agents: false, repo: false, firstSession: false },
    completedAt: null,
    hosted: { introDoneAt: "2026-08-20T00:00:00.000Z", coach: { session: false, schedule: false } },
  },
};

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function mockTransport() {
  const socket = () => ({
    send() {},
    close() {},
    addEventListener() {},
    removeEventListener() {},
  });
  return {
    fetch: async (input: string | URL | Request) => {
      const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
      if (url.includes("/api/bootstrap")) return okJson(freshHostedBootstrap);
      if (url.includes("/api/onboarding")) return okJson({ state: freshHostedBootstrap.onboarding });
      if (url.includes("/api/coding-agents")) return okJson({ agents: [], models: [] });
      if (url.includes("/api/sessions")) return okJson({ sessions: [] });
      return okJson({});
    },
    request: async () => ({}),
    openSocket: async () => socket(),
    openLiveSocket: async () => socket(),
  };
}

let host: HTMLElement | null = null;
let reactRoot: { unmount: () => void } | null = null;

afterEach(async () => {
  const { act } = await import("react");
  if (reactRoot) act(() => reactRoot!.unmount());
  host?.remove();
  reactRoot = null;
  host = null;
});

describe("a fresh hosted account is shown its onboarding steps", () => {
  test("the real app surface renders the getting-started panel on an empty home", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { OmgAppSurface } = await import("./embedded.tsx");

    host = win.document.createElement("div") as unknown as HTMLElement;
    win.document.body.appendChild(host as unknown as Element);
    const root = createRoot(host);
    reactRoot = root;

    await act(async () => {
      root.render(
        React.createElement(OmgAppSurface, {
          transport: mockTransport(),
          connectionOnboarding: true,
          viewer: { name: "Itechbenny" },
        }),
      );
    });
    // Let bootstrap resolve and the tree settle.
    for (let i = 0; i < 12; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }

    expect(win.document.querySelector("[data-lfg-app-surface]")).not.toBeNull();

    const panel = win.document.querySelector('section[aria-label="Getting started"]');
    expect(
      panel,
      "a brand new hosted account past the connect gate reached the home screen with " +
        "no onboarding at all. This is the blank-home regression: hosted first-run " +
        "state exists on the server but nothing renders it.",
    ).not.toBeNull();

    // One actionable row per step the server tracks — not a hardcoded 2, so a
    // new coach step added server-side must also reach the screen.
    const rows = panel!.querySelectorAll("ol button");
    expect(rows.length).toBe(serverCoachKeys().length);
    expect(panel!.textContent ?? "").toContain(`0 of ${serverCoachKeys().length} done`);
  }, 420_000);
});
