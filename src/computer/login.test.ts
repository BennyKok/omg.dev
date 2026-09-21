import { beforeEach, expect, test } from "bun:test";
import { createBrowserLoginService, validateLoginCookies } from "./login";
import { transferBrowserLogin } from "./browser";

const cookie = { name: "session", value: "secret-login", domain: ".example.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax" };
let now: number;
let imported: unknown[];
let handle: ReturnType<typeof createBrowserLoginService>;
beforeEach(() => {
  now = Date.now(); imported = [];
  handle = createBrowserLoginService({
    session: async id => id === "a" || id === "native-a" ? { id: "a", owner: "a@example.com" } : id === "b" ? { id: "b", owner: "b@example.com" } : null,
    viewer: req => req.headers.get("x-omg-viewer-email") ?? new URL(req.url).searchParams.get("user") ?? "",
    available: () => true, now: () => now,
    importCookies: async (url, cookies) => { imported.push({ url, cookies: structuredClone(cookies) }); },
    completed: async () => true,
  });
});
async function call(action = "", body?: unknown, user = "a@example.com", session = "a", agent = false) {
  const response = await handle(new Request(`http://localhost/api/browser-login${action}?sessionId=${session}&user=b@example.com`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-omg-viewer-email": user, ...(agent ? { "x-omg-caller-session-id": session } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
  return { status: response.status, data: await response.json() as any };
}
async function request() { return (await call("", { url: "https://www.example.com/account", reason: "Read the account dashboard" }, "", "a", true)).data.request; }

test("agent request, native claim, approved import, and status share one request", async () => {
  const row = await request();
  const claim = await call(`/${row.id}/claim`, {});
  expect(claim.status).toBe(200);
  const complete = await call(`/${row.id}/complete`, { token: claim.data.token, approved: true, cookies: [cookie] });
  expect(complete.data.request.status).toBe("imported");
  expect(complete.data.request.agentNotified).toBe(true);
  expect(imported).toEqual([{ url: row.url, cookies: [cookie] }]);
  const status = await call("", undefined, "", "native-a", true);
  expect(status.data.requests[0].status).toBe("imported");
  expect(JSON.stringify(status.data)).not.toContain(cookie.value);
  expect(JSON.stringify(status.data)).not.toContain(claim.data.token);
  expect((await call(`/${row.id}/complete`, { token: claim.data.token, approved: true, cookies: [cookie] })).status).toBe(409);
  expect(imported).toHaveLength(1);
});

test("verified viewer wins over query identity and wrong users cannot see or claim", async () => {
  const row = await request();
  expect((await call()).status).toBe(200);
  expect((await call("", undefined, "b@example.com")).status).toBe(403);
  expect((await call(`/${row.id}/claim`, {}, "b@example.com")).status).toBe(403);
  expect((await call(`/${row.id}`, undefined, "b@example.com", "b")).status).toBe(404);
});

test("agents can request but cannot approve or announce device capability", async () => {
  const row = await request();
  expect((await call(`/${row.id}/claim`, {}, "", "a", true)).status).toBe(403);
  expect((await call("/clients", { clientId: "phone", supported: true }, "", "a", true)).status).toBe(403);
});

test("presence is per session and expires", async () => {
  await call("/clients", { clientId: "phone", supported: true });
  expect((await call()).data.iosAvailable).toBe(true);
  expect((await call("", undefined, "b@example.com", "b")).data.iosAvailable).toBe(false);
  now += 46_000;
  expect((await call()).data.iosAvailable).toBe(false);
});

test("duplicate requests reuse the open request; cancellation and expiry prevent import", async () => {
  const row = await request();
  expect((await request()).id).toBe(row.id);
  await call(`/${row.id}/cancel`, {});
  expect((await call(`/${row.id}/claim`, {})).status).toBe(409);
  const second = await request();
  expect(second.id).not.toBe(row.id);
  now += 601_000;
  expect((await call(`/${second.id}/claim`, {})).status).toBe(409);
  expect(imported).toHaveLength(0);
});

test("a competing claim and unapproved transfer cannot consume the request", async () => {
  const row = await request();
  const claim = await call(`/${row.id}/claim`, {});
  expect((await call(`/${row.id}/claim`, {})).status).toBe(409);
  expect((await call(`/${row.id}/complete`, { cookies: [cookie], approved: true, token: "wrong" })).status).toBe(403);
  expect((await call(`/${row.id}/complete`, { cookies: [cookie], token: claim.data.token })).status).toBe(403);
  expect(imported).toHaveLength(0);
});

for (const domain of [".com", ".co.uk", ".evil.com", "www.example.com.evil.com", "other.example.com"]) {
  test(`rejects out-of-scope cookie ${domain}`, () => {
    expect(() => validateLoginCookies([{ ...cookie, domain }], "https://www.example.com")).toThrow();
  });
}
test("private suffixes cannot capture another tenant", () => {
  expect(() => validateLoginCookies([{ ...cookie, domain: ".github.io" }], "https://my.github.io")).toThrow();
});
test("expired cookies and invalid SameSite fail before any import", () => {
  expect(() => validateLoginCookies([{ ...cookie, expires: 1 }], "https://www.example.com")).toThrow();
  expect(() => validateLoginCookies([{ ...cookie, sameSite: "invalid" }], "https://www.example.com")).toThrow();
});
test("HTTPS and credential-free request URLs are required", async () => {
  for (const url of ["http://example.com", "https://user:pass@example.com", "file:///etc/passwd", "https://127.0.0.1"]) {
    expect((await call("", { url, reason: "Sign in" })).status).toBe(400);
  }
});
test("CDP import preserves host-only, domain, HttpOnly and SameSite fields", async () => {
  const calls: unknown[] = [];
  await transferBrowserLogin({
    navigate: async url => { calls.push(url); },
    cdp: async (method, params) => {
      calls.push({ method, params });
      if (method === "Network.getCookies") return { cookies: [cookie, { ...cookie, name: "__Host-session", domain: "www.example.com" }] };
    },
  }, "https://www.example.com/account", [cookie as any, { ...cookie, name: "__Host-session", domain: "www.example.com" } as any]);
  expect(calls).toEqual(["about:blank", { method: "Network.setCookies", params: { cookies: [cookie, {
    name: "__Host-session", value: cookie.value, path: "/", secure: true, httpOnly: true, sameSite: "Lax", url: "https://www.example.com/",
  }] } }, { method: "Network.getCookies", params: { urls: ["https://www.example.com/"] } }, "https://www.example.com/account"]);
});

test("import failures return a safe message without exposing credentials", async () => {
  handle = createBrowserLoginService({
    session: async id => ({ id, owner: "a@example.com" }), viewer: () => "a@example.com", available: () => true,
    importCookies: async () => { throw new Error(`CDP rejected ${cookie.value}`); },
  });
  const row = await request();
  const claim = await call(`/${row.id}/claim`, {});
  const result = await call(`/${row.id}/complete`, { approved: true, token: claim.data.token, cookies: [cookie] });
  expect(result.data.request.status).toBe("failed");
  expect(JSON.stringify(result)).not.toContain(cookie.value);
  expect((await call(`/${row.id}/complete`, { approved: true, token: claim.data.token, cookies: [cookie] })).status).toBe(409);
});

test("an in-flight transfer cannot be replayed or cancelled", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  handle = createBrowserLoginService({
    session: async id => ({ id, owner: "a@example.com" }), viewer: () => "a@example.com", available: () => true,
    importCookies: async () => { await pending; },
  });
  const row = await request();
  const claim = await call(`/${row.id}/claim`, {});
  const body = { approved: true, token: claim.data.token, cookies: [cookie] };
  const transfer = call(`/${row.id}/complete`, body);
  // Let the handler enter its async importer.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect((await call(`/${row.id}/complete`, body)).status).toBe(409);
  expect((await call(`/${row.id}/cancel`, {})).status).toBe(409);
  finish();
  expect((await transfer).data.request.status).toBe("imported");
});


test("iOS insecure SameSite=None cookies use the browser default without dropping secure None", async () => {
  const plain = { ...cookie, name: "plain", secure: false, sameSite: "None" as const };
  const secure = { ...cookie, sameSite: "None" as const };
  let sent: any;
  await transferBrowserLogin({
    navigate: async () => {},
    cdp: async (method, params) => {
      if (method === "Network.setCookies") sent = params;
      if (method === "Network.getCookies") return { cookies: [plain, secure] };
    },
  }, "https://www.example.com/account", [plain, secure]);
  expect(sent.cookies[0]).not.toHaveProperty("sameSite");
  expect(sent.cookies[0].secure).toBe(false);
  expect(sent.cookies[1].sameSite).toBe("None");
});

test("silent cookie rejection or an old value fails before opening the protected page", async () => {
  for (const stored of [[], [{ ...cookie, value: "old-session" }]]) {
    const navigations: string[] = [];
    await expect(transferBrowserLogin({
      navigate: async url => { navigations.push(url); },
      cdp: async method => method === "Network.getCookies" ? { cookies: stored } : {},
    }, "https://www.example.com/account", [cookie as any])).rejects.toThrow("did not retain every login cookie");
    expect(navigations).toEqual(["about:blank"]);
  }
});
