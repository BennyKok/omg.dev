import { APP_COMMANDS, runAppCommand, type AppCommandDependencies } from "./apps.ts";
import { HELP, HELP_BANNER } from "./help.ts";
import { forwardToInstall, type ForwardDependencies } from "./forward.ts";
import { runComputerForward, runComputerSetup, type InstallDependencies } from "./install.ts";

export { HELP, HELP_BANNER };

export type CliDependencies = InstallDependencies &
  ForwardDependencies &
  AppCommandDependencies & {
    output?: (line: string) => void;
    error?: (line: string) => void;
  };

const COMPUTER_OWNED = new Set(["setup", "update", "uninstall", "status", "connect"]);

function write(writer: ((line: string) => void) | undefined, fallback: typeof console.log, line: string) {
  (writer ?? fallback)(line);
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const out = (line: string) => write(dependencies.output, console.log, line);
  const err = (line: string) => write(dependencies.error, console.error, line);
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help" || cmd === "__omg_forward_probe") {
    out(HELP);
    return 0;
  }

  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
    out(typeof manifest.version === "string" ? manifest.version : "0.5.1");
    return 0;
  }

  if (APP_COMMANDS.has(cmd)) {
    return await runAppCommand(argv, { ...dependencies, error: err });
  }

  if (cmd === "computer") {
    const verb = rest[0];
    const args = rest.slice(1);
    if (!verb || verb === "help" || verb === "-h" || verb === "--help") {
      out(HELP);
      return 0;
    }
    if (verb === "setup") return await runComputerSetup(args, { ...dependencies, output: out });
    if (verb === "update") return await runComputerForward("setup", args, { ...dependencies, output: out });
    if (verb === "uninstall") {
      return await runComputerForward("uninstall", args, { ...dependencies, output: out });
    }
    if (verb === "status") {
      return await runComputerForward("update", ["--check", ...args], { ...dependencies, output: out });
    }
    if (verb === "connect") {
      return await runComputerForward("connect", args, { ...dependencies, output: out });
    }
    if (!COMPUTER_OWNED.has(verb)) {
      const forwarded = await forwardToInstall([verb, ...args], dependencies);
      if (forwarded.forwarded) return forwarded.exitCode;
    }
    err(`Unknown command: computer ${verb}`);
    out(HELP);
    return 1;
  }

  if (cmd === "setup") return await runComputerSetup(rest, { ...dependencies, output: out });

  const forwarded = await forwardToInstall(argv, dependencies);
  if (forwarded.forwarded) return forwarded.exitCode;
  err("omg.dev is not installed on this computer. Run `omg computer setup` first.");
  return 1;
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
