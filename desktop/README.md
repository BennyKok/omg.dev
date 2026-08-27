# omg.dev desktop

This package is the macOS-first desktop shell for the local omg.dev runtime.
It uses Electrobun with Bun as both the package manager and the real main
process runtime. The native window loads the existing server at
`http://127.0.0.1:8766`.

The desktop process does not own the omg.dev server. The existing launchd or
systemd user service remains the lifecycle owner, so agent sessions continue
after the window closes.

## Requirements

- macOS on Apple Silicon for the first release target.
- Bun.
- A local install created with `omg computer setup`.

Electrobun currently publishes no macOS Intel core artifact. Linux x64 and
ARM64 are available, but Linux is the second release target.

## Development

From the repository root:

```bash
bun install
bun run desktop:dev
```

Run the local runtime separately with `bun run serve`. The desktop window shows
a waiting screen until the runtime answers, then loads the normal omg.dev UI.

Useful checks:

```bash
bun run desktop:test
bun run --cwd desktop typecheck
bun run --cwd desktop desktop:config
bun run desktop:build
```

`desktop:build` builds the current host target. A signed and notarized macOS
release must run on a macOS runner with signing configured.

## GitHub Actions packages

Run the `desktop-package` workflow from the GitHub Actions page. It uses native
runners to create these downloadable workflow artifacts:

- `omg.dev-macos-arm64` contains the unsigned DMG and update archive.
- `omg.dev-linux-x64` contains the x64 installer and update archive.
- `omg.dev-linux-arm64` contains the ARM64 installer and update archive.

Each artifact also contains `SHA256SUMS.txt`. GitHub keeps the workflow
artifacts for 14 days. The workflow does not publish a GitHub Release.
