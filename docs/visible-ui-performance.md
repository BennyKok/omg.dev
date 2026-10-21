# Visible chat and navigation performance

This follows the animation work in v0.6.274. Hosted Computers keep Bots off, so
avatar stress results do not measure the normal hosted UI. This change targets
chat, menus, sidebar resizing, and session selection.

## What changed

- TanStack Virtual caches measurements by the identity of `getItemKey`. The
  inline callback changed on every render. The new hook retains it while the
  row keys are unchanged. Inserts, removals, replacements, and reorders still
  invalidate offsets and preserve measured sizes by message identity.
- The retained tail now includes all 30 rows when the viewport overlaps its
  beginning. The old early return could unmount the live reply and estimate
  its height while the reader was nearby.
- Reading anchors use committed DOM positions. ResizeObserver can update the
  virtualizer before React commits the corresponding transforms. A correction
  deferred during a fling now captures the current position, so a later reply
  cannot apply stale correction debt. Native scroll anchoring is disabled for
  this pane because ChatStream already owns that correction. The follow owner
  also checks an upward user offset before writing the bottom, even if the
  browser has not delivered its scroll event yet. State updates use the input
  captured when the event arrived.
- Sidebar width changes immediately. Menu transitions take 150 ms instead of
  380 ms. Session reveal takes 100 ms instead of 180 ms. Rail rows use a short
  fade without the old stagger. Selection uses a 180 ms outline instead of a
  1.85-second shadow and forced layout restart. Reduced motion remains supported.
- The phone-install QR is encoded on first opening and reused. Closed popups
  no longer encode on parent renders. Streaming markdown retains its plugin
  object until an optional plugin actually loads.

## Evidence

The committed browser fixture uses the actual ChatStream, message components,
markdown renderer, virtualizer, and stylesheet with 1,001 synthetic messages.
It sends 25 visible paragraph updates at the bottom, scrolls into history, sends
15 more updates, and switches sessions. It also suppresses one scroll event
while delivering a stream update to check that a delayed event cannot let
follow overwrite the user's movement. It makes no agent requests.

A Chromium comparison changes only the key callback back to its former inline
form. Other fixes are present in both cases. One paired run produced:

| Height-estimator calls | Inline callback | Stable callback |
| --- | ---: | ---: |
| 25 streamed updates at the bottom | 42,902 | 0 |
| 15 updates while reading history | 14,625 | 0 |
| Session switch | 7,807 | 10 |

The changed browser run kept 30 rows mounted. It stayed at the live bottom,
held the selected reading row with zero pixel movement, and opened the next
session at the bottom. No JavaScript errors occurred. A React/TanStack test
also verifies retained measurements through scroll renders and key changes.

The full local app passed opening and switching chats, four scroll gestures,
three menu cycles, three sidebar cycles, and opening the phone QR. The closed
QR was encoded zero times. These checks use live local session data, so their
operation counts are diagnostic rather than a controlled timing comparison.

Shared-machine load, development transforms, live data, and font timing make
elapsed timings noisy. These are reductions in repeated work, not a claimed
whole-site speed percentage. Production network latency and physical-device
frame rates are not measured by this fixture.

## Checks and limits

- 116 focused tests pass, including key identity, retained tail, row height,
  remeasurement, anchor decisions, scroll following, menus, and QR behavior.
- Web and root TypeScript checks pass.
- The broad suite run had 5,215 passes, two skips, and 16 failures. Fifteen
  match the failures reproduced on the prior baseline. The other failure was
  a source-text assertion for the old range implementation. The obsolete range
  and anchor source assertions were replaced by the executable range tests and
  browser checks. The broad suite is not green.
- The existing audit reports Vite advisory GHSA-587h-7wmj-h5pm. This change
  does not modify dependencies or add an audit exception.
- Chromium verifies native wheel input. WebKit is also checked with simulated
  scrollbar input: pointer intent followed by an offset change and real scroll
  events. Native wheel replay on this Linux WebKit fixture did not move the
  pane reliably, so it is not evidence for Safari trackpad or iOS touch behavior.

## Reproduce the browser check

Use an installed Playwright module and its matching browser binaries. The
module can live outside this repository. Start the web development server on
localhost, then run:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
PERF_BASE_URL=http://127.0.0.1:5174 \
node test/browser/check-chat-performance.mjs changed
```

Set `CHROMIUM_EXECUTABLE` when using a system Chromium. Add `--baseline-keys`
for the isolated callback comparison. Add `--webkit --scrollbar` for the WebKit
anchor check. `--debug-anchors` prints captured and restored anchors.

The runner serves a test document through browser interception and exposes
ChatStream only in the intercepted development response. The fixture is not
imported by the production application. The final JSON records operation
counts, mounted rows, reading movement, scroll distances, and browser errors.
