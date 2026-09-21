# Session opening

The phone restores recent session rows and transcript tails from an account-scoped
AsyncStorage snapshot. The provider opens that snapshot after confirming the
signed-in account. Computer and session IDs separate records within the account.
Sign-out clears the snapshot and the in-memory transcript cache.

The cache is a preview, not an authority. REST and live events remain the owners
of current session state. Home draws the saved rows as the SAME screen it becomes
once the computer answers: the folder roster is cached with them, so the rail
keeps its pills and the rows stay filtered by the selected folder instead of
appearing as one flat list and then regrouping. Nothing labels the list as
saved. The greeting in the top bar reads "Reconnecting…" while the machine has
not answered, in the normal label colour, and the readiness block stays off a
screen that already has rows. Authentication still needs a connection. A cache cannot authenticate an
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
POST. That route is the real chat screen, not a waiting page in front of it. It
mounts `SessionScreenBody` with no session id and the typed prompt as the first
row. When the POST resolves, the id is handed to the same mounted screen. There is
no second screen and no `router.replace`, so nothing transitions. A message typed
before the id lands waits for the id, then takes the plain send path.
`screenKey` keeps the instance mounted while the id changes under it. Only a
creation failure shows a separate page, which keeps the prompt readable. The
existing prompt stash records failed sends. The Home list refresh runs in the
background.

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
- Static flow `e2e/instant-opening.yaml` for the Start step. The Jev picker keeps
  choosing the composer over the Start button, because the composer's label is
  the typed prompt. The flow taps the button by name instead. It needs the same
  demo build as the plan.

Use a private Mac build directory when the shared directory is in use:
`OMG_E2E_REMOTE_SRC=.omg-e2e-<session>`. Set `OMG_SIM_DEVICE` to an exclusive device.
Set `OMG_MAESTRO_DRIVER_PORT` to an unused port for concurrent Maestro runs.
This uses the CLI adapter because MCP does not forward that option.
The default MCP driver can inspect another simulator despite the device ID.
Do not copy Xcode DerivedData between paths. The runner now stops on build errors
and saves the full native build log next to the remote `ios` directory.
