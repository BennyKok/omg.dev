import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  copyableVersion,
  formatComputerVersion,
  formatVersion,
  isVersionMismatch,
  normalizeVersion,
  readStampedFrontendVersion,
  resolveComputerVersion,
  versionMismatchNote,
  versionRelation,
  VERSION_DISCONNECTED_LABEL,
  VERSION_UNAVAILABLE_LABEL,
  type ComputerVersionState,
} from "./version-diagnostics.ts";

const reported = (version: string): ComputerVersionState => ({ state: "reported", version });

describe("normalizeVersion", () => {
  test("accepts a plain release version and tolerates a v prefix", () => {
    expect(normalizeVersion("0.2.10")).toBe("0.2.10");
    expect(normalizeVersion("v0.2.10")).toBe("0.2.10");
    expect(normalizeVersion("  0.2.10  ")).toBe("0.2.10");
  });

  test("rejects the literal 'unknown' appVersion() emits when package.json is unreadable", () => {
    // src/config.ts returns this string on a failed read. Passing it through
    // would render "vunknown", which reads like a version instead of a failure.
    expect(normalizeVersion("unknown")).toBeNull();
    expect(normalizeVersion("UNKNOWN")).toBeNull();
  });

  test("rejects empty and non-string markers", () => {
    expect(normalizeVersion("")).toBeNull();
    expect(normalizeVersion("   ")).toBeNull();
    expect(normalizeVersion(undefined)).toBeNull();
    expect(normalizeVersion(null)).toBeNull();
    expect(normalizeVersion(42)).toBeNull();
    expect(normalizeVersion({ version: "0.2.10" })).toBeNull();
  });
});

describe("frontend bundle version", () => {
  test("standalone/hosted bundle reports the version its bundler stamped in", () => {
    // bun test does not apply Vite's `define`, so the identifier is undefined
    // here — which is exactly the unstamped case, and it must degrade to null
    // rather than throwing a ReferenceError or inventing a number.
    expect(readStampedFrontendVersion()).toBeNull();
  });

  test("an unstamped frontend renders Unavailable, never the Computer's number", () => {
    expect(formatVersion(null)).toBe(VERSION_UNAVAILABLE_LABEL);
    // The critical property: no borrowing across the two sources.
    expect(formatVersion(null)).not.toContain("0.2.10");
    expect(versionRelation(null, reported("0.2.10"))).toBe("unknown");
  });

  test("a stamped frontend renders its own value", () => {
    // Simulates both shipped paths: the standalone bundle built by
    // web/vite.config.ts and the @omg-dev/app library bundle that hosted
    // app.omg.dev pins as a release tarball. Both stamp the ROOT version.
    expect(formatVersion(normalizeVersion("0.2.11"))).toBe("v0.2.11");
  });
});

describe("resolveComputerVersion", () => {
  const base = { loaded: true, connection: "live" as const };

  test("a live box that reports its version is taken at its word", () => {
    expect(resolveComputerVersion({ ...base, reported: "0.2.10" })).toEqual(reported("0.2.10"));
  });

  test("missing server marker (older runtime) is 'unreported', not a guess", () => {
    // An LFG old enough to predate the bootstrap `version` field. The row must
    // say Unavailable rather than borrowing the frontend's number.
    expect(resolveComputerVersion({ ...base, reported: undefined })).toEqual({ state: "unreported" });
    expect(resolveComputerVersion({ ...base, reported: "" })).toEqual({ state: "unreported" });
    expect(resolveComputerVersion({ ...base, reported: "unknown" })).toEqual({ state: "unreported" });
    expect(formatComputerVersion({ state: "unreported" })).toBe(VERSION_UNAVAILABLE_LABEL);
  });

  test("an offline Computer reports Disconnected even though we still hold its last number", () => {
    // "What is it running right now" is not answerable while it is unreachable.
    const state = resolveComputerVersion({ ...base, reported: "0.2.10", connection: "offline" });
    expect(state).toEqual({ state: "disconnected" });
    expect(formatComputerVersion(state)).toBe(VERSION_DISCONNECTED_LABEL);
  });

  test("offline outranks staleness and missing markers alike", () => {
    expect(resolveComputerVersion({ reported: undefined, loaded: false, connection: "offline" }))
      .toEqual({ state: "disconnected" });
    expect(resolveComputerVersion({ reported: "0.2.9", loaded: true, connection: "offline", stale: true }))
      .toEqual({ state: "disconnected" });
  });

  test("a stale cached response from the previously selected Computer is discarded", () => {
    // The host swaps the transport in place to switch machines, so this value
    // belongs to the box we just left. Showing it under the new box's name
    // would be a straight lie, so it drops back to loading.
    const state = resolveComputerVersion({ ...base, reported: "0.1.99", stale: true });
    expect(state).toEqual({ state: "loading" });
    expect(formatComputerVersion(state)).toBe(VERSION_UNAVAILABLE_LABEL);
    expect(copyableVersion(state)).toBeNull();
  });

  test("before the first bootstrap returns there is no claim to make", () => {
    expect(resolveComputerVersion({ reported: undefined, loaded: false, connection: null }))
      .toEqual({ state: "loading" });
  });

  test("a reconnecting socket keeps the version that box actually reported", () => {
    // The socket dropping does not change what the runtime is executing, and
    // we do hold a genuine response from this same machine.
    expect(resolveComputerVersion({ ...base, reported: "0.2.10", connection: "reconnecting" }))
      .toEqual(reported("0.2.10"));
  });
});

describe("compareVersions", () => {
  test("orders release versions numerically, not lexically", () => {
    // The lexical trap: "0.2.9" > "0.2.10" as strings.
    expect(compareVersions("0.2.9", "0.2.10")).toBe(-1);
    expect(compareVersions("0.2.10", "0.2.9")).toBe(1);
    expect(compareVersions("0.2.10", "0.2.10")).toBe(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  test("unparsable versions compare to null rather than to an accidental order", () => {
    expect(compareVersions("main", "0.2.10")).toBeNull();
    expect(compareVersions("0.2", "0.2.10")).toBeNull();
  });

  test("equal cores with different prerelease suffixes are not the same build", () => {
    expect(compareVersions("0.2.10-rc.1", "0.2.10")).toBeNull();
  });
});

describe("versionRelation", () => {
  test("matching versions", () => {
    const relation = versionRelation("0.2.10", reported("0.2.10"));
    expect(relation).toBe("match");
    expect(isVersionMismatch(relation)).toBe(false);
    expect(versionMismatchNote(relation)).toBeNull();
  });

  test("mismatch: the Computer is behind the app", () => {
    const relation = versionRelation("0.2.11", reported("0.2.10"));
    expect(relation).toBe("computer-older");
    expect(isVersionMismatch(relation)).toBe(true);
    expect(versionMismatchNote(relation)).toContain("older");
  });

  test("mismatch: the Computer is ahead of the app", () => {
    const relation = versionRelation("0.2.10", reported("0.2.11"));
    expect(relation).toBe("computer-newer");
    expect(isVersionMismatch(relation)).toBe(true);
    expect(versionMismatchNote(relation)).toContain("newer");
  });

  test("a 9-to-10 skew is reported by number, not by string order", () => {
    expect(versionRelation("0.2.10", reported("0.2.9"))).toBe("computer-older");
  });

  test("unorderable disagreement still reads as a difference", () => {
    const relation = versionRelation("0.2.10", reported("0.2.10-rc.1"));
    expect(relation).toBe("differs");
    expect(isVersionMismatch(relation)).toBe(true);
  });

  test("missing data is never presented as agreement", () => {
    // Each of these once had a tempting "just show the version we know" fix.
    // All of them must stay 'unknown', and none may count as a mismatch.
    for (const state of [
      { state: "loading" },
      { state: "disconnected" },
      { state: "unreported" },
    ] satisfies ComputerVersionState[]) {
      expect(versionRelation("0.2.10", state)).toBe("unknown");
      expect(isVersionMismatch(versionRelation("0.2.10", state))).toBe(false);
      expect(versionMismatchNote(versionRelation("0.2.10", state))).toBeNull();
    }
    expect(versionRelation(null, reported("0.2.10"))).toBe("unknown");
    expect(versionRelation(null, { state: "unreported" })).toBe("unknown");
  });
});

describe("copy affordance", () => {
  test("only a real reported version is copyable", () => {
    expect(copyableVersion(reported("0.2.10"))).toBe("v0.2.10");
  });

  test("states are never put on the clipboard", () => {
    // Pasting "Unavailable" into a bug report is worse than pasting nothing.
    expect(copyableVersion({ state: "loading" })).toBeNull();
    expect(copyableVersion({ state: "disconnected" })).toBeNull();
    expect(copyableVersion({ state: "unreported" })).toBeNull();
  });
});

describe("rendered labels", () => {
  test("the happy path reads as the task specified", () => {
    expect(formatVersion("0.2.10")).toBe("v0.2.10");
    expect(formatComputerVersion(reported("0.2.10"))).toBe("v0.2.10");
  });

  test("no label leaks a path, host identifier, or command line", () => {
    const labels = [
      formatVersion(null),
      formatVersion("0.2.10"),
      formatComputerVersion({ state: "loading" }),
      formatComputerVersion({ state: "disconnected" }),
      formatComputerVersion({ state: "unreported" }),
      formatComputerVersion(reported("0.2.10")),
      ...(["computer-older", "computer-newer", "differs", "match", "unknown"] as const)
        .map((relation) => versionMismatchNote(relation) ?? ""),
    ];
    for (const label of labels) {
      expect(label).not.toMatch(/\//);
      expect(label).not.toMatch(/git |bun |npm |curl /);
      expect(label).not.toMatch(/localhost|127\.0\.0\.1|\.tail[0-9a-z]+\.ts\.net/);
    }
  });
});
