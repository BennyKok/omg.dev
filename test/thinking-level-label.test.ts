import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = () => readFile("web/src/App.tsx", "utf8");

/**
 * The source between two markers, or a hard failure if either is missing.
 *
 * These tests assert on App.tsx's text, so a rename used to turn a region into
 * "" — and every `expect(region).not.toContain(...)` on an empty string passes.
 * A region that silently stops covering anything is worse than a red test: it
 * reads as "still checked". Missing or misordered markers now throw.
 *
 * Markers are prefixes, not exact signatures, so adding a generic parameter to
 * a function does not break them.
 */
function region(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  if (start < 0) throw new Error(`region start marker not found: ${from}`);
  const end = source.indexOf(to, start + from.length);
  if (end < 0) throw new Error(`region end marker not found after "${from}": ${to}`);
  return source.slice(start, end);
}

describe("thinking level menu", () => {
  test("uses a stable Thinking label while retaining the level choices", async () => {
    const source = await app();
    const pill = region(source, "function ThinkingLevelPill(", "function ModelPicker(");

    expect(pill).toContain('>Thinking</span>');
    // Immersive path is slider-only; non-immersive still has a native select.
    expect(pill).toContain('aria-label="Thinking"');
    expect(pill).toContain("title={`Thinking: ${value}`}");
    expect(pill).toContain("{levels.map((item) => (");
    expect(pill).not.toContain('aria-label="Thinking level"');
  });

  test("all composer surfaces use the shared labeled menu", async () => {
    const source = await app();
    expect(source.match(/<ThinkingLevelPill/g)?.length).toBe(3);
    expect(source).not.toContain('aria-label="Thinking level"');
  });

  test("uses Thinking for the live-session menu label", async () => {
    const source = await app();
    const submenu = region(
      source,
      "function SessionThinkingLevelSubmenu(",
      "function SessionTitleSheet(",
    );

    expect(submenu).toContain('<span className="flex-1">Thinking</span>');
    expect(submenu).toContain("<DropdownMenuLabel>Thinking level</DropdownMenuLabel>");
  });

  test("shares the immersive hold-and-slide control across launch surfaces", async () => {
    const source = await app();
    const control = region(source, "function ThinkingSignal(", "function ModelPicker(");
    const forkDialog = region(
      source,
      "function ForkSessionDialog(",
      "function useOrganicActivityPresence(",
    );
    // No trailing "(" — AgentModelRow is generic, so its signature opens with "<".
    const autoPicker = region(source, "function AgentModelRow", "function BottomSheet(");

    // New-session composer, fork dialog, and finding/auto-agent picker.
    expect(source.match(/\simmersive\s*\/>/g)?.length).toBe(3);
    expect(forkDialog).toContain("immersive");
    expect(autoPicker).toContain("immersive");
    expect(control).toContain("THINKING_HOLD_MS");
    expect(control).toContain("thinkingScrubStepWidth");
    expect(control).toContain("applyScrub");
    // Both triggers spread the one gesture engine's pointer props.
    expect(control.match(/\{\.\.\.scrub\.pointerProps\}/g)?.length).toBe(2);
    expect(control).toContain(
      "Math.round(startIndexRef.current + travel / thinkingScrubStepWidth(levels.length))",
    );
    // Axis lock: sideways OR upward travel drives the scrub, so a trigger
    // pinned to the bottom-right corner is still reachable.
    expect(control).toContain("THINKING_AXIS_LOCK_PX");
    expect(control).toContain('axisRef.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y"');
    expect(control).toContain('applyScrubTravel(axisRef.current === "x" ? dx : -dy)');
    // Slider-only: no dropdown menu after scrub / on tap.
    expect(control).not.toContain("<DropdownMenu");
    expect(control).not.toContain("DropdownMenuContent");
    expect(control).not.toContain("ChevronDown");
    expect(control).not.toContain("chooseLevel");
    expect(control).not.toContain("menuOpen");
    // Horizontal intent opens the scrubber immediately.
    expect(control).toContain("beginScrub(event.currentTarget)");
    expect(source).toContain("Math.max(34, Math.min(52, 240 / Math.max(1, levelCount - 1)))");
    // Haptics: arm on pointer down, engage on hold, tick each level, success on release.
    expect(control).toContain('haptic("light")');
    expect(control).toContain('haptic("heavy")');
    expect(control).toContain('haptic("medium")');
    expect(control).toContain("feedback.success()");
    // The pill's affordance lives on the trigger itself. A tap-to-open path was
    // added after the gesture, so assert the discoverability, not the old hint
    // string that described a hold-only control.
    expect(control).toContain(
      'title="Click for the slider — or hold and slide, or use the arrow keys"',
    );
    expect(control).toContain("scrub.toggleSticky(event.currentTarget)");
    expect(control).toContain("createPortal(");
    // The pill mirrors the level under the finger, so trigger and panel agree —
    // for a live drag AND for a panel left open by a tap.
    expect(control).toContain(
      "const shown = scrub.scrubbing || scrub.sticky ? scrub.previewLevel : value",
    );
    expect(control).toContain("<ThinkingSignal value={shown} levels={levels} />");
    expect(control).toContain("{thinkingLevelLabel(shown)}");
    expect(control).toContain('WebkitTouchCallout: "none"');
    expect(control).toContain("document.getSelection()?.removeAllRanges()");
    expect(control).not.toContain("<BrainCircuit");

    // Reachable without a pointer: the pill is a real slider with arrow keys.
    expect(control).toContain('role="slider"');
    expect(control).toContain("aria-valuenow={currentIndex}");
    expect(control).toContain("aria-valuetext={value}");
    expect(control).toContain("scrub.nudge(step)");
    // Escape aborts an open scrub without committing.
    expect(control).toContain('if (event.key !== "Escape") return');
    expect(control).toContain("finishScrub(false)");
  });

  test("Start scrubs on an upright bar driven by vertical travel only", async () => {
    const source = await app();
    const hook = region(source, "function useThinkingScrub(", "function ComposerThinkingControl(");
    const button = region(source, "function ComposerStartButton(", "function ModelPicker(");
    const css = await readFile("web/src/index.css", "utf8");

    // Start is corner-pinned, so sideways is not a direction it can offer.
    expect(button).toContain('orientation: "vertical"');
    expect(button).toContain("Hold and slide up to set thinking effort");
    // The pill keeps the horizontal bar and its axis-lock.
    const pill = region(
      source,
      "function ComposerThinkingControl(",
      "function ComposerStartButton(",
    );
    expect(pill).not.toContain('orientation: "vertical"');

    // Vertical mode ignores horizontal travel entirely rather than axis-locking
    // — it only ever consumes clientY — so a drag that wanders sideways off the
    // button still reads cleanly.
    expect(hook).toContain("if (vertical) {");
    expect(hook).toContain("applyAbsoluteScrub(clientY)");
    expect(hook).toContain('const vertical = orientation === "vertical"');
    // Bar travel is derived from the gesture's own step width => 1:1 on screen.
    expect(hook).toContain(
      "(levels.length - 1) * thinkingScrubStepWidth(levels.length)",
    );
    expect(hook).toContain('"--thinking-travel": `${verticalTravelPx}px`');
    // Upright panel always opens above — that is where the thumb is heading.
    expect(hook).toContain('setPlacement("above")');

    // Ticks and stop names share one offset helper, which is what keeps a
    // label aligned with its own tick.
    expect(source).toContain("function thinkingStopOffset(");
    expect(source).toContain("return vertical ? { bottom: offset } : { left: offset }");
    expect(hook).toContain("thinkingStopOffset(index, levels.length, vertical)");
    expect(hook).toContain("thinkingStopOffset(index, levels.length, true)");
    expect(hook).toContain('className="thinking-scrubber-stops"');
    expect(hook).toContain('data-orientation={orientation}');

    expect(css).toContain('.thinking-scrubber[data-orientation="vertical"]');
    expect(css).toContain(".thinking-scrubber-stops");
    expect(css).toContain("--thinking-travel");
    // Fill grows from the bottom and the thumb rides `bottom`, not `left`.
    expect(css).toContain("inset-block: auto 0");
    expect(css).toContain("bottom: var(--thinking-thumb-left)");
  });

  test("the horizontal bar is never laid out as a flex item", async () => {
    const css = await readFile("web/src/index.css", "utf8");
    // The bar's children are all absolutely positioned, so it has zero content
    // width. Making its wrapper a flex container collapsed the horizontal bar
    // to 0px while the labels below kept full width. The row layout therefore
    // belongs only to the upright panel.
    expect(css).toContain(
      '.thinking-scrubber-panel[data-orientation="vertical"] .thinking-scrubber-body',
    );
    // No unscoped `.thinking-scrubber-body { ... }` rule may exist.
    expect(css).not.toMatch(/^\s*\.thinking-scrubber-body\s*\{/m);
  });

  test("the upright gesture tracks the finger absolutely on the bar", async () => {
    const source = await app();
    const hook = region(source, "function useThinkingScrub(", "function ComposerThinkingControl(");

    // Absolute: the pointer is mapped onto the bar's measured stop positions,
    // not accumulated from where the press landed.
    expect(hook).toContain("applyAbsoluteScrub(clientY)");
    expect(hook).toContain("const bar = barRef.current");
    expect(hook).toContain("bar.getBoundingClientRect()");
    expect(hook).toContain("const lowStop = rect.bottom - thumbPx / 2");
    expect(hook).toContain("const highStop = rect.top + thumbPx / 2");
    expect(hook).toContain("commitPreviewIndex(Math.round(ratio * (levels.length - 1)))");
    expect(hook).toContain("ref={barRef}");
    // Thumb size is derived from the bar's real height minus the travel we set.
    expect(hook).toContain("const thumbPx = Math.max(0, rect.height - verticalTravelPx)");

    // The panel opens above the press, so the finger starts off the bar. Until
    // it arrives the level must not move — otherwise a press-and-release with
    // no real drag would silently launch at the lowest effort.
    expect(hook).toContain("if (!absoluteEngagedRef.current)");
    expect(hook).toContain("if (clientY > lowStop) return");
    expect(hook).toContain("absoluteEngagedRef.current = false");

    // The horizontal pill keeps relative travel.
    expect(hook).toContain('applyScrubTravel(axisRef.current === "x" ? dx : -dy)');
  });

  test("level names are capitalised in JS, not left to text-transform", async () => {
    const source = await app();
    // Chromium drops `text-transform: capitalize` on the upright bar's
    // absolutely-positioned stop labels, so the strings are title-cased before
    // they ever reach the DOM.
    expect(source).toContain("function thinkingLevelLabel(");
    expect(source).toContain("level.charAt(0).toUpperCase() + level.slice(1)");
    const scrubberSurfaces = region(source, "function useThinkingScrub(", "function ModelPicker(");
    // Every surface that prints a level goes through the helper: the panel
    // caption, both stop variants (interactive + static) in each orientation,
    // and the pill. An exact tally used to live here and rotted the moment the
    // Start button stopped echoing the level, so assert the property instead —
    // no level name may reach the DOM raw.
    expect(scrubberSurfaces.match(/thinkingLevelLabel\(/g)?.length).toBeGreaterThanOrEqual(5);
    for (const raw of ["level", "previewLevel", "shown", "value"]) {
      expect(scrubberSurfaces).not.toMatch(new RegExp(`>\\s*\\{${raw}\\}\\s*<`));
    }
  });

  test("the scrub drag is consumed rather than smearing a text selection", async () => {
    const source = await app();
    const hook = region(source, "function useThinkingScrub(", "function ComposerThinkingControl(");
    const triggers = region(source, "function ComposerThinkingControl(", "function ModelPicker(");
    const css = await readFile("web/src/index.css", "utf8");

    // `user-select: none` on the trigger is not enough — the browser anchors a
    // selection on press and extends it over whatever the drag passes over.
    expect(source).toContain("function preventThinkingDragDefault(");
    expect(hook).toContain(
      'document.addEventListener("selectstart", preventThinkingDragDefault, true)',
    );
    expect(hook).toContain(
      'document.addEventListener("dragstart", preventThinkingDragDefault, true)',
    );
    // Armed on press, so the drag that *opens* the scrubber is swallowed too.
    expect(hook).toContain("guardSelection();");
    // Released on pointer up, pointer cancel, and unmount — no leaked listener
    // that would silently break selection everywhere else in the app.
    expect(hook.match(/releaseSelectionGuard\(\);/g)?.length).toBe(3);

    // While the panel is up the whole page belongs to the gesture.
    expect(hook).toContain('document.body.classList.add("thinking-scrubbing")');
    expect(hook).toContain('document.body.classList.remove("thinking-scrubbing")');
    expect(css).toContain("body.thinking-scrubbing");
    expect(css).toContain("user-select: none !important");
    expect(css).toContain("cursor: grabbing");

    // Both triggers opt out of selection themselves. Start used to be missing
    // this while the pill had it.
    expect(triggers.match(/(?<![A-Za-z])userSelect: "none"/g)?.length).toBe(2);
    expect(triggers.match(/WebkitUserSelect: "none"/g)?.length).toBe(2);
    // And neither may be dragged or long-press-called-out.
    expect(triggers.match(/WebkitTouchCallout: "none"/g)?.length).toBe(2);
    expect(triggers.match(/touchAction: "none"/g)?.length).toBe(2);
  });

  test("holding Start opens the scrubber and releasing sets the level and launches", async () => {
    const source = await app();
    const button = region(source, "function ComposerStartButton(", "function ModelPicker(");

    // Start still submits the form on a plain tap.
    expect(button).toContain('type="submit"');
    // Hold raises the same scrubber the pill uses, captioned for launching.
    expect(button).toContain("useThinkingScrub(");
    expect(button).toContain('caption: "Start thinking"');
    expect(button).toContain("{...scrub.pointerProps}");
    expect(button).toContain("{scrub.panel}");
    // Release commits the scrubbed level AND launches, in one gesture.
    expect(button).toContain("onCommit: (next) => onLaunch(next)");
    // ...and the browser's trailing click must not submit a second time.
    expect(button).toContain("if (scrub.consumeSuppressedClick())");
    expect(button).toContain("event.preventDefault()");
    // The button deliberately does NOT react to the scrub — no label, icon,
    // ring or scale swap. The floating panel carries the live level, so the
    // thing under the thumb holds still while the finger drags over it.
    expect(button).toContain("<span>Start</span>");
    expect(button).not.toContain("scrub.scrubbing ?");
    // Agents with no reasoning knob get a plain button (levels list is empty).
    expect(button).toContain("const holdable = !disabled && thinkingLevels.length > 1");

    // The composer wires the gesture's level straight into the launch payload
    // rather than reading state that has not re-rendered yet.
    expect(source).toContain(
      "function submit(e?: FormEvent, overrideText?: string, overrideThinking?: ThinkingLevel)",
    );
    expect(source).toContain("const launchThinkingLevel = overrideThinking ?? thinkingLevel");
    expect(source).toContain("thinkingLevels={agentSupportsThinking(agent) ? thinkingLevels : []}");
    expect(source).toContain("submit(undefined, undefined, next)");
    // A press that opened the scrubber owns its trailing click even when the
    // scrub was abandoned — cancelling must not fall through to "start anyway".
    expect(source).toContain("if (!gestureOpenedRef.current) return");
  });

  test("hold-to-scrub panel uses a thick track and rounded-square thumb with morphing accent", async () => {
    const source = await app();
    // The panel is owned by the shared gesture engine, so the pill and Start
    // raise the exact same surface.
    const control = region(source, "function useThinkingScrub(", "function ComposerThinkingControl(");
    const css = await readFile("web/src/index.css", "utf8");

    expect(control).toContain('className="thinking-scrubber"');
    expect(control).toContain("thinking-scrubber-track");
    expect(control).toContain("thinking-scrubber-matrix");
    expect(control).toContain("thinking-scrubber-fill");
    expect(control).toContain("thinking-scrubber-thumb");
    expect(control).toContain("thinking-scrubber-halo");
    expect(control).toContain("thinkingAccentColor(previewProgress)");
    expect(control).toContain('"--thinking-progress": previewProgress');
    expect(control).toContain('"--thinking-accent": previewAccent');
    // Dedicated solid panel class — not a faint utility bg over the composer.
    expect(control).toContain('className="thinking-scrubber-panel"');
    expect(css).toContain(".thinking-scrubber-panel");
    expect(css).toContain("background: #1c1c1e");
    // Every stop is named while the labels fit; past 5 levels the row falls
    // back to the two endpoints (not Faster/Deeper) so they never overlap.
    expect(control).toContain(
      "levels.length <= 5 ? levels : [levels[0]!, levels[levels.length - 1]!]",
    );
    expect(control).toContain('data-active={level === previewLevel ? "" : undefined}');
    expect(control).toContain('className="thinking-scrubber-ends"');
    expect(css).toContain(".thinking-scrubber-ends");
    expect(css).toContain(".thinking-scrubber-ends > span[data-active]");
    // One tick per level, pinned to the thumb's travel range, so the number of
    // stops stays readable even when the names collapse to endpoints.
    expect(control).toContain('className="thinking-scrubber-ticks"');
    expect(control).toContain("thinkingStopOffset(index, levels.length, vertical)");
    expect(source).toContain(
      "`calc(var(--thinking-thumb-half) + ${progress} * (100% - var(--thinking-thumb)))`",
    );
    expect(css).toContain(".thinking-scrubber-ticks");
    // Caption names what the gesture will do — "Thinking" vs "Start thinking".
    expect(control).toContain('className="thinking-scrubber-caption-label"');
    expect(css).toContain(".thinking-scrubber-caption");
    // Panel flips above/below the trigger and animates from the right edge.
    expect(control).toContain('placement === "above"');
    expect(control).toContain('"origin-bottom slide-in-from-bottom-2"');
    expect(control).toContain('"origin-top slide-in-from-top-2"');
    expect(css).toContain("padding-inline: 0");
    expect(css).toContain("inset-inline: 0");
    expect(control).not.toContain(">Faster</span>");
    expect(control).not.toContain(">Deeper</span>");
    // Scrub panel no longer titles itself "Thinking" — only the composer pill does.
    expect(control).not.toContain('text-muted-foreground">Thinking</span>');
    // Dot markers replaced by the pixel-matrix track + chunky squircle thumb.
    expect(control).not.toContain("rounded-full bg-popover ring-2");
    expect(control).not.toContain("from-sky-400/35 via-violet-400/55");
    expect(source).toContain("THINKING_ACCENT_STOPS");
    expect(source).toContain("function thinkingAccentColor(");

    expect(css).toContain(".thinking-scrubber-track");
    expect(css).toContain(".thinking-scrubber-matrix");
    expect(css).toContain(".thinking-scrubber-thumb");
    expect(css).toContain("--thinking-matrix-mask");
    expect(css).toContain("border-radius: 0.4rem");
    expect(css).toContain("--thinking-track-height: 1.7rem");
    expect(css).toContain("--thinking-thumb: 1.3rem");
    expect(css).toContain("background: transparent");
    expect(css).toContain("box-shadow: none");
    expect(css).toContain("rgba(0, 122, 255");
    expect(css).toContain("rgba(175, 82, 222");
    expect(css).toContain("rgba(232, 121, 249");
  });
});
