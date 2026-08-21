# `@omg-dev/cli`

Install and manage the local omg.dev agent control plane.

This package is the control-plane bootstrapper published from
[BennyKok/omg.dev](https://github.com/BennyKok/omg.dev). The same `omg`
binary also starts the hosted create / deploy flow.

Versions `0.4.x` on this name were published from `BennyKok/vibes`. This line
starts at `0.5.0` so `npm install --global @omg-dev/cli` resolves to the current
product. `0.5.1+` restores `create` / `deploy` / `login` on this binary.

## Install

```bash
bun install --global @omg-dev/cli && omg computer setup
```

Then open **http://localhost:8766**.

The same install without npm:

```bash
curl -fsSL https://raw.githubusercontent.com/BennyKok/omg.dev/main/scripts/setup.sh | bash
```

You bring your own agent accounts. omg.dev does not resell tokens.

`lfg` remains a compatibility alias for the installed control plane.

## Commands

| Command | Does |
| --- | --- |
| `omg computer setup [--reinstall]` | Install the local control plane. No account needed. |
| `omg computer update` | Update an existing install. |
| `omg computer uninstall [--purge --yes]` | Remove the install. Keeps data unless purged. |
| `omg computer status` | Show this machine's install. |
| `omg serve` | After setup, run the web UI (forwarded to the install). |
| `omg create <name>` | Create an app (hosted `*.omgs.app`). |
| `omg deploy` | Publish the current directory. |
| `omg login` | Sign in for create / deploy. |

Any other verb the install owns (`mcp`, `doctor`, `agents`, …) is forwarded to
it. `create` / `deploy` / `login` start the last published hosted app CLI
(`@omg-dev/cli@0.4.42`) under this same `omg`. They do not install a second
command.

## Versioning

This package is versioned independently of the control-plane runtime. The
runtime stays on the repository tag (`v0.2.x` today). The CLI must publish
above `0.4.42` to become `latest` on npm.
