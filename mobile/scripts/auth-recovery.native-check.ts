import { afterEach, expect, test } from "bun:test";
import { clearAuthToken, getAuthToken, subscribeSessionExpired, withAccountToken } from "../src/omg/auth";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; clearAuthToken(); });

test("a rejected cached JWT refreshes once before retrying", async () => {
  let mints = 0;
  globalThis.fetch = (async () => Response.json({ token: `jwt-${++mints}` })) as typeof fetch;
  await getAuthToken();
  const used: string[] = [];
  const result = await withAccountToken(async token => {
    used.push(token);
    return new Response(null, { status: token === "jwt-1" ? 401 : 200 });
  }, response => response.status === 401);
  expect(result.status).toBe(200);
  expect(used).toEqual(["jwt-1", "jwt-2"]);
  expect(mints).toBe(2);
});

test("confirmed expiry notifies the provider and subscriptions can detach", async () => {
  let expired = 0;
  const stop = subscribeSessionExpired(() => expired++);
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
  try {
    await expect(withAccountToken(async () => new Response(), () => false)).rejects.toThrow("Please sign in again.");
    expect(expired).toBe(1);
  } finally { stop(); }
  await getAuthToken();
  expect(expired).toBe(1);
});

test("network and server errors never declare the account expired", async () => {
  let expired = 0;
  const stop = subscribeSessionExpired(() => expired++);
  try {
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    await expect(getAuthToken()).rejects.toThrow("Check your connection");
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    await expect(getAuthToken()).rejects.toThrow("503");
    expect(expired).toBe(0);
  } finally { stop(); }
});

test("a forbidden computer does not refresh the account JWT", async () => {
  let mints = 0;
  globalThis.fetch = (async () => { mints++; return Response.json({ token: "jwt" }); }) as typeof fetch;
  const result = await withAccountToken(async () => new Response(null, { status: 403 }), r => r.status === 401);
  expect(result.status).toBe(403);
  expect(mints).toBe(1);
});

test("persistent downstream 401 is bounded and does not claim account expiry", async () => {
  let requests = 0, expired = 0;
  const stop = subscribeSessionExpired(() => expired++);
  globalThis.fetch = (async () => Response.json({ token: "valid-account" })) as typeof fetch;
  try {
    const result = await withAccountToken(async () => { requests++; return new Response(null, { status: 401 }); }, r => r.status === 401);
    expect(result.status).toBe(401);
    expect(requests).toBe(2);
    expect(expired).toBe(0);
  } finally { stop(); }
});

test("concurrent rejected requests share one token refresh", async () => {
  let mints = 0;
  globalThis.fetch = (async () => Response.json({ token: `jwt-${++mints}` })) as typeof fetch;
  await getAuthToken();
  const request = () => withAccountToken(async token => new Response(null, {
    status: token === "jwt-1" ? 401 : 200,
  }), r => r.status === 401);
  const responses = await Promise.all([request(), request(), request()]);
  expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
  expect(mints).toBe(2);
});
