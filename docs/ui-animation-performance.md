# UI animation performance

Measured against `082b7f11b` on 2026-10-21. These are local component
measurements, not production page-load or interaction latency measurements.

## Changes

- Detailed bot avatars animate only while visible. One shared observer handles
  visibility, hidden tabs, and live reduced-motion changes. Offscreen avatars
  retain the current state and resume when scrolled into view.
- Eye blinks use the Web Animations API. They no longer force a layout read to
  restart a CSS animation. State geometry is calculated when the state changes.
- Status labels keep one text node and use a 120 ms opacity fade. They no
  longer measure glyphs or schedule a second mount during browser idle time.
  Their shimmer pauses offscreen and in hidden tabs.
- Incoming chat words fade for 120 ms with no stagger. Message and tool-row
  entrances keep their movement and opacity effects without blur.
- The live header transitions opacity and position. It no longer interpolates
  font size or unrelated layout properties.

## Measurements

Warm Vite development server, headless Chromium, 1280 × 800 viewport. A fixture
mounts 100 rows, each 100 px tall, with eight avatars intersecting the viewport.
Baseline and changed components run on the same page structure and stylesheet.
The avatar sample lasts three seconds after a 2.2-second warmup. Results below
are medians of three alternating baseline/changed runs. Other work was running
on this shared machine, so elapsed CPU timings can vary.

| Avatar metric, three-second sample | Before | After |
| --- | ---: | ---: |
| SVG path writes | 17,600 | 1,448 |
| Blink geometry reads | 78 | 0 |
| Browser main-thread task time | 2,797.6 ms | 833.2 ms |
| Script time | 833.5 ms | 97.2 ms |
| Style recalculation time | 1,200.0 ms | 158.1 ms |

This fixture does about 92% fewer SVG path writes and uses about 70% less
main-thread task time. It is a long-roster stress case, not a claim that every
screen is 70% faster. Visible avatars still animate at the browser frame rate.

A separate fixture mounts 100 status labels and then changes each label once.
Three alternating runs returned the same operation counts:

| Status-label metric | Before | After |
| --- | ---: | ---: |
| Geometry reads during mount | 2,080 | 0 |
| Geometry reads during update | 3,270 | 0 |
| Elements in the fixture | 1,581 | 301 |

The count includes fixture rows and their static text. The improved labels
show the new text immediately. No animation frame updates React state.

## Verification

- Release preflight ran the full repository suite: 5,198 passed initially.
  Missing mobile dependencies and two browser-mock isolation failures were
  resolved. The affected library suite then passed all 735 tests. Re-running
  the remaining failed files on both baseline `082b7f11b` and this change
  produced the same result: 119 passed and 15 existing failures. The full
  repository suite is therefore not green; no production gate was bypassed.
- Fourteen focused tests pass. They cover observer sharing and cleanup,
  offscreen and hidden-tab suspension, live reduced motion, immediate text
  updates without geometry reads, animation cancellation, markdown block
  handling, and session links.
- `cd web && bun x tsc --noEmit` passes. This fresh worktree required the
  protocol package build before the web type check.
- Chromium and WebKit browser checks pass for visible animation, offscreen
  pause, scroll resume, reduced-motion pause, state changes while motion is
  reduced, and preference resume.
- The full local app entry loads without JavaScript errors after Vite dependency
  preparation. This does not verify an authenticated hosted app journey.
- No production bundle was built or deployed. Production interaction latency,
  mobile hardware performance, network time, and server latency remain unmeasured.

The session's `ui-performance-evidence.zip` contains the fixture, baseline
components, browser scripts, raw measurements, and reproduction instructions.
