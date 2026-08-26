// The Computer's ports used to be compile-time constants, and a start on a box
// that already had something on one of them reported success anyway: Chrome
// could not bind its debugging port, `waitForPort` saw the OTHER process
// listening, and agents silently drove that browser instead of the one on the
// screen. These cover both halves of the fix -- refuse a taken port, and give
// an environment knob to move out of the way.

import { afterEach, describe, expect, test } from "bun:test";
import { busyPort, DEFAULT_DESKTOP, envPort } from "./desktop.ts";

const ENV_KEY = "OMG_COMPUTER_TEST_PORT";

afterEach(() => {
  delete process.env[ENV_KEY];
});

/** A listening server plus the ephemeral port it landed on. */
function listen(): { server: ReturnType<typeof Bun.serve>; port: number } {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = server.port;
  if (!port) throw new Error("Bun.serve gave no port to test against");
  return { server, port };
}

/**
 * A port nothing is listening on: bind an ephemeral one, then release it.
 *
 * Never leave a port in a config to its default here. The machine running
 * these tests may well be running a Computer, and then 5900 is genuinely busy
 * and every assertion below drifts onto it.
 */
function freePort(): number {
  const { server, port } = listen();
  server.stop(true);
  return port;
}

describe("envPort", () => {
  test("falls back when the variable is unset", () => {
    expect(envPort(ENV_KEY, 9222)).toBe(9222);
  });

  test("uses a valid port from the environment", () => {
    process.env[ENV_KEY] = "9280";
    expect(envPort(ENV_KEY, 9222)).toBe(9280);
  });

  test("falls back rather than throwing on unusable values", () => {
    // A typo in a systemd drop-in must not take the whole server down, and a
    // port of 0 or 70000 would fail far away from its cause.
    for (const bad of ["", "nope", "0", "-1", "70000", "9222.5"]) {
      process.env[ENV_KEY] = bad;
      expect(envPort(ENV_KEY, 9222)).toBe(9222);
    }
  });
});

describe("busyPort", () => {
  test("reports a port another process is already holding", async () => {
    const { server, port } = listen();
    try {
      expect(await busyPort({ ...DEFAULT_DESKTOP, rfbPort: freePort(), cdpPort: port })).toBe(port);
      expect(await busyPort({ ...DEFAULT_DESKTOP, rfbPort: port, cdpPort: freePort() })).toBe(port);
    } finally {
      server.stop(true);
    }
  });

  test("reports the rfb port first, so the error names the one hit first", async () => {
    const a = listen();
    const b = listen();
    try {
      const config = { ...DEFAULT_DESKTOP, rfbPort: a.port, cdpPort: b.port };
      expect(await busyPort(config)).toBe(a.port);
    } finally {
      a.server.stop(true);
      b.server.stop(true);
    }
  });

  test("returns null when both ports are free", async () => {
    expect(
      await busyPort({ ...DEFAULT_DESKTOP, rfbPort: freePort(), cdpPort: freePort() }),
    ).toBeNull();
  });
});
