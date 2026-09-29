import { describe, expect, test } from "bun:test";
import { tailnetGateResponse, tailnetPortFromEnv } from "./tailnet-gate.ts";

const options = { boxId: "62494ca7-db41-4e88-8820-fa938e863795", webOrigin: "https://omg.dev" };
const base = "http://127.0.0.1:8767";

function req(path: string, init: RequestInit = {}) {
  return new Request(`${base}${path}`, init);
}

describe("tailnet gate", () => {
  test("API requests get 401", async () => {
    for (const path of ["/api/sessions", "/api/sessions/new", "/api/ask?status=open", "/api"]) {
      const res = tailnetGateResponse(req(path), options);
      expect(res?.status).toBe(401);
      expect(((await res!.json()) as { error: string }).error).toBe("sign-in required");
    }
    const post = tailnetGateResponse(req("/api/sessions/new", { method: "POST", body: "{}" }), options);
    expect(post?.status).toBe(401);
  });

  test("an API request that claims to want HTML still gets 401", () => {
    const res = tailnetGateResponse(req("/api/sessions", { headers: { accept: "text/html" } }), options);
    expect(res?.status).toBe(401);
  });

  test("websocket upgrades get 401", () => {
    const res = tailnetGateResponse(req("/", { headers: { upgrade: "websocket" } }), options);
    expect(res?.status).toBe(401);
  });

  test("a session link redirects to the signed-in omg web app", () => {
    const res = tailnetGateResponse(req("/?session=2441ab1f-c38c-4790-bcfa-80c6efb1593b"), options);
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe(
      "https://omg.dev/computers/62494ca7-db41-4e88-8820-fa938e863795/sessions/2441ab1f-c38c-4790-bcfa-80c6efb1593b",
    );
  });

  test("the root redirects to the computer, and a bad session id is dropped", () => {
    expect(tailnetGateResponse(req("/"), options)?.headers.get("location")).toBe(
      "https://omg.dev/computers/62494ca7-db41-4e88-8820-fa938e863795",
    );
    expect(tailnetGateResponse(req("/?session=../../x"), options)?.headers.get("location")).toBe(
      "https://omg.dev/computers/62494ca7-db41-4e88-8820-fa938e863795",
    );
  });

  test("assets get 401, not the app", () => {
    expect(tailnetGateResponse(req("/assets/index.js"), options)?.status).toBe(401);
  });

  test("an unpaired box has no redirect target and answers 401", () => {
    expect(tailnetGateResponse(req("/"), { ...options, boxId: null })?.status).toBe(401);
  });

  test("the connector OAuth callback GET passes through; its POST does not", () => {
    expect(tailnetGateResponse(req("/api/connectors/oauth/callback?code=a&state=b"), options)).toBeNull();
    expect(tailnetGateResponse(req("/api/connectors/oauth/callback", { method: "POST" }), options)?.status).toBe(401);
  });

  test("LFG_TAILNET_PORT parsing", () => {
    expect(tailnetPortFromEnv(undefined, 8766)).toBe(0);
    expect(tailnetPortFromEnv("", 8766)).toBe(0);
    expect(tailnetPortFromEnv("8767", 8766)).toBe(8767);
    expect(() => tailnetPortFromEnv("8766", 8766)).toThrow();
    expect(() => tailnetPortFromEnv("abc", 8766)).toThrow();
  });
});
