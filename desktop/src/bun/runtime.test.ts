import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DESKTOP_RUNTIME_ORIGIN,
  runtimeIsReady,
  runtimeOrigin,
  waitForRuntime,
} from "./runtime";

describe("runtimeOrigin", () => {
  test("uses the fixed local omg.dev origin by default", () => {
    expect(runtimeOrigin({})).toBe(DEFAULT_DESKTOP_RUNTIME_ORIGIN);
  });

  test("accepts a local port override", () => {
    expect(runtimeOrigin({ OMG_PORT: "9876" })).toBe("http://127.0.0.1:9876");
    expect(runtimeOrigin({ OMG_DESKTOP_URL: "http://localhost:9000/" })).toBe(
      "http://localhost:9000",
    );
  });

  test("rejects a remote or authenticated origin", () => {
    expect(() => runtimeOrigin({ OMG_DESKTOP_URL: "https://omg.dev" })).toThrow(
      "HTTP loopback",
    );
    expect(() => runtimeOrigin({ OMG_DESKTOP_URL: "http://user@localhost:8766" })).toThrow(
      "only an origin",
    );
  });
});

describe("runtime readiness", () => {
  test("accepts only the omg.dev ready response", async () => {
    const readyFetch = async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://127.0.0.1:8766/api/install?ready=1");
      return Response.json({ bootId: "boot-123" });
    };
    const unrelatedFetch = async () => Response.json({ ok: true });

    expect(await runtimeIsReady(DEFAULT_DESKTOP_RUNTIME_ORIGIN, readyFetch)).toBe(true);
    expect(await runtimeIsReady(DEFAULT_DESKTOP_RUNTIME_ORIGIN, unrelatedFetch)).toBe(false);
  });

  test("keeps trying until the background service is ready", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return attempts < 3
        ? new Response("offline", { status: 503 })
        : Response.json({ bootId: "boot-456" });
    };

    expect(
      await waitForRuntime(DEFAULT_DESKTOP_RUNTIME_ORIGIN, {
        fetch: fetcher,
        intervalMs: 1,
      }),
    ).toBe(true);
    expect(attempts).toBe(3);
  });
});
