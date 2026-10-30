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

Hosted apps (*.omgs.app) work without an install:
  omg login [--api-key KEY]            Sign in to omg Cloud
  omg deploy [--name NAME]             Publish the current directory
             [--no-wait] [--generate-icon]
  omg create <name>                    Publish the current directory as a new app
  omg apps                             List your apps
  omg visibility <slug> [public|omg-users]
  omg rename <slug> <new-slug>
  omg env list|pull|set|rm|import <slug> ...
  omg whoami | omg logout

Run your AI coding agents on this computer:
  omg computer setup [--reinstall]     Install omg.dev here
  omg --version                        Show this CLI's version
  omg help

After setup, open http://localhost:8766. Run \`omg help\` again to see every
command. You bring your own agent accounts. omg.dev does not resell tokens.
`;
