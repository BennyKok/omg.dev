import { describe, expect, test } from "bun:test";
import {
  desktopParentPid,
  desktopRuntimeIdentity,
  desktopRuntimeReadyPayload,
  installDesktopParentGuard,
  isDesktopEmbeddedRuntime,
} from "./desktop-parent.ts";

describe("desktop parent lifetime", () => {
  test("accepts only another valid process id", () => {
    expect(desktopParentPid({ OMG_DESKTOP_PARENT_PID: "4242" }, 100)).toBe(4242);
    expect(desktopParentPid({ LFG_DESKTOP_PARENT_PID: "3131" }, 100)).toBe(3131);
    expect(desktopParentPid({ OMG_DESKTOP_PARENT_PID: "100" }, 100)).toBeNull();
    expect(desktopParentPid({ OMG_DESKTOP_PARENT_PID: "nope" }, 100)).toBeNull();
    expect(desktopParentPid({}, 100)).toBeNull();
  });

  test("prefers the current OMG variable", () => {
    expect(
      desktopParentPid(
        { OMG_DESKTOP_PARENT_PID: "4242", LFG_DESKTOP_PARENT_PID: "3131" },
        100,
      ),
    ).toBe(4242);
  });

  test("recognizes both persistent and legacy embedded runtimes", () => {
    expect(
      desktopRuntimeIdentity({
        OMG_DESKTOP_RUNTIME_ID: "desktop-123",
        OMG_DESKTOP_RUNTIME_FINGERPRINT: "build-456",
      }),
    ).toEqual({ fingerprint: "build-456", runtimeId: "desktop-123" });
    expect(isDesktopEmbeddedRuntime({ OMG_DESKTOP_RUNTIME_ID: "desktop-123" })).toBe(
      true,
    );
    expect(isDesktopEmbeddedRuntime({ OMG_DESKTOP_PARENT_PID: "4242" })).toBe(true);
    expect(isDesktopEmbeddedRuntime({})).toBe(false);
    expect(
      desktopRuntimeReadyPayload("boot-123", {
        OMG_DESKTOP_RUNTIME_ID: "desktop-123",
        OMG_DESKTOP_RUNTIME_FINGERPRINT: "build-456",
      }),
    ).toEqual({
      bootId: "boot-123",
      desktopRuntimeFingerprint: "build-456",
      desktopRuntimeId: "desktop-123",
    });
    expect(desktopRuntimeReadyPayload("boot-123", {})).toEqual({
      bootId: "boot-123",
    });
  });

  test("does not pass desktop ownership to server children", () => {
    const env: Record<string, string | undefined> = {
      OMG_DESKTOP_PARENT_PID: String(process.pid + 100_000),
      LFG_DESKTOP_PARENT_PID: String(process.pid + 100_000),
    };
    const timer = installDesktopParentGuard(env);
    expect(timer).not.toBeNull();
    clearInterval(timer!);
    expect(env).toEqual({});
  });
});
