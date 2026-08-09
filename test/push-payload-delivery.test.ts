import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The receiving half of cross-origin push delivery.
 *
 * A payload-less push makes the worker fetch the notice from /api/push/pending.
 * That call is same-origin, so it only reaches the lfg box when the app is
 * served BY that box. On a hosted surface driving a self-hosted machine the
 * worker lives on the host's origin and the fetch resolves to the host's
 * server, which knows nothing about the queue — the notification silently
 * degrades to "New activity in your sessions", or to another user's feed.
 *
 * So the worker must render an encrypted payload without any callback at all.
 * These tests run the real sw.js and prove it.
 */
const SW_SOURCE = readFileSync(join(import.meta.dir, "..", "web", "public", "sw.js"), "utf8");

type Shown = { title: string; options: Record<string, unknown> };

function loadWorker(options: { navigateFails?: boolean } = {}) {
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: Shown[] = [];
  const fetched: string[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let focused = 0;

  const client = {
    focus: async () => {
      focused++;
    },
    navigate: async (url: string) => {
      if (options.navigateFails) throw new Error("cross-origin navigation is not allowed");
      navigated.push(url);
    },
  };

  const selfStub = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      handlers.set(type, handler);
    },
    skipWaiting: () => Promise.resolve(),
    clients: {
      claim: async () => {},
      matchAll: async () => [client],
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
    registration: {
      unregister: async () => true,
      getNotifications: async () => shown,
      showNotification: async (title: string, opts: Record<string, unknown>) => {
        shown.push({ title, options: opts });
      },
      pushManager: {
        getSubscription: async () => ({ endpoint: "https://push.test/device" }),
      },
    },
    navigator: { setAppBadge: async () => {}, clearAppBadge: async () => {} },
  };

  const caches = {
    keys: async () => [],
    open: async () => ({}),
    delete: async () => true,
    match: async () => undefined,
  };

  const fetchStub = async (url: string) => {
    fetched.push(String(url));
    return { ok: true, json: async () => ({ notification: null, questions: [], findings: [] }) };
  };

  // eslint-disable-next-line no-new-func
  new Function("self", "caches", "fetch", SW_SOURCE)(selfStub, caches, fetchStub);

  return {
    shown,
    fetched,
    opened,
    navigated,
    get focused() {
      return focused;
    },
    async fire(type: string, event: Record<string, unknown>) {
      const waited: unknown[] = [];
      const handler = handlers.get(type);
      if (!handler) throw new Error(`sw.js registered no ${type} handler`);
      handler({ ...event, waitUntil: (p: unknown) => waited.push(p) });
      await Promise.allSettled(waited);
    },
  };
}

describe("encrypted-payload push delivery", () => {
  test("renders the notice from the message without calling back to the API", async () => {
    const sw = loadWorker();
    const payload = {
      title: "Shipped: Faster search",
      body: "Results now appear instantly.",
      url: "https://app.omg.example/?session=abc",
      tag: "shipped-1",
    };

    await sw.fire("push", { data: { json: () => payload } });

    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe("Shipped: Faster search");
    expect(sw.shown[0].options.body).toBe("Results now appear instantly.");
    expect(sw.shown[0].options.data).toEqual({ url: "https://app.omg.example/?session=abc" });
    // The whole point: no /api/push/pending round trip, so this works on an
    // origin that is not the lfg box.
    expect(sw.fetched).toEqual([]);
  });

  test("keeps a question on screen until it is acted on", async () => {
    const sw = loadWorker();

    await sw.fire("push", {
      data: {
        json: () => ({ title: "omg needs your input", tag: "ask-7", requireInteraction: true }),
      },
    });

    expect(sw.shown[0].options.requireInteraction).toBe(true);
  });

  test("still falls back to fetching when the push carries no payload", async () => {
    const sw = loadWorker();

    await sw.fire("push", { data: null });

    expect(sw.fetched[0]).toContain("/api/push/pending?endpoint=");
  });

  test("opens a cross-origin deep link that an open window cannot navigate to", async () => {
    // client.navigate() rejects for another origin — which is exactly what an
    // absolute hosted-surface url is. Without the fallback the tap focused a
    // window still showing the old page and the deep link was lost.
    const sw = loadWorker({ navigateFails: true });

    await sw.fire("notificationclick", {
      notification: { close: () => {}, data: { url: "https://app.omg.example/?session=abc" } },
    });

    expect(sw.opened).toEqual(["https://app.omg.example/?session=abc"]);
    expect(sw.focused).toBe(1);
  });

  test("navigates in place when the target is same-origin", async () => {
    const sw = loadWorker();

    await sw.fire("notificationclick", {
      notification: { close: () => {}, data: { url: "/?session=abc" } },
    });

    expect(sw.navigated).toEqual(["/?session=abc"]);
    expect(sw.opened).toEqual([]);
  });
});
