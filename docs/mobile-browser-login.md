# Website login from iPhone

An agent can request a website login with `omg_request_browser_login`.
The user opens the request in the iOS chat and taps **Log in**.
The request is one row at the end of the transcript, not a card on the
composer, because it is an event in the conversation. The row is the website's
icon and domain, a **Log in** button, and a cross to dismiss it. If the icon
cannot load, it shows the first letter of the domain. The reason the agent
gave is in the agent's own message above the row, and the target computer is
named in the native consent alert, so the row repeats neither.
The app opens a private `WKWebView`. After signing in, the user taps
**Use login**, checks the site and target computer, and taps **Transfer login**.
The runtime imports the approved site cookies into its shared Chrome browser.
It then sends a status message to the requesting agent.

The agent must inspect the protected page before treating the login as complete.
`imported` means Chrome retained every approved cookie value. It does not prove authentication.
The importer maps insecure iOS SameSite=None cookies to the browser default.
Chrome otherwise silently discards these cookies. The importer reads back the
cookies before opening the target page and fails if any approved cookie is missing.

## Requirements and limits

- Runtime v0.6.85 or later, with the Computer browser dependencies installed.
- iOS app 1.0.12 or later. The native module requires a new binary, not an OTA.
- A public HTTPS website. Existing Safari cookies are not read.
- Cookies only. Local storage, passkeys, device-bound credentials, and browser
  profiles are not transferred. Some providers reject embedded login.
- The destination is the shared Computer Chrome profile. Agents using another
  browser or profile will not receive the login.
- If native login is unavailable, the web chat offers **Open Computer**.

## Agent tools

`omg_request_browser_login({url, reason})` uses the calling session. It returns
an expiring request and whether a compatible iOS chat client is active.
`omg_browser_login_status({})` returns that session's requests and availability.
Neither tool returns cookie values or can approve a transfer.

A successful transfer sends a new message to the agent through the existing
session send path. If notification fails, the card asks the user to tell the
agent. The agent can then check status. It must not poll in a tight loop.

## Ownership

- `src/computer/login.ts`: request lifecycle and HTTP handler. One instance in
  `serve` owns all state. It validates session ownership, site scope, expiry,
  one-use claims, body limits, and transfer concurrency.
- `src/computer/browser.ts`: import into the existing agent browser via CDP.
- `packages/protocol/src/browser-login.ts`: shared public state and transfer DTOs.
- `mobile/modules/omg-browser-login`: native browser sheet and explicit consent.
- `mobile/src/omg/browser-login-card.tsx`: chat card and active-client heartbeat.
- `web/src/components/browser-login-card.tsx`: status and Computer fallback.
- `src/commands/mcp.ts` and `src/omg-capabilities.ts`: agent tools and guidance.

The native sheet creates a separate, nonpersistent cookie store per request.
It exports matching site cookies only after consent. The server checks their
registrable domain, including private suffixes, before CDP import.
Cookies and claim tokens are not persisted in request state or included in
public status. Browser cookies persist in Chrome under its normal behavior.
Requests expire after ten minutes. Client presence expires after 45 seconds.
A runtime restart clears requests and claims. Ask for a new login after restart.

Hosted requests use the existing authenticated computer transport and trusted
viewer header. Direct local access has the same network trust boundary as the
rest of this runtime. Hosted identity and grants remain owned by `vibes`.

## Verification

Run the backend and MCP tests, web card render tests, and all three type checks.
The native plan is `mobile/e2e/browser-login.plan.json`.

`mobile/e2e/session-inline-cards.plan.json` proves where the card sits and what
it says, against the seeded demo transport. Build it with
`EXPO_PUBLIC_OMG_DEMO=1 EXPO_PUBLIC_OMG_INLINE_CARDS_FIXTURE=1`.

`mobile/scripts/browser-login-e2e-entry.tsx` mounts the production card and native
module against `scripts/browser-login-fixture.ts`. The fixture creates a login
request through the actual MCP tool. Its HTTPS test site sets a Secure, HttpOnly
cookie. The real runtime handler imports it into an isolated Chrome profile and
checks the protected page. No real account or production browser is involved.

Build the simulator harness with `OMG_E2E_ENTRY_FILE=scripts/browser-login-e2e-entry.tsx`
and a dedicated `OMG_E2E_REMOTE_SRC`. Reverse-forward fixture ports 18767 and
19443 to the Mac, trust the fixture certificate only in the test simulator, then
run `bun run test:e2e --plan browser-login --record`. The fixture `/proof`
endpoint must report `verified: true` and `notified: true`.
Normal builds use the Expo Router entry point and have no fixture transport.
