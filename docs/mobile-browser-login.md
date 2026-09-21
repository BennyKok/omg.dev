# Mobile browser login and computer control

Research and proposed experiment, 2026-09-21. The iOS features below are not implemented.

## Current owners

- `web/src/views/computer-page.tsx` owns the remote desktop UI and touch input.
- `web/src/lib/rfb-channel.ts` adapts the authenticated transport to noVNC.
- `src/computer/` owns the desktop, RFB bridge, and agent browser control.
- `mobile/src/omg/transport.ts` owns the phone's authenticated computer transport.
- `mobile/app/computers.tsx` selects a computer. It does not display its desktop.
- `mobile/src/omg/agent-connect.ts` already opens provider login flows for coding agents.
  Those flows do not export arbitrary website sessions.
- `src/live-ws.ts` owns live subscriptions. Its User-Agent field is for logs.
  It does not establish an agent-facing mobile login capability.
- Hosted identity and grants belong to `vibes`.

## Login routes

| Route | Result | Limit |
| --- | --- | --- |
| System login sheet (`ASWebAuthenticationSession`) | Provider callback to the app | No general Safari cookie export. Requires provider support. |
| Safari web extension | Candidate for a user-approved transfer from Safari | Requires extension setup, host permission, and a device proof of cookie access. |
| In-app `WKWebView` | Access to that web view's cookie store | Separate from existing Safari sessions. Some identity providers block embedded login. |
| Remote desktop takeover | User logs in directly on the VM | No session transfer needed. Phone keyboard and pointer UX must work well. |

Apple documents [authentication callbacks](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession),
[web-view cookie storage](https://developer.apple.com/documentation/webkit/wkhttpcookiestore),
[iOS Safari extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions),
[extension permissions](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions),
and [extension API differences](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility).
Google's [OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies) rules out controlled embedded user agents for its authorization flow.

The extension route is a proposed experiment, not proof that a particular site's session can move.
Cookie transfer alone can be insufficient. A site can also require browser storage or device-bound state.
Do not promise universal login transfer.

## Proposed user flow

1. The agent requests login for a specific HTTPS origin and target computer.
2. The user sees the site, computer, and reason in a login card.
3. The card offers only routes supported by the connected client.
4. On iOS with the extension ready, offer “Continue in Safari”.
5. After login, the user chooses “Use this login on [computer]”.
6. The runtime imports only the approved site's session into the existing agent browser.
7. The runtime verifies the logged-in page before reporting success to the agent.

Keep “Log in on this computer” as the fallback.
On other clients, offer “Continue on iPhone” only when a paired iPhone can handle the request.
Otherwise, an iOS setup link can be secondary. Do not block desktop login behind an install prompt.

## Agent and runtime contract

Prefer an MCP operation for the action. A skill can explain when to call it.
A skill alone cannot open a native sheet or transfer an authenticated session.

Proposed names, not existing tools:

- `request_browser_login(origin, reason)` returns a request ID and supported routes.
- `browser_login_status(requestId)` returns pending, completed, cancelled, expired, or failed.

Extend the authenticated live connection with explicit client capabilities.
Examples are `remoteDesktop`, `nativeAuthCallback`, and `safariSessionTransfer`.
Scope them to the authenticated viewer and active connection. Expire them on disconnect.
Do not infer transfer support from “iOS” or from a saved push token.
Account for a user with several active clients and for conversations with several users.

Keep request state in one runtime owner. Bind each request to its viewer, session,
computer, origin, and expiry. Accept a completion only once.
Send the session material directly through the authenticated transfer path.
Never include cookie values in tool results, transcript messages, or logs.
Use the existing browser owner for import and verification.

## iOS computer control

Feasible first implementation: a dedicated Computer screen with a bundled web
viewer inside `WKWebView`. Reuse noVNC and the existing authenticated RFB route.
Use the current mobile transport/grant owner. Do not put durable credentials in URLs.
The native bridge and web viewer must have a narrow, reviewed message contract.

Start in view-only mode. Add explicit control, a relative trackpad, keyboard,
paste, scrolling, right-click, and drag. Preserve input mode across taps.
Handle rotation, keyboard insets, app backgrounding, and reconnects.
The controlled computer is the VM. This does not mean controlling other iOS apps.

## Experiment acceptance

Prove the Safari extension route on one selected site and one paired computer.
Verify a protected page in the same Chrome tab the agent uses.
Test cancellation, expiry, replay, and a wrong-computer completion.
Use remote takeover if the site's login cannot transfer.

For a native screen implementation, add a Maestro plan and run
`bun run test:e2e --plan <name> --record` as required by `mobile/AGENTS.md`.
Cover repeated tap-then-drag, keyboard input, rotation, and reconnect.

## Web trackpad finding

The synthetic press reaches noVNC's canvas and installs its window capture proxy.
The old synthetic release also went straight to the canvas. noVNC stops event
propagation there, so its window proxy never released the full-screen capture layer.
That layer intercepted the next touch above the trackpad.

`dispatchComputerMouse` now sends the release through the window proxy.
noVNC forwards it to the canvas and clears its own capture.
The regression tests use the installed noVNC input handlers and capture layer.
They reproduced the failure before the routing change.
