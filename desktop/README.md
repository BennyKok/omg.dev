# omg.dev desktop

This package is the macOS-first desktop shell for the local omg.dev runtime.
It uses Electrobun with Bun as both the package manager and the real main
process runtime. The package includes the complete omg.dev web UI, server, and
target-native production dependencies.

At startup, the app first checks for a healthy omg.dev server on loopback. It
uses that server when one is already running. Otherwise, it starts its embedded
runtime and stops only that owned child when the app exits.

## Requirements

- macOS on Apple Silicon for the first release target.
- No separate Bun or omg.dev CLI install is required for the packaged app.

Electrobun currently publishes no macOS Intel core artifact. Linux x64 and
ARM64 are available, but Linux is the second release target.

## Development

From the repository root:

```bash
bun install
bun run desktop:dev
```

For `desktop:dev`, an existing local runtime is still the fastest development
path. A production `desktop:build` first builds and stages the complete embedded
runtime, then creates the native package.

Useful checks:

```bash
bun run desktop:test
bun run --cwd desktop typecheck
bun run --cwd desktop desktop:config
bun run desktop:build
```

`desktop:build` builds the current host target. A signed and notarized macOS
release must run on a macOS runner with signing configured.

Before a local macOS package build, prepare the icon set from the shared app
icon:

```bash
bun run --cwd desktop desktop:icon
```

## GitHub Actions packages

Run the `desktop-package` workflow from the GitHub Actions page. It uses native
runners to create these downloadable workflow artifacts:

- `omg.dev-macos-arm64` contains the unsigned DMG and update archive.
- `omg.dev-linux-x64` contains the x64 installer and update archive.
- `omg.dev-linux-arm64` contains the ARM64 installer and update archive.

Each artifact also contains a target-specific SHA-256 checksum file. GitHub
keeps the workflow artifacts for 14 days.

After all native builds pass, the workflow updates the `desktop-preview`
prerelease. Its asset names stay stable, so the root README can link directly
to the current macOS DMG.
