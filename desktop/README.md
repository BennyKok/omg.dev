# omg.dev desktop

This package is the macOS-first desktop shell for the local omg.dev runtime.
It uses Electrobun with Bun as both the package manager and the real main
process runtime. The package includes the complete omg.dev web UI, server, and
target-native production dependencies.

At startup, the app reconnects to its own embedded runtime or starts a new one.
The runtime has isolated state and stays active after the window or app exits,
so scheduled work continues. A later app launch reuses that runtime. A package
update replaces it with the new embedded build.

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

## Local Apple Developer sign-in

From an interactive terminal on your Mac:

```bash
bun run ios:login
# Optional: select a known developer team.
bun run ios:login --team-id ABCDE12345
```

This command uses `@expo/apple-utils`, the Apple login library used by EAS CLI.
It prompts for your Apple ID, then restores the local Apple session or asks for
your password and two-factor code. You can select a developer team. Success
requires an active iOS developer membership and a verified team response.

The password goes directly from the Mac to Apple. Password storage in Keychain
is disabled for this command. Session cookies remain in Expo's existing local
cache at `~/.app-store/auth/<Apple ID>/cookie`. Cache directories use mode `0700`.
Cookies use mode `0600`. The command returns only the connected team name and ID.
The `ios:login` command connects the account. In the Mac app, Settings also
offers USB iPhone selection and local testing-profile preparation. It opens a
native Terminal window for Expo's interactive prompts. Passwords and 2FA never
pass through the local Settings HTTP routes.

Local provisioning reuses a saved distribution certificate and its matching
key. It registers selected USB devices, creates or reuses a wildcard ad hoc
profile, and saves signing material in the macOS login Keychain. It never
revokes a certificate or deletes an Apple profile. Adding a phone preserves
previous device coverage. Expired or revoked certificates require a deliberate
renewal flow.

The local exporter prepares the hosted v1 handoff once. It rewraps PKCS12 with
a random export password and preserves the exact intent, shared owner/team
revision, password, and signed profile bytes for retries. Pending exports stay
in Keychain. The Settings upload step uses a separate browser-approved OAuth
grant for `omg:ios-signing` and the signing-service audience. It reuses the
existing account client's consent, PKCE and refresh lifecycle.
The client checks the provider's discovery metadata before registration and
refresh. It requires the signing scope and the expected first-party endpoints.
The ordinary CLI token has no signing authority. Signing access and refresh tokens stay in the
Mac Keychain, separately from CLI credentials, and have no
browser token endpoint. The hosted signing routes and dedicated consent grant
are available in production.
Apple uses a private protocol for login. Changes at Apple can require an update
to the pinned Expo library.

Focused checks:

```bash
bun test src/ios-testing web/src/components/ios-testing-settings.test.tsx
bun run --cwd desktop apple:typecheck
# Native Keychain checks require a GUI terminal on the Mac, rather than SSH.
OMG_NATIVE_KEYCHAIN_TEST=1 bun test src/ios-testing/provisioning.test.ts -t 'native Keychain'
```

Useful checks:

```bash
bun run desktop:test
bun run --cwd desktop typecheck
bun run --cwd desktop desktop:config
bun run desktop:build
```

`desktop:build` builds the current host target. A signed and notarized macOS
release must run on a macOS runner with signing configured.

For a local review, launch the built app with an absolute
`OMG_DESKTOP_TEST_STATE_ROOT` through `open --env`. This uses separate runtime
state and disables the review app's update prompt. The installed app keeps its
own runtime and state.

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
