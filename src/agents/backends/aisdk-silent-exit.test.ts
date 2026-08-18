// A brand-new install has no coding agent connected yet — that is the state
// every user starts in. On 2026-08-18 a user sent "hi" on a fresh box and the
// session sat on the thinking dots forever.
//
// The session was not slow. It was already dead: the harness had exited 1
// within a second, having printed NOTHING. No stdout, no stderr, no transcript
// row. Reproduced on a clean VM with no Claude installed:
//
//     $ bun src/agents/backends/aisdk-session.ts --session … -- hi
//     exit 1 signal undefined
//     STDOUT:
//     STDERR:
//
// The cause is a stream that ends without throwing. The Agent SDK cannot start
// its subprocess, so `for await (const msg of q)` finishes immediately, the
// `catch` never runs, and the loop fell to a bare `unexpectedExit = true` with
// no message attached. serve had nothing to report, so the UI kept spinning —
// a session list entry with launching:true and status:"ok" that never changed.
//
// The fix is not "handle missing auth". It is that this harness must never
// exit without saying why. These tests pin the explanation, especially the
// zero-message case that produced silence.
import { describe, expect, test } from "bun:test";
import { describeAisdkStreamEnd } from "./aisdk-session.ts";

describe("explaining a stream that ended", () => {
  // The exact fresh-install shape: nothing installed, nothing connected, and
  // not one message off the SDK.
  test("a stream that produced nothing names what is missing", () => {
    const line = describeAisdkStreamEnd({
      turns: 0,
      claudePath: null,
      accountConnected: false,
    });

    expect(line).toContain("Claude CLI is not installed");
    expect(line).toContain("no Claude account is connected");
    // Naming the cause is only half of it — the user needs the next action.
    expect(line).toContain("Settings");
    // The bug was silence; anything empty reintroduces it.
    expect(line.trim().length).toBeGreaterThan(0);
  });

  // Installed but not signed in: the other half of the same first-run wall.
  test("distinguishes an installed CLI with no account from a missing one", () => {
    const line = describeAisdkStreamEnd({
      turns: 0,
      claudePath: "/usr/local/bin/claude",
      accountConnected: false,
    });

    expect(line).toContain("no Claude account is connected");
    expect(line).not.toContain("not installed");
  });

  // A session that ran and then died is a different problem. Blaming auth
  // there would send the user to a settings page that is already correct.
  test("does not blame auth once the session has actually run", () => {
    const line = describeAisdkStreamEnd({
      turns: 42,
      claudePath: null,
      accountConnected: false,
    });

    expect(line).not.toContain("Settings");
    expect(line).not.toContain("not installed");
    expect(line).toContain("stopped unexpectedly");
  });

  test("carries the underlying error when there is one", () => {
    const line = describeAisdkStreamEnd({
      turns: 7,
      error: new Error("spawn ENOENT"),
      claudePath: "/usr/local/bin/claude",
      accountConnected: true,
    });
    expect(line).toContain("spawn ENOENT");
  });

  // An error on a stream that never produced anything still points at setup,
  // but must not swallow the detail — that detail is the whole diagnostic when
  // the cause is something we did not anticipate.
  test("keeps the error detail even when it also points at setup", () => {
    const line = describeAisdkStreamEnd({
      turns: 0,
      error: new Error("spawn /usr/local/bin/claude EACCES"),
      claudePath: "/usr/local/bin/claude",
      accountConnected: false,
    });
    expect(line).toContain("EACCES");
    expect(line).toContain("Settings");
  });

  // A fully configured box that still produces nothing is the case we cannot
  // name, and precisely the one where saying nothing is worst.
  test("still explains itself when everything looks configured", () => {
    const line = describeAisdkStreamEnd({
      turns: 0,
      claudePath: "/usr/local/bin/claude",
      accountConnected: true,
    });
    expect(line.trim().length).toBeGreaterThan(0);
    expect(line).toContain("before running a single turn");
    expect(line).toContain("Settings");
  });

  // The failure path is the worst possible place to throw: it would destroy
  // the diagnostic it exists to produce.
  test("never throws on junk input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeAisdkStreamEnd({ turns: 0, error: circular })).not.toThrow();
    expect(describeAisdkStreamEnd({ turns: 0, error: circular }).length).toBeGreaterThan(0);
  });
});
