import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { appVersion } from "../src/config.ts";

const CONFIG_SRC = readFileSync(join(import.meta.dir, "..", "src", "config.ts"), "utf8");

// Regression guard for a real incident, 2026-08-13: /api/bootstrap reported
// version 0.1.365 while the process was serving code from 36 minutes before
// that version existed. appVersion() re-read package.json on every call, so a
// checkout bumped by a release (or an `omg update`) made a server that had
// never restarted advertise code it was not running. Two shipped fixes read as
// deployed when neither was; the only reason it was caught is that the response
// payload still had the old shape.
//
// The invariant is narrow and easy to undo by accident — inlining the read back
// into the function looks like a harmless simplification — so it is pinned here
// rather than left to a comment.
describe("[unit] appVersion is the RUNNING version", () => {
  test("the read is bound to module load, not to the call", () => {
    // Bound at module scope: evaluated once, when the process imports config.
    expect(CONFIG_SRC).toMatch(/const RUNNING_VERSION = readVersionFromDisk\(\);/);

    // And appVersion itself must not touch the filesystem. A lazy
    // `if (!cached) cached = read()` memo would satisfy "reads once" while
    // reintroducing the bug: the first call can land AFTER a pull and cache a
    // version the process is not running.
    const start = CONFIG_SRC.indexOf("export function appVersion");
    expect(start, "expected an exported appVersion function").toBeGreaterThan(-1);
    const body = CONFIG_SRC.slice(start, CONFIG_SRC.indexOf("}", start) + 1);
    expect(body).not.toContain("readFileSync");
    expect(body).not.toContain("readVersionFromDisk");
  });

  test("it is stable across calls and non-empty", () => {
    const first = appVersion();
    expect(first).toBe(appVersion());
    expect(first.length).toBeGreaterThan(0);
  });
});
