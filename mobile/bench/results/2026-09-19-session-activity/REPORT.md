# Five sessions, three loading animations

The native grid plus one title pulse brings this five-row fixture from
22.48 to 59.56 UI callbacks per second. The original grid is the main cost.
Per-letter title updates add cost when combined with the grid.

## Results

Median of two samples per case. All runs use production JavaScript on the
same iPhone 17 simulator. Values are Reanimated UI callback rates, not GPU
presentation measurements.

| Five mounted rows | Original views + letter title | Shader + letter title | Shader + one title pulse |
| --- | ---: | ---: | ---: |
| All idle | 60.00 | 60.00 | 60.00 |
| Three working, grid and title | 22.48 | 53.10 | 59.56 |
| Three working, grid only | 28.91 | 60.00 | 60.00 |
| Three working, title only | 59.64 | 59.86 | 60.00 |
| Three working, pane covered | 59.81 | 59.94 | 60.00 |

For the complete loading animation, median JS p95 frame interval was
18.07 ms originally and 17.51 ms after the change. The small-list failure
primarily affects the UI thread in this fixture. The earlier session's
large-list JS stalls do not describe this three-working-row case.

## Implementation

- Use the existing Skia work from `2fe2731d9` with the shader compilation fix.
  Each active field uses one canvas instead of hundreds of dot views.
- Replace per-letter animated colours with one 75–100% title opacity pulse.
  Keep native shaping, truncation, the complete accessibility label, and
  full opacity with Reduce Motion.
- Keep the existing row clock, fade, background pause, and pane visibility
  owner. Keep the view fallback for binaries without Skia.
- Report the renderer selected by the field itself. Clear Metro's cache
  between runs. Give each run an ID, reject stale reports, and deduplicate
  retries. These changes prevent cached overrides and queued requests from
  being mistaken for results from the current renderer.

The three-row case does not require a list virtualization rewrite or a
shared list canvas to reach the simulator's 60 Hz callback rate.

## Method and raw evidence

`bench/session-activity-entry.tsx` renders the actual field and title
components at 80-point row height with a 16-point inset. It keeps five rows
mounted and varies activity and decoration. It does not run the full session
list data pipeline. Each trial has a 3-second warmup and an 8-second sample.
Each case appears twice in reverse order. The full Home screen is checked
separately by the recorded Maestro plan.

The run sequence was original, shader with letter titles, optimized, original
again, then final optimized. The repeat of the original code remained slow.

- `initial-views.jsonl`: first baseline. Trial 8 was lost by the original
  collector. This file is retained for provenance, not used for the table.
- `views-repeat-raw.jsonl`: original activity module from `87fc5f8b4`, plus
  a renderer diagnostic export. Use the ten rows with `renderer: "views"`.
  The first row is an explicitly excluded delayed POST from the aborted
  prior run (`renderer: "shader"`, trial 5). This incident prompted run IDs.
- `shader-letter-title.jsonl`: ten samples from the native grid with the old
  per-letter title. This run completed before changing the title.
- `shader-pulse-title.jsonl`: first optimized run, ten samples.
- `final-shader-pulse-title.jsonl`: final optimized run, ten unique samples
  under one run ID. All report `dev: false` and `renderer: "shader"`.
- `environment.json`: versions, fixture settings, and source hashes.

The original run used the original activity module, not just an environment
flag. The diagnostic export was needed because importing shader availability
separately does not prove that the field actually uses it.

## Verification and limits

Mobile typecheck passed. All 31 runnable native check files passed. The
existing `transcript-body.native-check.tsx` quarantine remains. The title
check covers one animated surface, complete Unicode text, accessibility,
truncation, pulse bounds, idle opacity, and Reduce Motion.

The dependency audit passed with the two existing accepted `image-size`
advisories. Collector probes returned 409 for a stale run and 200 for a
repeated sample without appending it again.

This is a shared simulator with other simulators active. It uses production
JavaScript in a development native binary. These numbers do not establish
physical-phone FPS, GPU presentation timing, battery use, or performance with
24 active rows. Installed app version was read back as 1.0.10 (1).

This session prepares a local implementation. It does not merge, release,
submit to the store, or publish an OTA. The native improvement requires a
binary containing Skia. Older binaries retain the view fallback.

The recorded full-app check passed all three steps:
`OMG_SIM_DEVICE='iPhone 17' bun run test:e2e --plan session-activity --record`.
It shows working rows, opens the working session transcript, and returns to
Home with both working rows present. The successful run took 31.5 seconds.
The first plan attempt selected the composer; naming the existing session row
explicitly corrected the test instruction. No product change was needed for
that navigation failure. The recording uses the development client and is
not a signed release-binary check.
