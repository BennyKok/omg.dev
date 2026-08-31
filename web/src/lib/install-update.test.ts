import { describe, expect, test } from "bun:test";
import {
  isInstallUpdateInfo,
  shouldShowUpdateNudge,
  updateIdentifier,
  type InstallUpdateStatus,
} from "./install-update.ts";

const valid = {
  install: { channel: "source", updateCommand: "git pull --ff-only" },
  update: null,
  bootId: "boot-1",
};

test("accepts a real /api/install payload", () => {
  expect(isInstallUpdateInfo(valid)).toBe(true);
});

test("rejects the empty object the transport returns for HTML or a blank body", () => {
  expect(isInstallUpdateInfo({})).toBe(false);
  expect(isInstallUpdateInfo(null)).toBe(false);
  expect(isInstallUpdateInfo(undefined)).toBe(false);
});

test("rejects a payload whose install field cannot be read for .channel", () => {
  expect(isInstallUpdateInfo({ install: undefined, bootId: "x" })).toBe(false);
  expect(isInstallUpdateInfo({ install: null, bootId: "x" })).toBe(false);
  expect(isInstallUpdateInfo({ install: true, bootId: "x" })).toBe(false);
  expect(isInstallUpdateInfo({ install: "source", bootId: "x" })).toBe(false);
  expect(isInstallUpdateInfo({ install: {}, bootId: "x" })).toBe(false);
});

function available(overrides: Partial<InstallUpdateStatus> = {}): InstallUpdateStatus {
  return {
    channel: "release",
    state: "available",
    currentVersion: "0.1.0",
    latestVersion: "0.2.0",
    message: "0.2.0 is available",
    restartSupported: true,
    ...overrides,
  };
}

describe("updateIdentifier", () => {
  test("is null with no status, or a status that is not available", () => {
    expect(updateIdentifier(null)).toBeNull();
    expect(updateIdentifier(undefined)).toBeNull();
    expect(updateIdentifier(available({ state: "up-to-date" }))).toBeNull();
    expect(updateIdentifier(available({ state: "blocked" }))).toBeNull();
  });

  test("prefers latestVersion, then latestTag, then latestSha", () => {
    expect(updateIdentifier(available({ latestVersion: "0.2.0", latestTag: "v0.2.0" }))).toBe("0.2.0");
    expect(
      updateIdentifier(available({ latestVersion: undefined, latestTag: "v0.2.0", latestSha: "abc123" })),
    ).toBe("v0.2.0");
    expect(
      updateIdentifier(
        available({ latestVersion: undefined, latestTag: undefined, latestSha: "abc123" }),
      ),
    ).toBe("abc123");
  });
});

describe("a staged update is still something to act on", () => {
  // The bug: a box that had downloaded an update but not restarted reported
  // itself up to date, and the nudge went silent at exactly the moment there
  // was something to do.
  const staged = (overrides = {}) =>
    available({ state: "staged", currentVersion: "0.6.21", stagedVersion: "0.6.23", latestVersion: "0.6.23", ...overrides });

  test("still produces an identifier, so the nudge shows", () => {
    expect(updateIdentifier(staged())).toBe("staged:0.6.23");
    expect(shouldShowUpdateNudge(staged(), "")).toBe(true);
  });

  test("skipping the download does not silence the restart", () => {
    // The reader skipped 0.6.23 while it was merely available. Then it was
    // installed anyway (by another client, or a scheduled update). The restart
    // is a different thing to be told about, so the id must differ.
    expect(shouldShowUpdateNudge(staged(), "0.6.23")).toBe(true);
  });

  test("skipping the staged restart itself does silence it", () => {
    expect(shouldShowUpdateNudge(staged(), "staged:0.6.23")).toBe(false);
  });

  test("falls back to the latest version when no staged version is reported", () => {
    expect(updateIdentifier(staged({ stagedVersion: undefined }))).toBe("staged:0.6.23");
  });
});

describe("skip persistence semantics", () => {
  test("hides the nudge once the available update's id is skipped", () => {
    const status = available({ latestVersion: "0.2.0" });
    expect(shouldShowUpdateNudge(status, "0.2.0")).toBe(false);
  });

  test("shows the nudge when nothing has been skipped", () => {
    const status = available({ latestVersion: "0.2.0" });
    expect(shouldShowUpdateNudge(status, "")).toBe(true);
  });

  test("re-shows once a newer version supersedes the skipped one", () => {
    const skippedFor = "0.2.0";
    const nowAvailable = available({ latestVersion: "0.3.0" });
    expect(shouldShowUpdateNudge(nowAvailable, skippedFor)).toBe(true);
  });

  test("stays hidden while no update is available at all", () => {
    expect(shouldShowUpdateNudge(available({ state: "up-to-date" }), "")).toBe(false);
    expect(shouldShowUpdateNudge(null, "")).toBe(false);
  });
});
