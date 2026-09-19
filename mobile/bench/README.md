# Native transcript benchmark

This standalone entry renders the product TranscriptRow and Markdown components.
It has no login or network data dependency. It is not reachable from the product
entry. Run it with an installed omg development client that supports RN 0.86.2.

From mobile/:

```sh
bun install --frozen-lockfile
TRANSCRIPT_PERF_OUTPUT=/tmp/transcript-perf.jsonl bun scripts/benchmark-transcript.ts --production
```

The runner starts Metro on 127.0.0.1:8096 and a result collector on
127.0.0.1:8098. It temporarily selects the benchmark entry in package.json and
restores the product entry on exit. Do not run two copies in one checkout.
Omit --production for a development run with React Profiler measurements.

Forward both ports to the Mac, then open the client on a specific simulator:

```sh
ssh -N -R 8096:127.0.0.1:8096 -R 8098:127.0.0.1:8098 bennykok@bennys-macbook-pro-2
# In another terminal, substitute your chosen simulator UDID:
ssh bennykok@bennys-macbook-pro-2 "xcrun simctl terminate UDID dev.omg.computer; xcrun simctl openurl UDID 'omg://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8096'"
```

The benchmark runs six trials in ABBAAB order. Each uses the same 40 rows,
initial render count, padding, and four linear native scroll legs over 16 seconds.
A 50ms timer updates the streaming tail. Baseline uses the original Markdown
path and ordinary state updates. Optimized uses memoized VirtualView bodies and
transition updates. Both rebuild item wrappers when the draft changes.

Results are appended as JSONL. JS requestAnimationFrame intervals measure JS
responsiveness, not display FPS. updatesReceived counts timer callbacks served;
it is not a network throughput measurement. React render duration is available
only in development. UI callback intervals come from Reanimated. Check their
sample coverage against wall time before interpreting them as display timing.
mountAndWarmupMs includes a five-second warmup; it is not startup latency.

--production uses minified production JavaScript inside a development native
client. It is not a store release or a physical-device benchmark. Simulator
results do not establish a 120Hz guarantee, battery gain, or memory gain.

After the trials, an inspection screen shows the real rows. Open and dismiss the tool sheet, then
expand the first user message. Scroll to Bottom, then Top. Check expansion state,
row positions, and the Resize control. Capture screenshots before and after.
Stop the runner and the SSH forward when done. Restore the simulator's normal
client entry if it was in use before the benchmark.

Focused behavior checks (from the repository root, after root and mobile installs):

```sh
bun test ./mobile/scripts/transcript-body.native-check.tsx
TRANSCRIPT_FALLBACK=web bun test ./mobile/scripts/transcript-body.native-check.tsx
TRANSCRIPT_FALLBACK=old-client bun test ./mobile/scripts/transcript-body.native-check.tsx
```

These use the shared DOM harness and a native visibility-event mock. They check
memoization, restoration of updated hidden content, the lifetime of the surrounding
row, and fallback rendering. They do not substitute for the simulator checks.
The checks are opt-in so the default runtime test suite does not require the
separate mobile dependency install.

## Session activity: five sessions, three working

From `mobile/`, run:

```sh
ACTIVITY_PERF_OUTPUT=/tmp/activity.jsonl bun scripts/benchmark-session-activity.ts --production
```

Use ports 8094 (Metro) and 8095 (collector) with the same SSH forwarding
procedure above. Select an unused simulator and hold its device lock. The
installed development client must contain Skia to measure the shader. Each
result reports the actual `renderer`; a fallback is not a shader result.
`EXPO_PUBLIC_OMG_ACTIVITY_RENDERER=views` forces the old field renderer.

The ten trials keep five rows mounted. They compare all idle, three working,
grid only, title only, and a covered pane. Each case runs twice in reverse
order, with three seconds of warmup and eight seconds of measurement. This
isolates the reported small-list problem from offscreen row count. Restart
Metro between code variants because the runner disables watch mode. The runner
clears Metro's cache so an inlined renderer environment override cannot leak
from a previous run.

Use production JavaScript (`dev: false`) for comparisons. This is still a
development native binary on a shared simulator, not a release binary on a
phone. UI FPS is the Reanimated callback rate, not a measurement of presented
GPU frames. Check coverage, repeat agreement, and idle controls. JS p95 is a
separate measure. A lost report is retried after measurement. Run IDs reject queued reports from
a previous client, and duplicate retries are ignored. Check for all ten
trial indices before drawing conclusions. Keep raw results with the report.

Stop the runner and forwarder after use. The runner restores the app entry.
