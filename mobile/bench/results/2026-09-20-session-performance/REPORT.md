# Session responsiveness

Three changes target separate costs:

- Group settled transcript messages only when those messages change. Drafts reuse completed rows; React.memo skips their bodies.
- Home uses a FlatList window instead of mounting the complete roster. Viewability controls each family's animation within the existing pane visibility owner.
- Session opening mounts the latest 12 grouped items from the fetched 40-message page. Older loaded history expands locally on upward scrolling before another fetch.

The existing memory cache still holds at most 24 sessions, 40 messages each, with an eight-session prefetch sweep. Cache hits now seed the first render. The background request reconciles the page. Pagination no longer seeds the current page from the short cached tail, and the request controls its loading state. The cache does not survive app termination.

## Streaming benchmark

Six trials, ABBAAB, 40 fixed rows and one updated tail at a requested 20 updates/s. Each trial scrolls through the same native path for 16 seconds after a five-second warmup. Both modes use the same Markdown body renderer, transition priority and mounted count. Baseline recreates completed row wrappers; optimized retains them. This isolates row reuse, not the grouping or opening-window savings.

| Median of three trials | Rebuilt wrappers | Stable rows |
| --- | ---: | ---: |
| JS frame interval p95 | 91.73 ms | 17.41 ms |
| JS frames over 50 ms | 195 | 0 |
| Served draft timer callbacks | 195 | 260 |
| Reanimated UI callbacks / wall second | 48.04 | 43.82 |

UI callback counts did not improve. These results support improved JS responsiveness, not improved GPU presentation FPS. Draft counts measure timers served, not network throughput. This was a shared iPhone 17 simulator, production JavaScript in a development native binary. It does not establish physical-phone FPS, memory or battery savings.

Raw results carry one run ID; stale posts are rejected and repeated trial posts are deduplicated. The benchmark runner and tunnel were stopped after all six trials.

## Behaviour checks

Pure tests compare incremental grouping with full grouping across replies, work seams, withdrawn work, interrupted turns, busy state, and simultaneous thought/reply drafts. Identity checks cover 1,000 completed rows. Opening-window checks cover local expansion and replacement of the original anchor.

Mounted native checks cover cached first paint, background refresh, pagination pending state and end-of-history, late responses after session switches, row viewability, and a covered parent pane overriding a visible child.

The opt-in demo stress fixture supplies 64 Home rows in the default folder and 100 messages. It is enabled only with `EXPO_PUBLIC_OMG_DEMO=1` and `EXPO_PUBLIC_OMG_PERFORMANCE_FIXTURE=1`. No real transport uses it.

The release simulator build passed all six `session-performance` plan steps in 50.2 seconds. These cover the long transcript opening at message 100, Home return, cached reopening, and opening a different session without the first session's text. The first attempt passed five steps but Jev did not choose the second row; an explicit row-label instruction resolved this. The final run includes Skia 2.12.0 after refreshing the Mac's cached pods.

Validation: 72 focused tests pass; 33 native check files pass with the existing transcript-body quarantine; mobile and root type checks pass. Full repository suite: 3,925 pass, one skip, 15 failures. Those 15 match the baseline failures verified before the previous deployment. The old source-text opening assertions were replaced with behaviour checks.

The additional Maestro `session-history` flow passed all commands. It opened at message 100, scrolled to message 65 (local window expansion), then message 55 (another server page), and opened Performance session 40 after scrolling the large Home list. The first 30-second scrolling deadline expired on the last movement; the screenshot and accessibility tree contained message 65. The final run used a 90-second deadline per search and passed without product changes.

The static-flow runner now skips generated root-level MP4 recordings when syncing tests to the Mac. Previously it uploaded old captures before any command could run. Nested test fixtures remain included.
