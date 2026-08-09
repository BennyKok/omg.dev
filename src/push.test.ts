import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  listSubscriptions,
  notifyAll,
  queuePushNotification,
  resolveNotificationUrl,
  saveSubscription,
  takePushNotification,
} from "./push.ts";
import { decryptPushPayload } from "./push-encrypt.ts";

const realData = PATHS.data;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lfg-push-"));
  PATHS.data = dir;
});

afterEach(async () => {
  PATHS.data = realData;
  await rm(dir, { recursive: true, force: true });
});

describe("event-specific push notifications", () => {
  test("queues shipped notices only for the assigned user's devices", async () => {
    await saveSubscription({ endpoint: "https://push.test/benny", user: "benny@example.com" });
    await saveSubscription({ endpoint: "https://push.test/angel", user: "angel@example.com" });

    await queuePushNotification(
      {
        title: "Shipped: Faster search",
        body: "Results now appear instantly.",
        url: "/?session=session-123",
        tag: "shipped-post-1",
      },
      { user: "benny@example.com" },
    );

    expect(await takePushNotification("https://push.test/benny")).toEqual({
      title: "Shipped: Faster search",
      body: "Results now appear instantly.",
      url: "/?session=session-123",
      tag: "shipped-post-1",
    });
    expect(await takePushNotification("https://push.test/benny")).toBeNull();
    expect(await takePushNotification("https://push.test/angel")).toBeNull();
  });

  test("preserves delivery order and pending notices across subscription refresh", async () => {
    const endpoint = "https://push.test/device";
    await saveSubscription({ endpoint, user: "benny@example.com" });
    await queuePushNotification({ title: "First", url: "/?session=one" });
    await queuePushNotification({ title: "Second", url: "/?session=two" });
    await saveSubscription({ endpoint, user: "benny@example.com", keys: { auth: "refreshed" } });

    expect((await takePushNotification(endpoint))?.url).toBe("/?session=one");
    expect((await takePushNotification(endpoint))?.url).toBe("/?session=two");
    expect(await takePushNotification(endpoint)).toBeNull();
  });
});

const b64u = (b: Uint8Array) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A browser subscription with real keys, so payload delivery can be verified. */
async function browserSubscription(endpoint: string, user: string, appBaseUrl?: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const uaPrivateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  await saveSubscription({
    endpoint,
    user,
    keys: { p256dh: b64u(uaPublic), auth: b64u(authSecret) },
    appBaseUrl,
  });
  return { uaPublic, uaPrivateJwk, authSecret };
}

describe("delivery to a subscription on another origin", () => {
  const realFetch = globalThis.fetch;
  let sent: { url: string; headers: Record<string, string>; body: Uint8Array | null }[] = [];

  beforeEach(() => {
    sent = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[k] = v;
      }
      sent.push({
        url: String(input),
        headers,
        body: init?.body ? new Uint8Array(init.body as ArrayBuffer) : null,
      });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("encrypts the notice into the push so no callback to this box is needed", async () => {
    const keys = await browserSubscription("https://push.test/device", "benny@example.com");

    await notifyAll({
      user: "benny@example.com",
      notification: { title: "Shipped: Faster search", body: "Instant results.", tag: "shipped-1" },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].headers["Content-Encoding"]).toBe("aes128gcm");
    expect(sent[0].body).not.toBeNull();
    const decrypted = JSON.parse(
      await decryptPushPayload(sent[0].body!, keys.uaPrivateJwk, keys.uaPublic, keys.authSecret),
    );
    expect(decrypted.title).toBe("Shipped: Faster search");
    expect(decrypted.body).toBe("Instant results.");
  });

  test("makes deep links absolute against the surface the device subscribed from", async () => {
    const keys = await browserSubscription(
      "https://push.test/hosted",
      "benny@example.com",
      "https://app.omg.example",
    );

    await notifyAll({
      user: "benny@example.com",
      notification: { title: "Session finished", url: "/?session=abc" },
    });

    const decrypted = JSON.parse(
      await decryptPushPayload(sent[0].body!, keys.uaPrivateJwk, keys.uaPublic, keys.authSecret),
    );
    // A bare path would resolve against the RECEIVING worker's origin, which on
    // a hosted surface is not this box.
    expect(decrypted.url).toBe("https://app.omg.example/?session=abc");
  });

  test("does not queue for devices that received the payload, so nothing goes stale", async () => {
    await browserSubscription("https://push.test/modern", "benny@example.com");
    await saveSubscription({ endpoint: "https://push.test/legacy", user: "benny@example.com" });

    await notifyAll({
      user: "benny@example.com",
      notification: { title: "Session finished", url: "/?session=abc" },
    });

    // The keyless subscription still needs the fetch-back path...
    expect((await takePushNotification("https://push.test/legacy"))?.title).toBe(
      "Session finished",
    );
    // ...and the encrypted one must NOT hold a copy that a later wake-only push
    // would surface as if it were new.
    expect(await takePushNotification("https://push.test/modern")).toBeNull();
  });

  test("falls back to a wake-only push when a subscription has no keys", async () => {
    await saveSubscription({ endpoint: "https://push.test/legacy", user: "benny@example.com" });

    await notifyAll({ user: "benny@example.com", notification: { title: "Session finished" } });

    expect(sent[0].body).toBeNull();
    expect(sent[0].headers["Content-Length"]).toBe("0");
    expect(sent[0].headers["Content-Encoding"]).toBeUndefined();
  });

  test("records only an http(s) origin as the deep-link base", async () => {
    await saveSubscription({
      endpoint: "https://push.test/hostile",
      user: "benny@example.com",
      appBaseUrl: "javascript:alert(1)",
    });
    const [row] = await listSubscriptions();
    expect(row.appBaseUrl).toBeNull();
    expect(resolveNotificationUrl({ title: "x", url: "/?session=abc" }, null).url).toBe(
      "/?session=abc",
    );
  });
});
