import { type ForwardDependencies, forwardToInstall } from "./forward.ts";

/**
 * Outer Cloud/Infra verbs. With an install, the npm wrapper forwards them to
 * the installed runtime (`lfg` / `src/cli.ts`), which owns deploy, apps,
 * login, and the rest. A Computer never sees this package: `omg` there is the
 * runtime.
 *
 * Without an install, the same implementation runs in this process. Hosted
 * apps only need an omg Cloud sign-in, not the local control plane, so
 * `npx @omg-dev/cli deploy` works on a plain laptop or in CI.
 */
export const APP_COMMANDS = new Set([
  "create",
  "deploy",
  "dev",
  "apps",
  "link",
  "visibility",
  "rename",
  "login",
  "logout",
  "whoami",
  "env",
]);

export type AppCommandDependencies = ForwardDependencies & {
  output?: (line: string) => void;
  error?: (line: string) => void;
  /** Runs the hosted-app command in this process. Tests replace it. */
  runLocal?: (argv: string[]) => Promise<number>;
};

async function runInProcess(argv: string[], dependencies: AppCommandDependencies): Promise<number> {
  // Same module the installed runtime uses, bundled into dist/omg-bun.mjs.
  const { cmdApps } = await import("../../../src/commands/apps.ts");
  return await cmdApps(argv, { output: dependencies.output, error: dependencies.error });
}

export async function runAppCommand(
  argv: string[],
  dependencies: AppCommandDependencies = {},
): Promise<number> {
  const forwarded = await forwardToInstall(argv, dependencies);
  if (forwarded.forwarded) return forwarded.exitCode;
  return await (dependencies.runLocal ?? ((args) => runInProcess(args, dependencies)))(argv);
}
