import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  listNativeTokens,
  notifyNativeAll,
  removeNativeToken,
  saveNativeToken,
  toNativeAppUrl,
} from "./push-native.ts";
import { notifyAll, saveSubscription } from "./push.ts";

const realData = PATHS.data;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lfg-push-native-"));
  PATHS.data = dir;
});

afterEach(async () => {
  PATHS.data = realData;
  await rm(dir, { recursive: true, force: true });
});

describe("toNativeAppUrl", () => {
  test("maps a web session query to the native route", () => {
    expect(toNativeAppUrl("/?session=abc-123")).toBe("/session/abc-123");
  });

  test("passes an app-relative path through unchanged", () => {
    expect(toNativeAppUrl("/notifications")).toBe("/notifications");
  });

  test("defaults to the home route for anything empty or unparseable", () => {
    expect(toNativeAppUrl(undefined)).toBe("/");
    expect(toNativeAppUrl(null)).toBe("/");
  });
});

describe("token store", () => {
  test("register, refresh, and unregister round-trip", async () => {
    await saveNativeToken({ token: "ExponentPushToken[a]", user: "benny@example.com", platform: "ios" });
    expect(await listNativeTokens()).toHaveLength(1);

    // Re-registering the same token updates in place, not append.
    await saveNativeToken({ token: "ExponentPushToken[a]", user: "benny@example.com", platform: "ios" });
    expect(await listNativeTokens()).toHaveLength(1);

    await removeNativeToken("ExponentPushToken[a]");
    expect(await listNativeTokens()).toHaveLength(0);
  });

  /**
   * The token→user binding is the WHOLE privacy model on native (no
   * per-subscriber encryption key the way web has p256dh/auth): whoever a
   * token is bound to is whoever's items it can receive. The client is
   * expected to unregister on sign-out (see provider.tsx's signOut) so this
   * never happens in practice, but the store itself must not compound a
   * client bug into a cross-account leak: a token that reappears bound to a
   * new user must fully stop answering to the old one.
   */
  test("rebinding an existing token to a new user drops the old user's claim on it — no double delivery", async () => {
    await saveNativeToken({ token: "ExponentPushToken[shared-device]", user: "benny@example.com" });
    await saveNativeToken({ token: "ExponentPushToken[shared-device]", user: "angel@example.com" });

    const rows = await listNativeTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0].user).toBe("angel@example.com");
  });
});

describe("notifyNativeAll", () => {
  const realFetch = globalThis.fetch;
  let sent: { url: string; body: unknown }[] = [];
  let respond: () => Response = () => new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 });

  beforeEach(() => {
    sent = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      sent.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return respond();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("does nothing without a title — there is no payload-less wake path on native", async () => {
    await saveNativeToken({ token: "ExponentPushToken[a]", user: "benny@example.com" });
    await notifyNativeAll({ user: "benny@example.com", notification: { title: "" } });
    expect(sent).toHaveLength(0);
  });

  test("scopes delivery to the tagged user's devices only", async () => {
    await saveNativeToken({ token: "ExponentPushToken[benny]", user: "benny@example.com" });
    await saveNativeToken({ token: "ExponentPushToken[angel]", user: "angel@example.com" });

    await notifyNativeAll({
      user: "benny@example.com",
      notification: {
        title: "Should I force-push over the release branch in acme/payments?",
        body: "Should I force-push over the release branch in acme/payments?",
        url: "/?session=abc",
        tag: "ask-q1",
        project: "acme/payments",
      },
    });

    expect(sent).toHaveLength(1);
    const [message] = sent[0].body as Array<Record<string, unknown>>;
    expect(message.to).toBe("ExponentPushToken[benny]");
    expect((message.data as { url: string }).url).toBe("/session/abc");
  });

  test("never forwards the real title/body to Expo's relay — only a generic alert plus the project", async () => {
    await saveNativeToken({ token: "ExponentPushToken[benny]", user: "benny@example.com" });
    const privateQuestion = "Should I force-push over the release branch in acme/payments?";

    await notifyNativeAll({
      user: "benny@example.com",
      notification: {
        title: "omg needs your input",
        body: privateQuestion,
        url: "/?session=abc",
        tag: "ask-q1",
        project: "acme/payments",
        requireInteraction: true,
      },
    });

    const [message] = sent[0].body as Array<Record<string, unknown>>;
    expect(message.title).toBe("omg needs your input");
    expect(message.body).toBe("in acme/payments");
    expect(JSON.stringify(message)).not.toContain(privateQuestion);
  });

  test("without a project, the body says nothing at all — never falls back to the real text", async () => {
    await saveNativeToken({ token: "ExponentPushToken[benny]", user: "benny@example.com" });
    await notifyNativeAll({
      user: "benny@example.com",
      notification: { title: "omg found something", body: "Leaks the DB password in a log line", tag: "finding-f1" },
    });

    const [message] = sent[0].body as Array<Record<string, unknown>>;
    expect(message.title).toBe("omg found something");
    expect(message.body).toBeUndefined();
  });

  test("prunes a token Expo reports as DeviceNotRegistered", async () => {
    await saveNativeToken({ token: "ExponentPushToken[dead]", user: "benny@example.com" });
    respond = () =>
      new Response(
        JSON.stringify({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }),
        { status: 200 },
      );

    await notifyNativeAll({ user: "benny@example.com", notification: { title: "Session finished" } });

    expect(await listNativeTokens()).toHaveLength(0);
  });

  test("leaves a token in place for a non-registration error", async () => {
    await saveNativeToken({ token: "ExponentPushToken[rate-limited]", user: "benny@example.com" });
    respond = () =>
      new Response(JSON.stringify({ data: [{ status: "error", details: { error: "MessageRateExceeded" } }] }), {
        status: 200,
      });

    await notifyNativeAll({ user: "benny@example.com", notification: { title: "Session finished" } });

    expect(await listNativeTokens()).toHaveLength(1);
  });
});

describe("notifyAll fans out to native alongside web", () => {
  const realFetch = globalThis.fetch;
  let sent: string[] = [];

  beforeEach(() => {
    sent = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      sent.push(String(input));
      if (String(input).includes("exp.host")) {
        return new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 });
      }
      return new Response(null, { status: 201 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("a native-only user (no web subscription) still gets pushed", async () => {
    await saveNativeToken({ token: "ExponentPushToken[phone-only]", user: "benny@example.com" });
    // No web subscription saved at all — the old code path returned early on
    // an empty subscription list before native ever got a chance to run.
    await notifyAll({ user: "benny@example.com", notification: { title: "Session finished" } });
    expect(sent.some((u) => u.includes("exp.host"))).toBe(true);
  });

  test("both channels fire for a user with both a web and a native subscription", async () => {
    await saveSubscription({ endpoint: "https://push.test/benny", user: "benny@example.com" });
    await saveNativeToken({ token: "ExponentPushToken[benny]", user: "benny@example.com" });

    await notifyAll({ user: "benny@example.com", notification: { title: "Session finished" } });

    expect(sent.some((u) => u.includes("exp.host"))).toBe(true);
    expect(sent.some((u) => u.includes("push.test/benny"))).toBe(true);
  });
});
