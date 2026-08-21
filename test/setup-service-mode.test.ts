import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SETUP_SH, extractFunctionSource } from "./setup-script-helpers.ts";

function resolveServiceMode(input: {
  mode?: string;
  os?: "Linux" | "Darwin";
  systemdRuntime?: boolean;
} = {}): { exitCode: number; mode: string; stderr: string } {
  const runtimeDir = input.systemdRuntime ? "/tmp" : "/does-not-exist";
  const script = [
    "set -euo pipefail",
    "die() { printf '%s' \"$*\" >&2; exit 1; }",
    `OS_NAME=${input.os ?? "Linux"}`,
    `LFG_INSTALL_SERVICE=${input.mode ?? "auto"}`,
    `LFG_SYSTEMD_RUNTIME_DIR=${runtimeDir}`,
    // Keep the test independent of the host's init system.
    "systemctl() { :; }",
    "export -f systemctl",
    extractFunctionSource("resolve_service_mode"),
    "resolve_service_mode",
    "printf '%s' \"$LFG_INSTALL_SERVICE\"",
  ].join("\n");
  const result = Bun.spawnSync(["bash", "-c", script]);
  return {
    exitCode: result.exitCode,
    mode: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("setup service mode", () => {
  test("auto uses an external supervisor when Linux has no systemd runtime", () => {
    expect(resolveServiceMode()).toMatchObject({ exitCode: 0, mode: "0" });
  });

  test("auto installs the service when Linux has a systemd runtime", () => {
    expect(resolveServiceMode({ systemdRuntime: true })).toMatchObject({ exitCode: 0, mode: "1" });
  });

  test("auto installs the launchd service on macOS", () => {
    expect(resolveServiceMode({ os: "Darwin" })).toMatchObject({ exitCode: 0, mode: "1" });
  });

  test("an explicit service choice wins", () => {
    expect(resolveServiceMode({ mode: "0", systemdRuntime: true }).mode).toBe("0");
    expect(resolveServiceMode({ mode: "1" }).mode).toBe("1");
  });

  test("an invalid service choice fails with a clear message", () => {
    const result = resolveServiceMode({ mode: "sometimes" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("LFG_INSTALL_SERVICE must be auto, 0, or 1.");
  });
});

test("source installs build required packages before the web UI", () => {
  const source = readFileSync(SETUP_SH, "utf8");
  const sourceInstall = source.slice(
    source.indexOf('if [ "$LFG_INSTALL_MODE" = "source" ]'),
    source.indexOf("extract_release_archive()"),
  );
  const install = sourceInstall.indexOf('"$BUN_BIN" install');
  const protocol = sourceInstall.indexOf('"$BUN_BIN" run --cwd packages/protocol build');
  const client = sourceInstall.indexOf('"$BUN_BIN" run --cwd packages/client build');
  const web = sourceInstall.indexOf('LFG_WEB_SOURCEMAP=0 "$BUN_BIN" run --cwd web build');
  expect(install).toBeGreaterThanOrEqual(0);
  expect(protocol).toBeGreaterThan(install);
  expect(client).toBeGreaterThan(protocol);
  expect(web).toBeGreaterThan(client);
  expect(sourceInstall).not.toContain('"$BUN_BIN" run build:packages');
});

test("the interpolated systemd unit does not execute comment text", () => {
  const source = readFileSync(SETUP_SH, "utf8");
  const functionStart = source.indexOf("install_linux_service() {");
  const unitStart = source.indexOf("<<UNIT\n", functionStart);
  const unitEnd = source.indexOf("\nUNIT", unitStart + 7);
  expect(unitStart).toBeGreaterThan(functionStart);
  expect(unitEnd).toBeGreaterThan(unitStart);
  expect(source.slice(unitStart, unitEnd)).not.toContain("`");
});
