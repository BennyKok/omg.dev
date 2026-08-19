# Mobile Agent Instructions

These instructions extend the root `AGENTS.md`.

## Responsibility

`mobile/` owns the native Expo client for omg.dev. It is currently named
`LFG Glass` in `app.json`. It is not the separate `app-blocker` product.

The root repository owns the local agent runtime and session lifecycle. The
`vibes` repository owns hosted authentication, billing, waitlist, and product
contracts used by this client.

## Source of truth

- `package.json` and `package-lock.json` define the installed Expo stack.
- Expo configuration files define native capabilities and bundle settings.
- Use the documentation for the exact installed Expo SDK version.
- Do not rely on a dated note about Expo Go or App Store availability. Verify
  current compatibility before an SDK change.

## Preflight

Before an Expo, React Native, or native change:

1. Confirm the installed Expo SDK and React Native versions.
2. Confirm the target: Expo Go, development build, simulator, or device.
3. Check whether the change needs a native module or a new development build.
4. Read the exact versioned Expo documentation for the affected API.

Expo SDK and Expo Go versions are coupled. Verify that the matching client is
available before you change the SDK. Prefer a development build when the app
needs native modules or stable control over the client version.

## Verification

Run the closest mobile checks during development. Run the mobile type check and
the affected platform build before delivery. Do not treat a web preview as
proof that a native path works.
