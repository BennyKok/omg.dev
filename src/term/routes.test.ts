import { describe, expect, test } from "bun:test";
import { createTermRoutes, isTrustedTermRequest } from "./routes.ts";

const routes = createTermRoutes({
  sessionCwd: async () => null,
  host: { path: "/nonexistent/term.sock", spawn: false },
  allowedOrigins: () => ["https://box.example.ts.net"],
});
const server = { upgrade: () => true } as never;

function req(path: string, headers: Record<string, string> = {}, method = "GET") {
  return new Request(`http://127.0.0.1:8766${path}`, { method, headers: { host: "127.0.0.1:8766", ...headers } });
}

describe("who may reach a shell", () => {
  const trusted = (headers: Record<string, string>) => isTrustedTermRequest(req("/api/term", headers), ["https://box.example.ts.net"]);

  test("the app's own page, and clients that are not browser pages", () => {
    expect(trusted({})).toBe(true);
    expect(trusted({ origin: "http://127.0.0.1:8766" })).toBe(true);
    expect(trusted({ origin: "https://box.example.ts.net" })).toBe(true);
  });

  test("a proxy that rewrites Host but forwards the browser's", () => {
    expect(trusted({ origin: "https://dev.example.ts.net", "x-forwarded-host": "dev.example.ts.net" })).toBe(true);
    expect(trusted({ origin: "http://127.0.0.1:5174" })).toBe(true); // Vite dev on this machine
    expect(trusted({ origin: "http://localhost:5174" })).toBe(true);
  });

  test("any other site is refused", () => {
    expect(trusted({ origin: "https://evil.example" })).toBe(false);
    expect(trusted({ origin: "http://127.0.0.1.evil.example" })).toBe(false);
    expect(trusted({ origin: "null" })).toBe(false);
    expect(trusted({ origin: "file://" })).toBe(false);
    expect(trusted({ origin: "https://evil.example", "x-forwarded-host": "box.example.ts.net" })).toBe(false);
    // A loopback page is not trusted by a server reached under another name.
    expect(isTrustedTermRequest(req("/", { host: "box.example.ts.net", origin: "http://localhost:3000" }))).toBe(false);
    // Fetch metadata, where the browser sends it.
    expect(trusted({ origin: "http://127.0.0.1:8766", "sec-fetch-site": "cross-site" })).toBe(false);
  });
});

describe("terminal routes", () => {
  test("another site cannot open a shell, list shells or close one", async () => {
    for (const [path, method] of [
      ["/api/term?session=main", "GET"],
      ["/api/term/kill?session=main", "POST"],
      ["/api/term/list?session=main", "GET"],
      ["/api/term/scan?session=main", "GET"],
    ] as const) {
      const r = req(path, { origin: "https://evil.example" }, method);
      expect((await routes.handle(r, new URL(r.url), server))?.status).toBe(403);
    }
  });

  test("the app's own socket request is upgraded", async () => {
    const r = req("/api/term?session=main&cols=80&rows=24", { origin: "http://127.0.0.1:8766" });
    expect(await routes.handle(r, new URL(r.url), server)).toBeUndefined();
  });

  test("ids the protocol refuses are a 400, not another shell", async () => {
    const r = req("/api/term?session=../x");
    expect((await routes.handle(r, new URL(r.url), server))?.status).toBe(400);
  });

  test("other paths are not handled", async () => {
    const r = req("/api/terminal");
    expect(await routes.handle(r, new URL(r.url), server)).toBeNull();
  });
});
