// Payload the Settings "omg.dev updates" row expects from /api/install.
//
// A 200 that is not this payload (SPA shell from a stale worker, an
// intermediary's empty body, HTML from a host proxy) is parsed to `{}` by the
// transport. The row used to store that and then read `info?.install.channel`.
// Optional chaining stops at `info`, so a missing `install` threw and took
// the whole router down. Reject anything that is not the real shape before
// it lands in state, and never read `.channel` without chaining through
// `install` as well.

export type InstallUpdateStatus = {
  channel: "source" | "release";
  /**
   * `staged` = an update is on disk but the running process predates it, so a
   * restart is the action, not a download. Distinct from `available`, where
   * nothing has been fetched yet.
   */
  state: "up-to-date" | "available" | "staged" | "blocked";
  currentSha?: string;
  latestSha?: string;
  commitsBehind?: number;
  /** The version actually running, never the one on disk. */
  currentVersion?: string;
  /** On-disk version, present only while it differs from the running one. */
  stagedVersion?: string;
  latestVersion?: string;
  latestTag?: string;
  message: string;
  restartSupported: boolean;
  /** Why the update button is disabled, when it is. Server-side diagnosis. */
  restartBlockedReason?: string;
};

export type ChangelogEntry = {
  version: string;
  date: string;
  headline: string;
  bodyMarkdown: string;
};

export type InstallUpdateInfo = {
  install: { channel: "source" | "release" | "container" | "unknown"; updateCommand: string };
  update: InstallUpdateStatus | null;
  /**
   * CHANGELOG entries newer than the installed release, newest first. Only
   * ever populated on the release channel; absent or empty otherwise — the
   * drawer degrades to naming the version when there is nothing to render.
   */
  changelog?: ChangelogEntry[];
  restarting?: boolean;
  bootId: string;
};

export function isInstallUpdateInfo(value: unknown): value is InstallUpdateInfo {
  if (!value || typeof value !== "object") return false;
  const install = (value as { install?: unknown }).install;
  if (!install || typeof install !== "object") return false;
  const rec = install as { channel?: unknown; updateCommand?: unknown };
  return typeof rec.channel === "string" && typeof rec.updateCommand === "string";
}

/** The opaque "version" an available update is identified by, for skip persistence. */
export function updateIdentifier(status: InstallUpdateStatus | null | undefined): string | null {
  if (!status) return null;
  if (status.state === "available") {
    return status.latestVersion ?? status.latestTag ?? status.latestSha ?? null;
  }
  // A staged update is still something to tell the reader about: the bits are
  // on disk and the box is running older code until it restarts. Without this
  // the nudge went quiet at exactly the moment there was something to do.
  //
  // Namespaced so it is a DIFFERENT id from the same version while it was
  // merely available. Skipping the download must not also silence the restart
  // that download turned out to need.
  if (status.state === "staged") {
    const version = status.stagedVersion ?? status.latestVersion ?? status.latestTag;
    return version ? `staged:${version}` : null;
  }
  return null;
}

/**
 * Whether the quiet update nudge (settings row dot, drawer, nav badge)
 * should show. The skipped id is only ever the id of the update it was
 * skipped for — the server can't report an older one later, so any mismatch
 * means a newer update has since shipped and the nudge should reappear.
 */
export function shouldShowUpdateNudge(
  status: InstallUpdateStatus | null | undefined,
  skippedUpdateVersion: string,
): boolean {
  const id = updateIdentifier(status);
  return id !== null && id !== skippedUpdateVersion;
}
