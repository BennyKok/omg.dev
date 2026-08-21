import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type ForwardDependencies } from "./forward.ts";

/**
 * Hosted create / deploy verbs that 0.4.42 owned. This package keeps the
 * public `omg` name and starts that flow; it does not teach a second command.
 */
export const APP_COMMANDS = new Set([
  "create",
  "deploy",
  "dev",
  "apps",
  "link",
  "visibility",
  "login",
  "logout",
  "whoami",
]);

/** Last published create/deploy implementation. `@omg-dev/apps` is still 404. */
export const APPS_CLI_SPEC = "@omg-dev/cli@0.4.42";
export const APPS_CLI_VERSION = "0.4.42";
export const APPS_CLI_TARBALL = "https://registry.npmjs.org/@omg-dev/cli/-/cli-0.4.42.tgz";
export const APPS_CLI_ENTRY = "dist/omg-bun.mjs";

export type AppCommandDependencies = ForwardDependencies & {
  env?: NodeJS.ProcessEnv;
  fetchBuffer?: (url: string) => Promise<Uint8Array>;
  extract?: (tarball: string, dest: string) => Promise<number>;
  mkdir?: (path: string) => void;
  writeFile?: (path: string, data: Uint8Array) => void;
  execPath?: string;
  error?: (line: string) => void;
};

export function appsCacheDir(home: string): string {
  return join(home, ".omg", "apps-cli", APPS_CLI_VERSION);
}

export function appsEntryPath(home: string): string {
  return join(appsCacheDir(home), APPS_CLI_ENTRY);
}

async function defaultFetchBuffer(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not download ${APPS_CLI_SPEC} from ${url} (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function defaultExtract(tarball: string, dest: string): Promise<number> {
  const child = Bun.spawn(["tar", "-xzf", tarball, "-C", dest, "--strip-components=1"], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

function resolveBun(dependencies: AppCommandDependencies): string | null {
  if (dependencies.execPath) return dependencies.execPath;
  if (typeof Bun !== "undefined" && process.execPath) return process.execPath;
  const which = dependencies.which ?? ((name: string) => Bun.which(name));
  return which("bun");
}

/**
 * Download the pinned 0.4.42 CLI once so `omg create` does not recurse into
 * this 0.5.x `omg` binary. The published 0.4.42 bin is also named `omg`.
 */
export async function ensureAppsCli(dependencies: AppCommandDependencies = {}): Promise<string> {
  const home = (dependencies.homedir ?? homedir)();
  const exists = dependencies.exists ?? ((path: string) => existsSync(path));
  const entry = appsEntryPath(home);
  if (exists(entry)) return entry;

  const cache = appsCacheDir(home);
  const mkdir = dependencies.mkdir ?? ((path: string) => mkdirSync(path, { recursive: true }));
  mkdir(cache);

  const fetchBuffer = dependencies.fetchBuffer ?? defaultFetchBuffer;
  const bytes = await fetchBuffer(APPS_CLI_TARBALL);
  const directory = mkdtempSync(join(tmpdir(), "omg-apps-cli-"));
  const tarball = join(directory, "cli.tgz");
  const writeFile = dependencies.writeFile ?? ((path: string, data: Uint8Array) => writeFileSync(path, data));
  writeFile(tarball, bytes);

  const extract = dependencies.extract ?? defaultExtract;
  const code = await extract(tarball, cache);
  if (code !== 0) {
    throw new Error(`could not extract ${APPS_CLI_SPEC} (tar exit ${code})`);
  }
  if (!exists(entry)) {
    throw new Error(`extracted ${APPS_CLI_SPEC} but ${APPS_CLI_ENTRY} was missing`);
  }
  return entry;
}

/**
 * Resolve the hosted create/deploy runner without a second user-facing command.
 *
 * Preference:
 * 1. `OMG_APPS_BIN` — explicit binary or script
 * 2. `omg-apps` on PATH — published `@omg-dev/apps`, if a maintainer installed it
 * 3. cached `@omg-dev/cli@0.4.42` entry, run with Bun
 */
export async function resolveAppRunner(
  dependencies: AppCommandDependencies = {},
): Promise<{ command: string[]; source: "override" | "omg-apps" | "pinned-0.4.42" }> {
  const env = dependencies.env ?? process.env;
  const override = env.OMG_APPS_BIN?.trim();
  if (override) return { command: [override], source: "override" };

  const which = dependencies.which ?? ((name: string) => Bun.which(name));
  const apps = which("omg-apps");
  if (apps) return { command: [apps], source: "omg-apps" };

  const entry = await ensureAppsCli(dependencies);
  const bun = resolveBun(dependencies);
  if (!bun) {
    throw new Error("Bun is required to run create / deploy / login. Install it from https://bun.sh");
  }
  return { command: [bun, entry], source: "pinned-0.4.42" };
}

export async function runAppCommand(
  argv: string[],
  dependencies: AppCommandDependencies = {},
): Promise<number> {
  try {
    const { command } = await resolveAppRunner(dependencies);
    const spawn =
      dependencies.spawn ??
      (async (commandLine: string[]) => {
        const child = Bun.spawn(commandLine, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
        return await child.exited;
      });
    return await spawn([...command, ...argv]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (dependencies.error ?? console.error)(`omg: could not start ${argv[0] ?? "the hosted app command"}.`);
    (dependencies.error ?? console.error)(message);
    return 1;
  }
}
