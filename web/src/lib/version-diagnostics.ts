/**
 * Version diagnostics for Settings > Computer: what UI bundle is rendering,
 * and what runtime the selected Computer is actually executing.
 *
 * Kept as pure functions so every honest-but-awkward state (older runtime that
 * reports no version, offline box, a cached number that belongs to the machine
 * you just switched away from) is testable without mounting Settings.
 *
 * THE ONE RULE: the two numbers come from two independent sources and must
 * never be derived from each other. The frontend value is stamped into this
 * bundle at build time; the Computer value only ever comes from a real response
 * from that Computer. Defaulting either to the other would turn this screen —
 * whose entire job is to reveal a skew — into a mirror that always agrees.
 */

/**
 * Build-time stamp, injected by `define` in web/vite.config.ts (standalone
 * bundle) and web/vite.lib.config.ts (the @omg-dev/app library bundle the
 * hosted app.omg.dev pins as a release tarball).
 *
 * Both configs read the ROOT package.json, not web/package.json. That is
 * deliberate: scripts/pack-packages.sh rewrites every published manifest's
 * version to the root version at pack time ("versioned in lockstep off the root
 * package.json"), so the root number is what a released @omg-dev/app tarball
 * actually ships as. web/package.json's own version is never published and
 * drifts freely — stamping it would print a number that matches nothing.
 */
declare const __OMG_FRONTEND_VERSION__: string | undefined;

/**
 * A version we are willing to show, or null.
 *
 * `"unknown"` is rejected on purpose rather than passed through: that is the
 * literal string src/config.ts's appVersion() returns when it cannot read
 * package.json, and rendering "vunknown" would look like a version rather than
 * like the failure it is.
 */
export function normalizeVersion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^v/i, "");
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "unknown") return null;
  return trimmed;
}

/**
 * The version of the bundle currently executing, or null when this bundle was
 * built by something that did not stamp it (a bare `tsc`, a test run, or a
 * downstream bundler that re-built our source without the define).
 *
 * Returning null rather than guessing is the point: an unstamped bundle must
 * read "Unavailable", not borrow the Computer's number.
 */
export function readStampedFrontendVersion(): string | null {
  // `typeof` on a never-declared identifier is safe (no ReferenceError), which
  // is what makes this survive a host bundler that skips the define entirely.
  return typeof __OMG_FRONTEND_VERSION__ === "string"
    ? normalizeVersion(__OMG_FRONTEND_VERSION__)
    : null;
}

export const FRONTEND_VERSION: string | null = readStampedFrontendVersion();

/** What we can honestly say about the selected Computer's runtime version. */
export type ComputerVersionState =
  /** No usable response from this Computer yet. */
  | { state: "loading" }
  /** The box is not reachable, so no claim about what it runs is defensible. */
  | { state: "disconnected" }
  /** It answered, but sent no version marker (an older runtime). */
  | { state: "unreported" }
  /** It told us, in its own response, what it is running. */
  | { state: "reported"; version: string };

export type ComputerVersionInput = {
  /** `version` from the most recent /api/bootstrap of the selected Computer. */
  reported: unknown;
  /** False until a bootstrap for the selected Computer has actually returned. */
  loaded: boolean;
  /** Live socket state, or null when it has not been established yet. */
  connection: "live" | "connecting" | "reconnecting" | "offline" | null;
  /**
   * True when `reported` was captured against a DIFFERENT transport than the
   * one now selected — i.e. the host switched Computers and this number
   * describes the previous machine. Showing it would be a straight lie, so it
   * is discarded rather than aged out.
   */
  stale?: boolean;
};

export function resolveComputerVersion(input: ComputerVersionInput): ComputerVersionState {
  // Offline outranks a cached value. We may well still hold the last number
  // that box reported, but "what is it running right now" is not answerable
  // while it is unreachable, and this row exists to be trusted.
  if (input.connection === "offline") return { state: "disconnected" };
  // A number belonging to the machine we just switched away from is worse than
  // no number, so it never survives into a render.
  if (input.stale) return { state: "loading" };
  if (!input.loaded) return { state: "loading" };
  const version = normalizeVersion(input.reported);
  return version ? { state: "reported", version } : { state: "unreported" };
}

/** Numeric release ordering, or null when either side is not `x.y.z`. */
export function compareVersions(a: string, b: string): number | null {
  const parse = (value: string): number[] | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i]! !== right[i]!) return left[i]! < right[i]! ? -1 : 1;
  }
  // Equal cores with different suffixes (0.2.10 vs 0.2.10-rc.1) are NOT the
  // same build, so they must not report as a match.
  return a.trim() === b.trim() ? 0 : null;
}

export type VersionRelation =
  /** Not enough information to compare — never rendered as agreement. */
  | "unknown"
  | "match"
  | "computer-older"
  | "computer-newer"
  /** They differ, but not in an orderable way. */
  | "differs";

export function versionRelation(
  frontend: string | null,
  computer: ComputerVersionState,
): VersionRelation {
  if (!frontend) return "unknown";
  if (computer.state !== "reported") return "unknown";
  if (frontend === computer.version) return "match";
  const order = compareVersions(computer.version, frontend);
  if (order === null) return "differs";
  if (order === 0) return "match";
  return order < 0 ? "computer-older" : "computer-newer";
}

export const VERSION_UNAVAILABLE_LABEL = "Unavailable";
export const VERSION_DISCONNECTED_LABEL = "Disconnected";

/** `v0.2.10`, or an honest word when there is no version to show. */
export function formatVersion(version: string | null): string {
  return version ? `v${version}` : VERSION_UNAVAILABLE_LABEL;
}

export function formatComputerVersion(state: ComputerVersionState): string {
  switch (state.state) {
    case "reported":
      return `v${state.version}`;
    case "disconnected":
      return VERSION_DISCONNECTED_LABEL;
    case "loading":
    case "unreported":
      return VERSION_UNAVAILABLE_LABEL;
  }
}

/** Only a real, orderable skew is worth a sentence. Silence otherwise. */
export function versionMismatchNote(relation: VersionRelation): string | null {
  switch (relation) {
    case "computer-older":
      return "This Computer runs an older omg.dev than this app. Update the Computer to match.";
    case "computer-newer":
      return "This Computer runs a newer omg.dev than this app. Reload to pick up the latest app.";
    case "differs":
      return "This app and this Computer are on different omg.dev builds.";
    case "match":
    case "unknown":
      return null;
  }
}

/** True only for a genuine, known disagreement — never for missing data. */
export function isVersionMismatch(relation: VersionRelation): boolean {
  return relation === "computer-older" || relation === "computer-newer" || relation === "differs";
}

/** The value the copy affordance should put on the clipboard, or null. */
export function copyableVersion(state: ComputerVersionState): string | null {
  return state.state === "reported" ? `v${state.version}` : null;
}
