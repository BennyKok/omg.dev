# `@omg-dev/cli`

Install and manage the local omg.dev agent control plane.

This package is the control-plane bootstrapper published from
[BennyKok/omg.dev](https://github.com/BennyKok/omg.dev). omg.dev is local
software: it runs on your computer and needs no omg account.

Versions `0.4.x` on this name were published from `BennyKok/vibes`. This line
starts at `0.5.0` so `npm install --global @omg-dev/cli` resolves to the current
product. The hosted-app commands (`create`, `deploy`, `login`, `apps`, `env`,
...) were removed; they now exit with a message.

## Install the control plane

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

Any other verb the install owns (`mcp`, `doctor`, `agents`, …) is forwarded to
it. The retired `@omg-dev/cli@0.4.42` tarball is no longer downloaded.

After setup, `omg help` prints the install's complete command list. Before
setup, it prints only the commands that work without an install.

## Versioning

This package is versioned independently of the control-plane runtime. The
runtime stays on the repository tag (`v0.2.x` today). The CLI must publish
above `0.4.42` to become `latest` on npm.
