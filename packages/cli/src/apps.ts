import { type ForwardDependencies, forwardToInstall } from "./forward.ts";

/**
 * Outer Cloud/Infra verbs. The npm wrapper forwards them to the installed
 * runtime (`lfg` / `src/cli.ts`), which owns deploy, apps, login, and the
 * rest. A Computer never sees this package: `omg` there is the runtime.
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
  "env",
]);

export type AppCommandDependencies = ForwardDependencies & {
  error?: (line: string) => void;
};

export async function runAppCommand(
  argv: string[],
  dependencies: AppCommandDependencies = {},
): Promise<number> {
  const forwarded = await forwardToInstall(argv, dependencies);
  if (forwarded.forwarded) return forwarded.exitCode;
  (dependencies.error ?? console.error)(
    "omg.dev is not installed on this computer. Run `omg computer setup` first.",
  );
  return 1;
}
