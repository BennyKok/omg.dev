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
// The morph itself now lives in a hook, so the guards that used to read
// BottomSheet's body read the hook's source instead.
const HOOK = readFileSync(new URL("../web/src/lib/expand-on-focus.ts", import.meta.url), "utf8");
const DRAWER = readFileSync(
  new URL("../web/src/components/ui/drawer.tsx", import.meta.url),
  "utf8",
);
const RESUME = readFileSync(
  new URL("../web/src/views/resume-session-sheet.tsx", import.meta.url),
  "utf8",
);

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
    // The class itself is DrawerContent's job now (see the next describe);
    // BottomSheet's remaining job is the footer/scroller split.
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

describe("every drawer in the app gets the morph, not just opted-in sheets", () => {
  // The morph used to be wired by hand at each call site, so any drawer whose
  // author did not know about it kept fighting the keyboard. It lives in
  // DrawerContent now: on by default, opt OUT with expandOnFocus={false}.
  test("DrawerContent owns the hook and applies the class itself", () => {
    expect(DRAWER).toContain("expandOnFocus = true");
    expect(DRAWER).toContain("useExpandOnFocus(expandOnFocus && !isDesktop)");
    expect(DRAWER).toContain("const paged = page || morph.paged");
    expect(DRAWER).toContain('paged && "lfg-sheet-page"');
  });

  test("all three handlers are wired, and caller handlers still run", () => {
    // A missing handler breaks fold-back; replacing the caller's handler
    // silently breaks whatever that caller needed it for.
    for (const handler of ["onPointerDownCapture", "onFocusCapture", "onBlurCapture"]) {
      expect(DRAWER).toContain(`morph.${handler}(`);
      expect(DRAWER).toContain(`${handler}?.(e)`);
    }
    expect(HOOK).toContain("if (!isTypingTarget(e.target as Element)) return;");
  });

  test("page state is published so sheet bodies can react without duplicating it", () => {
    expect(DRAWER).toContain('data-paged={paged ? "true" : "false"}');
    expect(DRAWER).toContain("DrawerPagedContext");
    expect(DRAWER).toContain("useDrawerPaged");
  });

  test("BottomSheet forwards its props instead of re-implementing the morph", () => {
    const src = bottomSheet();
    expect(src).toContain("page={page}");
    expect(src).toContain("expandOnFocus={expandOnFocus}");
    // Default-on here too: a sheet built from BottomSheet is a form more often
    // than not.
    expect(src).toContain("expandOnFocus = true");
    expect(src).not.toContain("useExpandOnFocus(");
  });

  test("the hand-wired call sites are gone", () => {
    // Folder picker and resume sheet inherit the morph now. Leftover local
    // wiring would double-apply the class and drift out of sync.
    const picker = slice("function ProjectFolderBrowser(", "function ComposerProjectSheet(");
    expect(picker).not.toContain("useExpandOnFocus");
    expect(picker).not.toContain("lfg-sheet-page");
    expect(RESUME).not.toContain("useExpandOnFocus");
    expect(RESUME).not.toContain("lfg-sheet-page");
    // The resume sheet's own 72dvh cap still has to yield, now off the
    // drawer's data attribute rather than a local state.
    expect(RESUME).toContain("group-data-[paged=true]/drawer-content:max-h-none");
  });

  test("BottomSheet's fold-back keeps typed work and inter-field focus", () => {
    expect(HOOK).toContain("contains(deepActiveElement())");
    expect(HOOK).toContain("if (field.value.trim()) return;");
    expect(HOOK).toContain("useEffect(() => cancelExit, []);");
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
