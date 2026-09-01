// One keystroke, one action, with two app surfaces in one document.
//
// The workspace shortcuts live on `window`, because they must work with focus
// anywhere. A host that embeds this library can keep two surfaces alive at
// once, and every surface used to run the same keystroke: one shift+E raised an
// archive dialog in EACH surface, and one "c" started two new sessions.
//
// This mounts the real OmgAppSurface (router, shell, rail, dialogs) rather than
// unit-testing the arbitration helper alone, because the defect was the wiring
// between them, not the rule.
import { beforeAll, beforeEach, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://app.omg.dev/" });

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  for (const key of [
    "window", "document", "navigator", "location", "history", "localStorage",
    "sessionStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent",
    "KeyboardEvent", "MutationObserver", "DOMParser", "requestAnimationFrame",
    "cancelAnimationFrame", "getComputedStyle",
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
  // The rail (and its shortcuts) is the wide layout only.
  const matchMedia = (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
  g.matchMedia = matchMedia;
  (win as unknown as Record<string, unknown>).matchMedia = matchMedia;
  for (const name of ["ResizeObserver", "IntersectionObserver"]) {
    const stub = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    };
    g[name] ??= stub;
    (win as unknown as Record<string, unknown>)[name] ??= stub;
  }
  g.scrollTo ??= () => {};
});

const NOW = new Date().toISOString();

/** A driveable (command-file) session, so the rail admits it. */
function session(sessionId: string, title: string) {
  return {
    sessionId,
    title,
    status: "idle",
    busy: false,
    lastActivityAt: NOW,
    project: "/tmp/p",
    agent: "claude",
    runtime: "command-file",
  };
}

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A transport whose live view holds exactly one, named, session. */
function mockTransport(sessions: ReturnType<typeof session>[]) {
  const socket = () => ({
    send() {}, close() {}, addEventListener() {}, removeEventListener() {},
  });
  const bootstrap = {
    sessions, users: [], repos: [], autoAgents: [], findings: [], bots: [], settings: {},
    onboarding: {
      profiles: [],
      steps: { profile: true, agents: true, repo: true, firstSession: true },
      completedAt: NOW,
      hosted: { introDoneAt: NOW, coach: { session: true, schedule: true } },
    },
  };
  return {
    fetch: async (input: string | URL | Request) => {
      const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
      if (url.includes("/api/bootstrap")) return okJson(bootstrap);
      if (url.includes("/api/onboarding")) return okJson({ state: bootstrap.onboarding });
      if (url.includes("/api/coding-agents")) return okJson({ agents: [], models: [] });
      if (url.includes("/api/sessions") && !url.includes("/close")) return okJson({ sessions });
      return okJson({});
    },
    request: async () => ({}),
    openSocket: async () => socket(),
    openLiveSocket: async () => socket(),
  };
}

let host: Element | null = null;
let reactRoot: { unmount: () => void } | null = null;

beforeEach(async () => {
  const { __resetShortcutScopes } = await import("./lib/shortcut-scope");
  __resetShortcutScopes();
});

afterEach(async () => {
  const { act } = await import("react");
  if (reactRoot) act(() => reactRoot!.unmount());
  host?.remove();
  reactRoot = null;
  host = null;
});

/** Mount the given surfaces side by side and let bootstrap settle. */
async function mountSurfaces(sessionsPerSurface: ReturnType<typeof session>[][]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { OmgAppSurface } = await import("./embedded.tsx");

  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  reactRoot = root;

  await act(async () => {
    root.render(
      React.createElement(
        React.StrictMode,
        null,
        ...sessionsPerSurface.map((sessions, index) =>
          React.createElement(OmgAppSurface, {
            key: index,
            className: `surface-${index}`,
            transport: mockTransport(sessions),
            viewer: { name: "Benny" },
          } as never),
        ),
      ),
    );
  });
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function pressShiftE() {
  const { act } = await import("react");
  await act(async () => {
    win.document.body.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "E", shiftKey: true, bubbles: true }) as never,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function archiveDialogs() {
  return [...win.document.querySelectorAll('[role="alertdialog"]')].map(
    (node) => node.textContent ?? "",
  );
}

test("one surface: shift+E asks once", async () => {
  await mountSurfaces([[session("aaaa1111", "Only")]]);
  expect(win.document.querySelectorAll("[data-rail-sid]").length).toBe(1);

  await pressShiftE();

  const dialogs = archiveDialogs();
  expect(dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("Archive Only?");
}, 120_000);

test("two surfaces: shift+E asks once, in the surface the user touched", async () => {
  await mountSurfaces([
    [session("aaaa1111", "Alpha")],
    [session("bbbb2222", "Bravo")],
  ]);
  expect(win.document.querySelectorAll("[data-rail-sid]").length).toBe(2);

  // The user is working in the second surface.
  const { act } = await import("react");
  const second = win.document.querySelector(".surface-1 [data-rail-sid]");
  expect(second).not.toBeNull();
  await act(async () => {
    second!.dispatchEvent(new win.Event("pointerdown", { bubbles: true }) as never);
  });

  await pressShiftE();

  const dialogs = archiveDialogs();
  expect(
    dialogs.length,
    "one shift+E raised an archive dialog in every mounted surface",
  ).toBe(1);
  expect(dialogs[0]).toContain("Archive Bravo?");
}, 120_000);
