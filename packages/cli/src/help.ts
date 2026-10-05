/** Shared so the setup.sh forward probe and `omg help` cannot drift. */
export const HELP_BANNER = "omg — run and manage your AI coding agents on your own box";

/**
 * Help for a computer with no install yet.
 *
 * Once omg.dev is installed, `omg help` prints the install's own list instead
 * (src/cli.ts in this repository). That list is the one complete reference,
 * so this one only covers what works before setup.
 */
export const HELP = `${HELP_BANNER}

omg.dev is not installed on this computer yet.

Usage:
  omg computer setup [--reinstall]     Install omg.dev here
  omg --version                        Show this CLI's version
  omg help

After setup, open http://localhost:8766. Run \`omg help\` again to see every
command: agents, the omg Cloud sign-in (omg login), and hosted apps
(omg create, omg deploy).

You bring your own agent accounts. omg.dev does not resell tokens.
`;
