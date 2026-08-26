# Embed host protocol

OMG runs framed inside omg's Computer surface (`https://<box>/?embed=1`). Embed
mode hides OMG's own header, settings, user picker and onboarding — the host
owns account UX. This document is the contract between the two.

This is one of **two** ways a host mounts OMG — this cross-origin iframe path,
and the same-document native library mount (`@omg-dev/app`'s `OmgAppSurface`,
built by `web/vite.lib.config.ts`), which `app.omg.dev` uses instead. The
native mount shares no postMessage protocol with this one; it has its own DOM
slot contract (`data-lfg-host-slot`) documented alongside the full shell/host
integration inventory in `docs/hosted-shell-inventory.md`. Both flags
(`?embed=1` / `readLocationEmbedFlag()`) and the native mount set the same
`embedded` state inside `App.tsx`, so the header/onboarding suppression this
document describes applies to both.

## Detection

`?embed=1` on the frame URL is the explicit signal; running inside a
cross-origin iframe is accepted as defence in depth. See `web/src/lib/embed.ts`.

## Host → frame

| Message | Meaning |
| --- | --- |
| `{ type: "omg:computer-host-resume" }` | The host tab returned to the foreground. OMG restarts infinite CSS/WAAPI animations that WebKit left suspended (`web/src/embedded-animation-recovery.ts`). |

## Frame → host: `lfg:session-created`

Embedded OMG posts exactly one message, when the framed user creates a session
from this tab:

```js
window.parent.postMessage(
  { type: "lfg:session-created", sessionId: "<omg session id>" },
  hostOrigin, // never "*"
)
```

- **Emitted from** `markCreatedSid()` in `web/src/App.tsx` — the single funnel
  every in-tab `/api/sessions/new` call already goes through. There is no
  second emitter and no new state owner.
- **Emitted when** embed mode is on (`readLocationEmbedFlag()`), the frame has
  a real parent window, and a target origin resolved. Sessions created outside
  this tab (iMessage, CLI, subagents) do not produce the event.
- **Payload** is the two fields above and nothing else. OMG does not read a
  reply, keep host state, or own any billing/upgrade UI — the host decides what
  to do with the signal (e.g. showing its upgrade prompt after the user's first
  session).

### Target origin

Resolved once at document load (`web/src/lib/embed-host-signal.ts`), in order:

1. `?embedOrigin=<absolute http(s) URL>` on the frame URL — an explicit opt-in
   for hosts whose `Referrer-Policy` strips the referrer. Read straight from
   `window.location` at boot, because the router only keeps its typed search
   params (`session`, `embed`) in the URL.
2. `document.referrer` — the embedding page for a framed document.

Only `http:`/`https:` origins are accepted. If neither source yields one, OMG
stays silent rather than posting to `*`.

### Host side

```js
window.addEventListener("message", (event) => {
  if (event.origin !== computerFrameOrigin) return       // the box's origin
  if (event.source !== computerIframe.contentWindow) return
  if (event.data?.type !== "lfg:session-created") return
  onFirstSessionStarted(event.data.sessionId)
})
```

## Frame → host: `lfg:analytics`

Embedded OMG posts one message per tracked event from the embedded onboarding
survey (`web/src/components/embedded-connect-gate.tsx`):

```js
window.parent.postMessage(
  { type: "lfg:analytics", event: "onboarding_survey_question", props: { question: "identity", answer: "founder" } },
  hostOrigin, // never "*"
)
```

- **Shape**: `{ type: "lfg:analytics", event: string, props?: Record<string, string | number | boolean> }`.
  `props` is omitted entirely (not sent as `undefined`) when there is nothing
  to attach. Values are primitives only — no arrays, no nested objects — so
  every prop passes through unchanged into Umami's own `track(event, props)`
  call on the host side.
- **Why this exists**: the survey used to load its own Umami tracker inside
  this iframe. Two problems, both silent: Umami's domain allowlist is gated
  on exact hostnames (`omg.dev`, `app.omg.dev`) and this frame runs on a
  per-Computer sandbox host, so every event was dropped before it left the
  browser; and even with an allowlist fix, a tracker loaded in this iframe is
  a separate document on a separate origin, so it mints its own Umami
  visitor/session that can never join the host's activation events, and
  `identify()` would bind a userId to a visitor with nothing else on it. LFG
  does not own a Umami account and cannot fix either problem from inside the
  frame — the host already runs a same-origin tracker wired to its real
  domain, so the frame posts the event up and the host fires it.
- **Emitted from** `emitAnalyticsToHost()` in `web/src/lib/embed-host-signal.ts`,
  called by the survey's per-question and completion handlers in
  `embedded-connect-gate.tsx`. Fire-and-forget: a blocked or dropped message
  (no listener, postMessage throws, no resolved host origin) never throws,
  never surfaces to the caller, and never blocks or delays onboarding — the
  survey advances to the next question exactly the same either way.
- **Only used by the cross-origin iframe path.** The same-document native
  library mount (`OmgAppSurface`) has no postMessage boundary to cross, so it
  wires an `onAnalyticsEvent(name, data)` prop straight through
  `EmbeddedHostOptionsProvider` instead — see
  `web/src/lib/embedded-host-options.tsx`. `embedded-connect-gate.tsx` calls
  `onAnalyticsEvent` when a host supplied one, and only falls back to posting
  `lfg:analytics` when it did not. Neither path ever tracks from inside this
  library — there is no in-frame Umami tracker to fall back to.
- **Event names** (`snake_case`, surface prefix first): `onboarding_survey_question`
  (props: `question` — `"identity"` or `"pain"`, and `answer` — the selected
  option's value) fires once per distinct answer, never for a skipped one. The
  survey is re-enterable (the connect page after it has a Back button), so
  re-selecting an answer already reported sends nothing; changing it to a
  different option does send again, because that is a real correction.
  `onboarding_survey_complete` (props: `identity`, `pain`, each either the
  answered value or the literal string `"skipped"`) fires exactly once per
  mount, when the 2-question survey is left, however it was left. Enforced by
  a latch rather than by the page flow, because walking Back into the survey
  and leaving it a second time would otherwise report a second completion and
  make the funnel rate wrong.
- **Target origin**: resolved the same way as `lfg:session-created` above —
  see that section. Both messages share one cached resolution per document.

### Host side — what the host must implement

This repository posts the message; the embedding host (a different repo)
owns firing it. Nothing here calls Umami directly.

```js
window.addEventListener("message", (event) => {
  if (event.origin !== computerFrameOrigin) return
  if (event.source !== computerIframe.contentWindow) return
  if (event.data?.type !== "lfg:analytics") return
  umami.track(event.data.event, event.data.props)
})
```

- **`identify()` is the host's job, not the frame's.** The frame has no
  durable userId to bind and no same-origin Umami session to bind it to.
  Call `umami.identify(userId)` on the host's own tracker at survey start
  (e.g. on the first `onboarding_survey_question` event, or whenever the host
  otherwise knows a fresh box has mounted the gate) so every event this frame
  posts up — survey answers included — joins the same visitor as the host's
  own activation events instead of floating unidentified.
- Do not add a domain-allowlist entry for the sandbox hostname instead of
  wiring this listener — that only fixes the dropped-event half of the bug,
  not the split-visitor half.

## Embedded first-run gate

With settings and onboarding hidden, a fresh box has no place to connect a
coding agent. When neither Claude nor Codex is connected, embedded OMG shows a
single card offering those two
(`web/src/components/embedded-connect-gate.tsx`). It drives the existing
`/api/coding-agents/:kind/auth` login and the shared auth dialog; once either
provider reports `configured` (on the CLI kind or its ai-sdk sibling), the card
disappears and the normal session UI renders. Standalone OMG is unchanged — it
still uses `OnboardingFlow`.

The predicate is deliberately scoped to those two providers rather than "any
configured agent": the agent-lfg image ships pi bundled and may carry
OpenCode/Copilot credentials, which would otherwise mark a fresh Computer as
ready and skip the connect prompt the user still needs. A "Skip for now" link
covers people intentionally working on one of those other providers; it is not
persisted, so the gate returns on the next load while nothing is connected.
