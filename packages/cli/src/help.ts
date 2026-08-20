/** Shared so the setup.sh forward probe and `omg help` cannot drift. */
export const HELP_BANNER = "omg — run and manage your AI coding agents on your own box";

export const HELP = `${HELP_BANNER}

Usage:
  omg computer setup [--reinstall]     Install the local control plane
  omg computer status                  Show this machine's install
  omg computer update                  Update an existing install
  omg computer uninstall [--purge --yes]
  omg serve                            Run the web UI (after setup)
  omg help

This command installs the local omg.dev agent control plane. It does not
create or deploy apps to *.omgs.app.

You bring your own agent accounts. omg.dev does not resell tokens.

After setup, unknown commands are forwarded to the install. \`lfg\` remains
a compatibility alias for that install.

Then open http://localhost:8766.
`;

/** Retired prompt-to-app verbs that must not silently fall through. */
export const RETIRED_APP_COMMANDS = new Set([
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

export function retiredAppMessage(command: string): string {
  return `omg: \`${command}\` is not part of the current omg.dev product.

The current product is the local agent control plane. Install it with:

  omg computer setup

Then open http://localhost:8766.

create / deploy to *.omgs.app was the retired prompt-to-app CLI, published
as @omg-dev/cli 0.4.x from BennyKok/vibes. That line is not this package.
`;
}
