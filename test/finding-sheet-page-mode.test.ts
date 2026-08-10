import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../web/src/index.css", import.meta.url), "utf8");

const slice = (from: string, to: string) => {
  const start = APP.indexOf(from);
  const end = APP.indexOf(to, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
};

const sheet = () => slice("function FindingSheet(", "// Single-box create:");
const bottomSheet = () => slice("function BottomSheet(", "function FindingSheet(");

describe("the sheet morphs into a page for the keyboard", () => {
  test("page mode is sized from the live viewport vars, not a fixed vh", () => {
    // 100dvh does not shrink for the soft keyboard on iOS, so a dvh-sized
    // sheet puts its own composer underneath the keyboard. The two vars the
    // visualViewport sync publishes are the only honest measurements of the
    // band that is actually visible.
    const rule = CSS.slice(
      CSS.indexOf('[data-vaul-drawer-direction="bottom"].lfg-sheet-page'),
    ).slice(0, 400);
    expect(rule).toContain("height: var(--lfg-visual-height");
    expect(rule).toContain("bottom: var(--lfg-keyboard-height");
    expect(rule).toContain("max-height: var(--lfg-visual-height");
  });

  test("the rule outranks the drawer's own bottom/max-height utilities", () => {
    // Vaul's content carries `data-[vaul-drawer-direction=bottom]:bottom-0` and
    // `:max-h-[80vh]`. A bare `.lfg-sheet-page` loses to both on specificity and
    // the sheet silently stays a card.
    expect(CSS).toContain('[data-vaul-drawer-direction="bottom"].lfg-sheet-page');
    // ...and the desktop dialog path has no keyboard to clear.
    const afterRule = CSS.slice(CSS.indexOf(".lfg-sheet-page"));
    expect(afterRule).toContain("@media (min-width: 768px)");
  });

  test("BottomSheet keeps the footer out of the scroller", () => {
    // The footer is what lands on the keyboard; if it scrolls with the body it
    // is not a footer.
    const src = bottomSheet();
    // `paged`, not `page`: the class is driven by the caller's prop OR the
    // sheet's own focus state now (see the expandOnFocus block below).
    expect(src).toContain('paged && "lfg-sheet-page"');
    expect(src).toContain("const paged = page || focusPaged;");
    expect(src).toContain("flex min-h-0 flex-auto flex-col overflow-y-auto overscroll-contain");
    // basis-0 (`flex-1`) contributes nothing to an auto-height sheet, so the
    // compact card can collapse. Class attributes only — the comment above the
    // scroller names the utility it is avoiding.
    expect(src).not.toMatch(/className="[^"]*flex-1/);
    expect(src).toContain('{footer ? <div className="shrink-0">{footer}</div> : null}');
  });

  test("body content is bottom-anchored with margin, not justify-end", () => {
    // A flex-end scroll container clips its own overflow at the top — and this
    // one overflows exactly when the keyboard is up.
    expect(sheet()).toContain('paged && "mt-auto"');
    // Matched against class attributes only — the prose above the scroller
    // names the technique it is avoiding.
    expect(bottomSheet()).not.toMatch(/className="[^"]*justify-end/);
  });
});

describe("the composer is opt-in", () => {
  test("nothing is focused on mount, so the keyboard stays down", () => {
    // The sheet used to focus its composer 250ms after opening: the keyboard
    // covered the finding you tapped in to read, for a surface whose most
    // common answer is the one-tap button.
    const src = sheet();
    expect(src).not.toContain("setTimeout(() => inputRef.current?.focus(), 250)");
    expect(src).toContain('onClick={() => reveal("instruct")}');
    expect(src).toContain('onClick={() => reveal("tune")}');
  });

  test("revealing a field also enters page mode", () => {
    const src = sheet();
    const reveal = src.slice(src.indexOf('function reveal('), src.indexOf("</BottomSheet>"));
    expect(reveal.slice(0, 400)).toContain("setPaged(true)");
  });

  test("focus anywhere in the footer enters page mode", () => {
    // The general rule the reveal buttons are only one instance of: focus a
    // field inside the drawer and the drawer becomes a page.
    expect(sheet()).toContain("if (isTypingTarget(e.target as Element))");
  });
});

describe("any sheet can enter page mode on focus, not just the finding", () => {
  // FindingSheet drove `page` from focus by hand from the start. The auto-agent
  // forms — which are nothing BUT fields — were left as content-sized cards, so
  // they were the ones still being shoved off the top by the keyboard. The
  // behaviour is shared now; these guard that it stays shared.
  test("BottomSheet takes expandOnFocus and enters page mode from a field", () => {
    const src = bottomSheet();
    expect(src).toContain("expandOnFocus = false");
    expect(src).toContain("if (!isTypingTarget(e.target as Element)) return;");
    expect(src).toContain("setFocusPaged(true)");
  });

  test("the auto-agent forms opt in", () => {
    // Both the create and the edit sheet: an edit visit types just as much as
    // a create one.
    expect(APP).toContain('<BottomSheet onClose={onClose} title="New auto agent" expandOnFocus>');
    const edit = APP.slice(APP.indexOf('title={isNew ? "New auto agent" : "Edit auto agent"}'));
    expect(edit.slice(0, 200)).toContain("expandOnFocus");
  });

  test("BottomSheet's own fold-back keeps typed work and inter-field focus", () => {
    // Same two rules FindingSheet applies to its reply box, generalised: any
    // field in the sheet still holding a value pins it open, and focus moving
    // between fields inside the sheet is not "left the sheet".
    const src = bottomSheet();
    expect(src).toContain("contains(deepActiveElement())");
    expect(src).toContain("if (field.value.trim()) return;");
    expect(src).toContain("onPointerDownCapture={cancelExit}");
    expect(src).toContain("useEffect(() => cancelExit, []);");
  });
});

describe("folding back down", () => {
  test("a pointer-down on the footer cancels the pending exit", () => {
    // blur fires before click. Without this the footer's own buttons unmount
    // between the two and the tap does nothing — the bug this ordering exists
    // to prevent.
    const src = sheet();
    expect(src).toContain("onPointerDownCapture={cancelExit}");
    expect(src).toContain("onBlurCapture={scheduleExit}");
  });

  test("typed text keeps the sheet open", () => {
    const src = sheet();
    const exit = src.slice(src.indexOf("function scheduleExit()"), src.indexOf("function reveal("));
    expect(exit).toContain("if (text.trim() || feedbackText.trim()) return;");
    // Focus moving between fields inside the sheet is not "left the sheet".
    expect(exit).toContain("contains(deepActiveElement())");
  });

  test("the exit timer is cleared on unmount", () => {
    expect(sheet()).toContain("useEffect(() => cancelExit, []);");
  });
});
