import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  configureHostPush,
  ensurePushSubscription,
  resolvePushRegistration,
  subscriptionMatchesKey,
} from "./push";

/**
 * Which service-worker registration a push subscription is created on.
 *
 * This is not a detail. A subscription belongs to a registration, and a hosted
 * page routinely has more than one: app.omg.dev serves a root cache-drain
 * worker with NO push handler, plus a dedicated push worker on its own scope
 * that already holds the host's own subscription under the host's VAPID key.
 *
 * Subscribing on the wrong one fails silently in the worst way — the browser
 * accepts it, the machine sends successfully, and the notification is handed to
 * a worker that ignores it. So an embedded surface refuses to guess, and a
 * subscription created under a different key is replaced rather than reported
 * as working.
 */

type FakeSubscription = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  unsubscribed?: boolean;
  unsubscribe: () => Promise<boolean>;
};

function fakeSubscription(endpoint: string, key: Uint8Array | null): FakeSubscription {
  const sub: FakeSubscription = {
    endpoint,
    options: {
      applicationServerKey: key ? (key.slice().buffer as ArrayBuffer) : null,
    },
    unsubscribe: async () => {
      sub.unsubscribed = true;
      return true;
    },
  };
  return sub;
}

function fakeRegistration(scope: string, existing: FakeSubscription | null = null) {
  const reg = {
    scope,
    subscription: existing,
    subscribedWith: null as Uint8Array | null,
    pushManager: {
      getSubscription: async () => reg.subscription,
      subscribe: async ({ applicationServerKey }: { applicationServerKey: BufferSource }) => {
        reg.subscribedWith = new Uint8Array(applicationServerKey as ArrayBuffer);
        reg.subscription = fakeSubscription(`https://push.test${scope}`, reg.subscribedWith);
        return reg.subscription;
      },
    },
  };
  return reg;
}

type FakeRegistration = ReturnType<typeof fakeRegistration>;

const registrations = new Map<string, FakeRegistration>();
let registerCalls: { url: string; scope: string }[] = [];

/** A stand-in ServiceWorkerContainer — no global mutation, no DOM needed. */
function fakeContainer() {
  return {
    getRegistration: async (scope?: string) =>
      scope ? registrations.get(scope) : registrations.get("/"),
    register: async (url: string, opts: { scope: string }) => {
      registerCalls.push({ url, scope: opts.scope });
      const reg = fakeRegistration(opts.scope);
      registrations.set(opts.scope, reg);
      return reg;
    },
    // Deliberately never settles: a registration that already exists must be
    // used without waiting on `ready`.
    ready: new Promise(() => {}),
  } as unknown as ServiceWorkerContainer;
}

beforeEach(() => {
  registrations.clear();
  registerCalls = [];
});

afterEach(() => {
  configureHostPush(null);
});

describe("choosing the registration to subscribe on", () => {
  test("standalone uses the registration serving the page", async () => {
    registrations.set("/", fakeRegistration("/"));

    const reg = await resolvePushRegistration({ container: fakeContainer(), embedded: false });
    expect(reg?.scope).toBe("/");
  });

  test("embedded with no declared scope refuses instead of enrolling into silence", async () => {
    // app.omg.dev's root registration is a cache-drain worker with no push
    // handler. Subscribing there would look like success forever.
    registrations.set("/", fakeRegistration("/"));

    expect(
      await resolvePushRegistration({ container: fakeContainer(), embedded: true }),
    ).toBeNull();
  });

  test("embedded uses the scope the host dedicates, not the page's own worker", async () => {
    registrations.set("/", fakeRegistration("/"));
    registrations.set("/__omg_push/", fakeRegistration("/__omg_push/"));
    configureHostPush({ scope: "/__omg_push/" });

    const reg = await resolvePushRegistration({ container: fakeContainer(), embedded: true });
    expect(reg?.scope).toBe("/__omg_push/");
  });

  test("registers the host's worker when its scope has no registration yet", async () => {
    configureHostPush({ scope: "/__omg_push/", workerUrl: "/__omg_push/sw.js" });

    const reg = await resolvePushRegistration({ container: fakeContainer(), embedded: true });
    expect(reg?.scope).toBe("/__omg_push/");
    expect(registerCalls).toEqual([{ url: "/__omg_push/sw.js", scope: "/__omg_push/" }]);
  });

  test("a declared scope with no registration and no worker url stays unavailable", async () => {
    configureHostPush({ scope: "/__omg_push/" });

    expect(
      await resolvePushRegistration({ container: fakeContainer(), embedded: true }),
    ).toBeNull();
    expect(registerCalls).toEqual([]);
  });
});

describe("a subscription created under a different key", () => {
  const KEY = new Uint8Array([1, 2, 3, 4]);

  test("is replaced, not reported as working", async () => {
    // Every send under a mismatched key is rejected 403 by the push service —
    // the exact shape of "notifications just stopped" after the machine's
    // data/push/vapid.json was regenerated.
    const stale = fakeSubscription("https://push.test/stale", new Uint8Array([9, 9, 9]));
    const reg = fakeRegistration("/", stale);

    const sub = await ensurePushSubscription(reg as unknown as ServiceWorkerRegistration, KEY);

    expect(stale.unsubscribed).toBe(true);
    expect(reg.subscribedWith).toEqual(KEY);
    expect(sub).not.toBe(stale as unknown as PushSubscription);
  });

  test("a matching subscription is reused untouched", async () => {
    const current = fakeSubscription("https://push.test/current", KEY);
    const reg = fakeRegistration("/", current);

    const sub = await ensurePushSubscription(reg as unknown as ServiceWorkerRegistration, KEY);

    expect(current.unsubscribed).toBeUndefined();
    expect(reg.subscribedWith).toBeNull();
    expect(sub).toBe(current as unknown as PushSubscription);
  });

  test("subscribes from scratch when there is nothing yet", async () => {
    const reg = fakeRegistration("/");

    await ensurePushSubscription(reg as unknown as ServiceWorkerRegistration, KEY);

    expect(reg.subscribedWith).toEqual(KEY);
  });

  test("subscriptionMatchesKey compares the raw key bytes", () => {
    expect(subscriptionMatchesKey({ options: { applicationServerKey: KEY.slice().buffer } }, KEY)).toBe(
      true,
    );
    expect(
      subscriptionMatchesKey(
        { options: { applicationServerKey: new Uint8Array([1, 2, 3, 5]).buffer } },
        KEY,
      ),
    ).toBe(false);
    expect(subscriptionMatchesKey({ options: { applicationServerKey: null } }, KEY)).toBe(false);
  });
});
