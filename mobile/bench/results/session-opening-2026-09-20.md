# Session opening verification — 2026-09-20

Base: `475c10b98`. Target: native iOS client. No deployment or OTA release.

## Behavior

- Account-scoped saved session rows and recent transcript tails survive restart.
- Home shows saved rows while the computer reconnects. Before the project roster
  arrives, those rows are not hidden by an unavailable project filter.
- Start opens a pending conversation screen before the create request completes.
  The prompt stays visible. Completion replaces that screen with the real session.
- Transcript reveal waits for two stable frames, with a 300 ms upper bound after
  content arrives. This is not a bound on network response time.

## Checks

- 91 focused tests passed, 1,143 assertions.
- 34 mounted native check files passed. One existing transcript-body harness is
  quarantined because its native mocks cannot import the current module graph.
- Mobile and root TypeScript checks passed. Mobile check repeated after the
  reconnect project-filter fix.
- Release simulator build passed in the private Mac build directory.
- Recorded `instant-opening`: 8/8 steps passed. Includes cached reopening,
  navigation while creation is pending, and the accepted conversation.
- Recorded `cached-restart`: 2/2 steps passed on the final binary. Saved Home
  rows appeared during bootstrap, and the saved conversation opened. Both
  recordings were inspected visually.

The test uses explicit demo-only delays: 90 seconds for bootstrap, 60 seconds
for creation, and five seconds for history/list reads. Maestro inspection and
input add substantial overhead. Step durations are not app latency benchmarks.
No physical-device performance claim is made.

## Wider suite

The full repository run reported 3,967 pass, one skip, 16 failures and one error.
A stale client prerequisite was rebuilt; the affected first-run test then passed.
The remaining failures cover existing source-string UI assertions, plan fallback,
fleet status, keyboard shortcuts, dialog layout and thinking-row tests. The full
suite is not green. These failures are outside the focused checks above.

## Test isolation

Device: `omg instant 921dce`, `5BC928D3-6891-49B4-BAAD-2D618A1B8B55`.
Mac source: `~/.omg-e2e-instant-921dce`. Maestro driver port: `7119`.
An isolated CLI driver is used because MCP does not forward the driver port.
The build script now propagates Xcode errors instead of accepting an old binary.
