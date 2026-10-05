#!/usr/bin/env bun
const HELP = `omg — run and manage your AI coding agents on your own box

This computer:
  omg computer setup               Install omg.dev here (Bun, tmux, service)
  omg computer status              Show the installed version and if an update exists
  omg computer update [--check]    Update to the latest release and restart
  omg computer uninstall [--purge --yes]
                                   Remove omg.dev. Sessions and settings stay unless --purge
  omg serve                        Run the web UI and control server (default :8766)
  omg doctor [--json]              Print a diagnostic for bug reports
  omg connect <code>               Pair this computer for remote access (EXPERIMENTAL)

Agents:
  omg subagent create|models       Start a managed agent session on any harness
  omg agents list|run|show         Run or inspect insight agents (see 'omg agents help')
  omg projects status|clean        Check or clean old project state
  omg mcp                          Run the omg.dev MCP server (stdio)
  omg computer-mcp                 Run the Computer MCP server (stdio)

omg Cloud account:
  omg login [--api-key KEY]        Sign in to omg Cloud
  omg logout                       Sign out of omg Cloud
  omg whoami                       Show the signed-in account

Hosted apps (*.omgs.app):
  omg create <name>                Publish the current directory as a new app
  omg deploy [--name NAME]         Publish the current directory
             [--no-wait] [--generate-icon]
  omg apps                         List your apps
  omg visibility <slug> [public|omg-users]
                                   Show or set who can open an app
  omg env list|pull|set|rm|import <slug> ...
                                   Manage an app's environment variables

Settings (read from the environment or .env, see .env.example):
  OMG_PORT, OMG_HOST, OMG_REPOS_ROOT  (the older LFG_* names still work)

setup, update, uninstall, doctor, serve, mcp, agents, subagent, projects and
connect also work without "computer", for example \`omg update\`.
\`lfg\` is an older name for this command and still works.
`;

/**
 * Machine-local verbs are also reachable as `omg computer <verb>`.
 *
 * That is the documented surface, because `omg` may be either this CLI or the
 * omg.dev CLI depending on PATH order, and only one spelling can work in both.
 * The omg.dev CLI routes `computer <verb>` here; this makes the same command
 * work when it is absent and this binary answers to `omg` directly.
 *
 * Bare verbs stay: the service unit and every already-registered MCP config
 * invoke `src/cli.ts serve` / `mcp` directly, and rewriting those would mean
 * migrating third-party agent configs for no user-visible gain.
 */
const COMPUTER_VERBS = new Set([
  "serve",
  "setup",
  "update",
  "uninstall",
  "status",
  "doctor",
  "mcp",
  "agents",
  "subagent",
  "subagents",
  "connect",
  "projects",
]);

function unwrapComputerNamespace(argv: string[]): string[] {
  if (argv[0] !== "computer") return argv;
  const verb = argv[1];
  // `omg computer` alone, or a verb this CLI does not have, falls through to
  // normal dispatch so the error names the actual command rather than "computer".
  if (!verb || !COMPUTER_VERBS.has(verb)) return argv;
  // `computer status` is the omg.dev CLI's name for the install summary; this
  // CLI spells that `setup --check`-ish behaviour through its own commands, so
  // map it to the closest thing rather than inventing a second one.
  if (verb === "status") return ["update", "--check", ...argv.slice(2)];
  return argv.slice(1);
}

async function main() {
  // Must run before the first `await import` below: commands read their
  // configuration at module scope, so aliasing after the import would be too
  // late for anything already captured into a module-level const.
  const { applyEnvAliases } = await import("./env-compat.ts");
  applyEnvAliases();
  const { installDesktopParentGuard } = await import("./desktop-parent.ts");
  installDesktopParentGuard();

  const [cmd, ...rest] = unwrapComputerNamespace(process.argv.slice(2));
  switch (cmd) {
    case "serve": {
      const { cmdServe } = await import("./commands/serve.ts");
      return await cmdServe();
    }
    case "agents": {
      const { cmdAgents } = await import("./commands/agents.ts");
      return await cmdAgents(rest);
    }
    case "subagent":
    case "subagents": {
      const { cmdSubagent } = await import("./commands/subagent.ts");
      return await cmdSubagent(rest);
    }
    case "mcp": {
      const { cmdMcp } = await import("./commands/mcp.ts");
      return await cmdMcp();
    }
    // Deliberately NOT reachable as `omg computer mcp`: that unwraps to `mcp`
    // (the hosted omg catalog) via unwrapComputerNamespace. The Computer's
    // tools are a separate, local-only server -- see src/computer/mcp.ts.
    case "computer-mcp": {
      const { cmdComputerMcp } = await import("./computer/mcp.ts");
      return await cmdComputerMcp();
    }
    case "connect": {
      const { cmdConnect } = await import("./commands/connect.ts");
      return await cmdConnect(rest);
    }
    case "projects": {
      const { cmdProjects } = await import("./commands/projects.ts");
      return await cmdProjects(rest);
    }
    case "login":
    case "logout":
    case "whoami":
    case "deploy":
    case "create":
    case "apps":
    case "visibility":
    case "env":
    case "dev":
    case "link": {
      const { cmdApps } = await import("./commands/apps.ts");
      const code = await cmdApps([cmd, ...rest]);
      if (code !== 0) process.exit(code);
      return;
    }
    case "setup": {
      const { cmdSetup } = await import("./commands/setup.ts");
      return await cmdSetup(rest);
    }
    case "update": {
      const { cmdUpdate } = await import("./commands/update.ts");
      return await cmdUpdate(rest);
    }
    case "doctor": {
      const { cmdDoctor } = await import("./commands/doctor.ts");
      return await cmdDoctor(rest);
    }
    case "uninstall": {
      const { cmdUninstall } = await import("./commands/uninstall.ts");
      return await cmdUninstall(rest);
    }
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
