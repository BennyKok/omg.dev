/** Shared so the setup.sh forward probe and `omg help` cannot drift. */
export const HELP_BANNER = "omg — run and manage your AI coding agents on your own box";

export const HELP = `${HELP_BANNER}

Usage:
  omg computer setup [--reinstall]     Install the local control plane
  omg computer status                  Show this machine's install
  omg computer update                  Update an existing install
  omg computer uninstall [--purge --yes]
  omg serve                            Run the web UI (after setup)
  omg create <name>                    Create an app (hosted *.omgs.app)
  omg deploy                           Publish the current directory
  omg login                            Sign in for create / deploy
  omg help

This command installs the local omg.dev agent control plane. After setup,
open http://localhost:8766.

You bring your own agent accounts. omg.dev does not resell tokens.

After setup, unknown commands are forwarded to the install. \`lfg\` remains
a compatibility alias for that install.

create / deploy / login still start the hosted app flow on this same \`omg\`.
`;
