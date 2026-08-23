import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findInstall, type ForwardDependencies } from "./forward.ts";

export const DEFAULT_SETUP_URL =
  "https://raw.githubusercontent.com/BennyKok/omg.dev/main/scripts/setup.sh";

export type InstallDependencies = ForwardDependencies & {
  fetchText?: (url: string) => Promise<string>;
  runCommand?: (argv: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<number>;
  output?: (line: string) => void;
  setupUrl?: string;
};

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not download setup.sh from ${url} (${response.status})`);
  }
  return await response.text();
}

async function defaultRunCommand(
  argv: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const child = Bun.spawn(argv, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: options.env ?? process.env,
  });
  return await child.exited;
}

function out(dependencies: InstallDependencies, line: string) {
  (dependencies.output ?? console.log)(line);
}

export async function runComputerSetup(
  args: string[],
  dependencies: InstallDependencies = {},
): Promise<number> {
  const reinstall = args.includes("--reinstall");
  if (findInstall(dependencies) && !reinstall) {
    out(dependencies, "omg.dev is already set up on this computer.");
    out(dependencies, "Open http://localhost:8766 — or run `omg computer update`.");
    return 0;
  }

  out(dependencies, "Installing the local omg.dev control plane…");
  const url = dependencies.setupUrl ?? process.env.OMG_SETUP_URL ?? DEFAULT_SETUP_URL;
  const fetchText = dependencies.fetchText ?? defaultFetchText;
  const script = await fetchText(url);
  const directory = mkdtempSync(join(tmpdir(), "omg-install-"));
  const path = join(directory, "setup.sh");
  writeFileSync(path, script, { mode: 0o755 });

  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const code = await runCommand(["bash", path], { env: process.env });
  if (code !== 0) return code;

  if (!findInstall(dependencies)) {
    // Deliberately does not name the probed binary. Setup installs the control
    // plane as `lfg` and lets this wrapper keep the name `omg` (see
    // findInstall), so quoting `lfg` at someone who typed `omg computer setup`
    // reads like a broken install. The actionable cause is almost always PATH:
    // the launcher lands in ~/.local/bin, and setup only edits a shell rc when
    // OMG_UPDATE_SHELL_RC=1, which is off by default on macOS.
    out(dependencies, "Setup finished but the install was not found on PATH.");
    out(
      dependencies,
      "Open a new shell, or add ~/.local/bin to PATH, then run `omg computer status`.",
    );
    return 1;
  }
  out(dependencies, "Open http://localhost:8766");
  return 0;
}

export async function runComputerForward(
  verb: string,
  args: string[],
  dependencies: InstallDependencies = {},
): Promise<number> {
  const binary = findInstall(dependencies);
  if (!binary) {
    out(dependencies, "omg.dev is not installed on this computer. Run `omg computer setup` first.");
    return 1;
  }
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  return await runCommand([binary, verb, ...args], { env: process.env });
}
