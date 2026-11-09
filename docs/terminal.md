Status: current (2026-11-09).

# Browser terminal

The browser terminal is ghostty-web in the page, connected over a websocket
to a shell that lives in the **terminal host**. There is no tmux.

```
browser (ghostty-web)  ─ws─  lfg serve (src/term/routes.ts)  ─unix socket─  terminal host (src/term/host.ts)
                                                                               ├─ PTY + bash   (src/pty.ts)
                                                                               └─ headless Ghostty screen (src/term/vt.ts)
```

## Why a separate host process

The host owns every shell. serve starts it on demand as a detached process
(`src/term/client.ts`). The service unit uses `KillMode=process`, so a deploy
restarts serve and leaves the host and its shells running. The browser
reconnects and continues.

The host socket is `<data>/run/term-host.sock` (mode 0600, directory 0700).
Its log is `<data>/run/term-host.log`. The host exits on its own after 10
minutes with no shells and no connections.

## Resume

The host feeds every byte a shell prints through a headless Ghostty screen.
Each attach starts with a snapshot of that screen: scrollback, screen, colours,
cursor, alternate screen, input modes, and title (`serializeScreen`). Then the
live stream follows. A reload, a tab switch, or a server restart repaints the
exact screen in one write.

The host also answers terminal queries (cursor position, device attributes).
The browser drops its own copy of each answer (`tuneGhostty`).

## Flicker

ghostty-web 0.4.0 paints every animation frame, even inside a synchronized
update (DEC mode 2026), so a TUI frame that arrived in two parts was painted
half-drawn. `tuneGhostty` holds painting while the mode is set, for at most
150 ms. The PTY pump also sends everything readable as one chunk.

## UI

- A session's terminals dock under its chat (`session-terminal-dock.tsx`). The
  dock pushes the chat up, the divider drags, and ⌃` hides the dock.
- Tabs (`terminal-panel.tsx`) are shells in the host. Ids: `s-<sessionId>`
  for a session's first tab, `s-<sessionId>-<tab>` for the next ones, and a
  bare name for global shells (`main`, `login-<agent>`). The host list is the
  source of truth, so tabs show on every device.
- Closing a tab ends its shell. Hiding the dock does not.

## Security

`/api/term*` refuses requests from other sites (`isTrustedTermRequest`).
Browsers allow cross-origin websocket handshakes, and Chrome sends no
`Sec-Fetch-Site` on them, so the check reads `Origin`. The other serve routes
do not have this check yet.

## Tests

- `bun test src/term test/term-host.integration.test.ts` — protocol,
  snapshot, routes, and a real host with real shells.
- `bun test/browser/terminal-e2e.ts` — Chromium against the real dock, the
  real routes, the host and bash. It needs Playwright (`PLAYWRIGHT_MODULE`)
  and a Chromium (`CHROMIUM_EXECUTABLE`, default `/usr/bin/google-chrome`).
  `E2E_ONLY=<regex>` runs one check.
