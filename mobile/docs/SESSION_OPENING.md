# Session opening

The phone restores recent session rows and transcript tails from an account-scoped
AsyncStorage snapshot. The provider opens that snapshot after confirming the
signed-in account. Computer and session IDs separate records within the account.
Sign-out clears the snapshot and the in-memory transcript cache.

The cache is a preview, not an authority. Home labels saved rows while the
computer reconnects. REST and live events remain the owners of current session
state. Authentication still needs a connection. A cache cannot authenticate an
offline user or grant access to a computer.

Snapshots expire after seven days. Storage is bounded to 64 records and four
million JSON characters; individual records above 512 Ki characters are skipped.
Writes are coalesced for 300 ms and flushed when the app leaves the foreground.
Transcript tails contain up to 40 settled messages. Optimistic sends are excluded.
A corrupt snapshot or storage failure falls back to normal network loading.

The session screen initially mounts its last 12 grouped transcript items. It
reveals after two frames without a content-size change, with a 300 ms ceiling for
continuous streaming. A completed empty history request reveals the empty screen.
Older local history still expands before another server page is requested.

Starting a conversation navigates immediately to `/session/new`. The request is
owned by `pending-session.ts`, so leaving the screen does not cancel or repeat the
POST. The screen shows the prompt and creation status, then replaces itself with
the real session. That screen keeps the prompt visible until history arrives.
Errors keep the prompt readable. The existing prompt stash records failed sends.
The Home list refresh runs in the background.

## Verification

- Focused cache, status, incremental transcript, and creation checks.
- Mounted native checks for restored text, pagination, creation errors, and leaving
  a pending creation without later navigation.
- Mobile and root TypeScript checks.
- Recorded Release simulator plans: `instant-opening` and `cached-restart`.
  These use the opt-in demo fixture `EXPO_PUBLIC_OMG_OPENING_FIXTURE=1` alongside
  `EXPO_PUBLIC_OMG_DEMO=1` and `EXPO_PUBLIC_OMG_PERFORMANCE_FIXTURE=1`.
  The fixture delays bootstrap by ninety seconds, history/list reads by five
  seconds, and creation by sixty seconds.
  It cannot affect the real transport.

Use a private Mac build directory when the shared directory is in use:
`OMG_E2E_REMOTE_SRC=.omg-e2e-<session>`. Set `OMG_SIM_DEVICE` to an exclusive device.
Set `OMG_MAESTRO_DRIVER_PORT` to an unused port for concurrent Maestro runs.
This uses the CLI adapter because MCP does not forward that option.
The default MCP driver can inspect another simulator despite the device ID.
Do not copy Xcode DerivedData between paths. The runner now stops on build errors
and saves the full native build log next to the remote `ios` directory.
