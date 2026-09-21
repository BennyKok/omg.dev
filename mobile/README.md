# LFG for iOS

Expo SDK 57 React Native client for the existing LFG server.

## Run

```bash
npm ci
npm run typecheck
npx expo start
```

The app infers the LFG API at port `8766` on the Metro host. Override it with
`EXPO_PUBLIC_LFG_URL` or change it at runtime in Settings.

It supports the live session fleet, realtime transcript chat, send/queue/stop,
agent launches, findings, native UIKit tabs, and iOS 26 Liquid Glass.

The LFG API is local and unauthenticated. Reach it over a private network such
as Tailscale; never expose port `8766` directly to the internet.

## iPad workspace

On iPad, windows at least 768 points wide show the session list beside the
current conversation or page. Chat, Bots, and Schedules controls sit above the
list. The machine picker stays at the bottom. New session opens the existing
composer in the detail pane.

Narrow iPad windows show one pane at a time. Resizing keeps the same navigator
and selected route mounted. iPhone uses the existing full-screen navigation.

## Session artifacts

Open **Artifacts** from a session's overflow menu to browse its images, videos,
files, and HTML output. Tap an HTML card in the list or transcript to open its
interactive viewer. Use **Reload artifact** to fetch the current version.
HTML uses the same theme and content policy as the web client, inside an isolated
frame without app credentials. Existing file artifacts remain download/text previews.
The HTML viewer requires a native build with `react-native-webview`; older binaries
show an update message. Verify with:

```bash
EXPO_PUBLIC_OMG_DEMO=1 EXPO_PUBLIC_OMG_ARTIFACT_FIXTURE=1 bun run test:e2e --build --plan artifacts --record
```
