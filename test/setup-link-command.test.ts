// Setup used to force-link `omg` and `lfg` with `ln -sf`, which overwrites
// whatever is in the way. That made setup the destructive half of a pair whose
// uninstall deliberately refuses to remove a link it does not own — and it
// matters most for `omg`, because the omg.dev CLI installs a command by that
// exact name. An install silently replacing it is the worst version of the
// two-CLIs problem.
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETUP_SH, extractFunctionSource } from "./setup-script-helpers.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runLinkCommand(home: string, name: string, target: string): string {
  const source = readFileSync(SETUP_SH, "utf8");
  const markerLine = source.split("\n").find(l => l.startsWith('LAUNCHER_MARKER="'))!;
  const script = [
    "set -euo pipefail",
    `HOME=${JSON.stringify(home)}`,
    'warn() { printf "WARN:%s\\n" "$*" >&2; }',
    markerLine,
    extractFunctionSource("is_our_command"),
    extractFunctionSource("link_command"),
    `link_command ${JSON.stringify(name)} ${JSON.stringify(target)}`,
  ].join("\n");
  const result = Bun.spawnSync(["bash", "-c", script]);
  return new TextDecoder().decode(result.stderr);
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "omg-link-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  mkdirSync(join(home, "omg", "src"), { recursive: true });
  const target = join(home, "omg", "src", "cli.ts");
  writeFileSync(target, "#!/usr/bin/env bun\n");
  roots.push(home);
  return { home, target, link: join(home, ".local", "bin", "omg") };
}

describe("link_command", () => {
  test("writes a launcher when nothing is in the way", () => {
    const f = fixture();
    const stderr = runLinkCommand(f.home, "omg", f.target);
    const body = readFileSync(f.link, "utf8");
    // A launcher, not a symlink: the symlink relied on the CLI's bun shebang,
    // which fails wherever bun is not on PATH.
    expect(lstatSync(f.link).isSymbolicLink()).toBe(false);
    expect(body).toContain("# omg.dev launcher");
    expect(body).toContain(f.target);
    expect(stderr).not.toContain("WARN");
  });

  test("refuses to overwrite another tool's omg command", () => {
    const f = fixture();
    // What `npm install -g @omg-dev/cli` leaves on PATH.
    const foreign = join(f.home, "npm-omg.mjs");
    writeFileSync(foreign, "#!/usr/bin/env node\n");
    symlinkSync(foreign, f.link);

    const stderr = runLinkCommand(f.home, "omg", f.target);

    expect(readlinkSync(f.link)).toBe(foreign);
    expect(stderr).toContain("WARN");
    expect(stderr).toContain("not installed by omg.dev");
  });

  test("refuses to overwrite a real file the user put there", () => {
    const f = fixture();
    writeFileSync(f.link, "#!/bin/sh\necho mine\n");

    const stderr = runLinkCommand(f.home, "omg", f.target);

    expect(lstatSync(f.link).isSymbolicLink()).toBe(false);
    expect(readFileSync(f.link, "utf8")).toContain("echo mine");
    expect(stderr).toContain("WARN");
  });

  // An upgrade has to keep working: a link from a previous install, including
  // one in the pre-rename ~/lfg directory, is ours to repoint.
  test("replaces a launcher or link from an earlier omg.dev install", () => {
    const f = fixture();
    const previous = join(f.home, "lfg", "src", "cli.ts");
    mkdirSync(join(f.home, "lfg", "src"), { recursive: true });
    writeFileSync(previous, "#!/usr/bin/env bun\n");
    symlinkSync(previous, f.link);

    const stderr = runLinkCommand(f.home, "omg", f.target);

    expect(readFileSync(f.link, "utf8")).toContain(f.target);
    expect(stderr).not.toContain("WARN");
  });

  test("re-running setup on an unchanged install is a no-op", () => {
    const f = fixture();
    runLinkCommand(f.home, "omg", f.target);
    const stderr = runLinkCommand(f.home, "omg", f.target);
    expect(readFileSync(f.link, "utf8")).toContain(f.target);
    expect(stderr).not.toContain("WARN");
  });

  test("replaces a dangling link left by an older uninstall", () => {
    const f = fixture();
    // The exact leftover the pre-v0.1.309 uninstall produced.
    symlinkSync(join(f.home, "lfg", "src", "cli.ts"), f.link);
    expect(existsSync(f.link)).toBe(false); // dangling

    runLinkCommand(f.home, "omg", f.target);

    expect(readFileSync(f.link, "utf8")).toContain(f.target);
  });
});
