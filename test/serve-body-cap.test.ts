import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const serveSource = readFileSync(new URL("../src/commands/serve.ts", import.meta.url), "utf8");

describe("request body ceiling", () => {
  // Found by an independent verifier: a 20 MiB JSON body was accepted and cost
  // ~22 MB of RSS, and nothing stopped a much larger one. This API has no
  // application-layer auth and is reachable through the relay, so a caller
  // choosing not to send one is not a control.
  //
  // Capped once at Bun.serve rather than in each of the ~58 handlers that call
  // req.json() — one owner, and a new route cannot forget it.
  test("is set on the server, not per route", () => {
    expect(serveSource).toContain("maxRequestBodySize: MAX_REQUEST_BODY_BYTES");
    expect(serveSource).toMatch(/MAX_REQUEST_BODY_BYTES = \d+ \* 1024 \* 1024/);
  });

  test("leaves room for the uploads that legitimately pass through", () => {
    const [, mib] = serveSource.match(/MAX_REQUEST_BODY_BYTES = (\d+) \* 1024 \* 1024/) ?? [];
    // Artifact images and videos post through this same server, so a tight
    // limit would break them. Bounded, not minimal.
    expect(Number(mib)).toBeGreaterThanOrEqual(16);
    expect(Number(mib)).toBeLessThanOrEqual(64);
  });
});
