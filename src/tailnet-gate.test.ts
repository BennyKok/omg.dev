import { describe, expect, test } from "bun:test";
import { tailnetGateResponse, tailnetPortFromEnv } from "./tailnet-gate.ts";

const base = "http://127.0.0.1:8767";

function req(path: string, init: RequestInit = {}) {
  return new Request(`${base}${path}`, init);
}

describe("tailnet gate", () => {
  test("API requests get 401", async () => {
    for (const path of ["/api/sessions", "/api/sessions/new", "/api/ask?status=open", "/api"]) {
      const res = tailnetGateResponse(req(path));
      expect(res?.status).toBe(401);
      expect(((await res!.json()) as { error: string }).error).toBe("sign-in required");
    }
    const post = tailnetGateResponse(req("/api/sessions/new", { method: "POST", body: "{}" }));
    expect(post?.status).toBe(401);
  });

  test("an API request that claims to want HTML still gets 401", () => {
    const res = tailnetGateResponse(req("/api/sessions", { headers: { accept: "text/html" } }));
    expect(res?.status).toBe(401);
  });

  test("websocket upgrades get 401", () => {
    const res = tailnetGateResponse(req("/", { headers: { upgrade: "websocket" } }));
    expect(res?.status).toBe(401);
  });

  test("page loads get 401; nothing redirects off this computer", () => {
    for (const path of ["/", "/?session=2441ab1f-c38c-4790-bcfa-80c6efb1593b", "/index.html"]) {
      const res = tailnetGateResponse(req(path, { headers: { accept: "text/html" } }));
      expect(res?.status).toBe(401);
      expect(res?.headers.get("location")).toBeNull();
    }
  });

  test("assets get 401, not the app", () => {
    expect(tailnetGateResponse(req("/assets/index.js"))?.status).toBe(401);
  });

  test("the connector OAuth callback GET passes through; its POST does not", () => {
    expect(tailnetGateResponse(req("/api/connectors/oauth/callback?code=a&state=b"))).toBeNull();
    expect(tailnetGateResponse(req("/api/connectors/oauth/callback", { method: "POST" }))?.status).toBe(401);
  });

  test("allows requests bearing the matching peerToken via Authorization or WebSocket subprotocol", () => {
    const token = "omg_peer_secret1234567890";
    expect(
      tailnetGateResponse(
        req("/api/sessions", { headers: { authorization: `Bearer ${token}` } }),
        { peerToken: token },
      ),
    ).toBeNull();
    expect(
      tailnetGateResponse(
        req("/api/live/ws", {
          headers: { upgrade: "websocket", "sec-websocket-protocol": `lfg-bearer.${token}` },
        }),
        { peerToken: token },
      ),
    ).toBeNull();
    expect(
      tailnetGateResponse(
        req("/api/sessions", { headers: { authorization: "Bearer wrong_token_value_12345" } }),
        { peerToken: token },
      )?.status,
    ).toBe(401);
  });

  test("rejects every peer request while inbound access is off (null token)", () => {
    const token = "omg_peer_secret1234567890";
    expect(
      tailnetGateResponse(req("/api/sessions", { headers: { authorization: `Bearer ${token}` } }), { peerToken: null })
        ?.status,
    ).toBe(401);
  });

  test("a peer token cannot reach link management or the onward proxy", () => {
    const token = "omg_peer_secret1234567890";
    const auth = { headers: { authorization: `Bearer ${token}` } };
    for (const path of ["/api/peers", "/api/peers/token", "/api/peers/inbound", "/api/peers/machines/peer-1/api/sessions"]) {
      expect(tailnetGateResponse(req(path, auth), { peerToken: token })?.status).toBe(403);
    }
  });

  test("LFG_TAILNET_PORT parsing", () => {
    expect(tailnetPortFromEnv(undefined, 8766)).toBe(0);
    expect(tailnetPortFromEnv("", 8766)).toBe(0);
    expect(tailnetPortFromEnv("8767", 8766)).toBe(8767);
    expect(() => tailnetPortFromEnv("8766", 8766)).toThrow();
    expect(() => tailnetPortFromEnv("abc", 8766)).toThrow();
  });
});

describe("tailnet people (Tailscale identity)", () => {
  const { tailnetIdentityFromEnv, tailnetPerson, tailnetPersonOf } = require("./tailnet-gate.ts") as typeof import("./tailnet-gate.ts");
  const roster = new Set(["benny@example.com", "angel@example.com"]);
  const people = { enabled: true, isMember: (login: string) => roster.has(login) };
  const as = (login: string, extra: Record<string, string> = {}) =>
    req("/api/sessions", { headers: { "Tailscale-User-Login": login, ...extra } });

  test("off by default: a login on the list still gets 401, and the switch needs an explicit value", () => {
    expect(tailnetGateResponse(as("benny@example.com"))?.status).toBe(401);
    expect(tailnetGateResponse(as("benny@example.com"), { people: { ...people, enabled: false } })?.status).toBe(401);
    for (const raw of [undefined, "", "0", "false", "yes", "on"]) expect(tailnetIdentityFromEnv(raw)).toBe(false);
    for (const raw of ["1", "true", " TRUE "]) expect(tailnetIdentityFromEnv(raw)).toBe(true);
  });

  test("a person on the user list passes, and the request is theirs", () => {
    const request = as("Benny@Example.com", { "Tailscale-User-Name": "Benny%20Kok", "Tailscale-User-Profile-Pic": "https://pics.example/b.png" });
    expect(tailnetGateResponse(request, { people })).toBeNull();
    expect(tailnetPersonOf(request)).toEqual({ login: "benny@example.com", name: "Benny Kok", picture: "https://pics.example/b.png" });
  });

  test("a tailnet login that the owner has not added gets 403, with no data and no identity", async () => {
    const request = as("stranger@example.com");
    const res = tailnetGateResponse(request, { people });
    expect(res?.status).toBe(403);
    expect(((await res!.json()) as { error: string }).error).toBe("not on this computer's user list");
    expect(tailnetPersonOf(request)).toBeNull();
  });

  test("no login means no person: a tagged device or a Funnel visitor gets 401", () => {
    expect(tailnetGateResponse(req("/api/sessions"), { people })?.status).toBe(401);
    for (const login of ["", "   ", "not-an-address", "a@b@c", "x y@example.com", `"benny@example.com"`, "benny@example.com,angel@example.com"]) {
      expect(tailnetPerson(as(login))).toBeNull();
      expect(tailnetGateResponse(as(login), { people })?.status).toBe(401);
    }
  });

  test("identity cannot be claimed by any other header or by the query string", () => {
    for (const request of [
      req("/api/sessions?user=benny@example.com"),
      req("/api/sessions", { headers: { "X-Forwarded-User": "benny@example.com", "X-Omg-Tailnet-User": "benny@example.com" } }),
    ]) {
      expect(tailnetGateResponse(request, { people })?.status).toBe(401);
      expect(tailnetPersonOf(request)).toBeNull();
    }
    // A request that never went through the gate has no person, whatever it carries.
    expect(tailnetPersonOf(as("benny@example.com"))).toBeNull();
  });

  test("a picture that is not https is dropped, and a removed person loses access at once", () => {
    expect(tailnetPerson(as("angel@example.com", { "Tailscale-User-Profile-Pic": "javascript:alert(1)" }))?.picture).toBeNull();
    const live = new Set(roster);
    const options = { people: { enabled: true, isMember: (login: string) => live.has(login) } };
    expect(tailnetGateResponse(as("angel@example.com"), options)).toBeNull();
    live.delete("angel@example.com");
    expect(tailnetGateResponse(as("angel@example.com"), options)?.status).toBe(403);
  });
});
