import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The key deck's grab handle is a transparent 24px button. It used to be
// absolutely positioned against the terminal card (`absolute ... bottom-0`),
// which put it on top of the link tray that renders at the card's bottom edge:
// the tray is ~40px tall, so the handle swallowed the bottom ~24px of every
// URL chip. Tapping a detected login URL opened the keys pad instead of the
// link. The handle now shares a positioning context with the terminal host, so
// it can only ever overlay the terminal itself.

const term = readFileSync("web/src/components/TermView.tsx", "utf8");

describe("terminal link tray", () => {
  test("the grab handle is scoped to the terminal host, not the whole card", () => {
    const wrapper = term.indexOf('<div className="relative flex min-h-0 flex-1 flex-col">');
    const host = term.indexOf("ref={hostRef}");
    const handle = term.indexOf('aria-label="Show terminal keys"');
    expect(wrapper).toBeGreaterThan(-1);
    expect(wrapper).toBeLessThan(host);
    expect(host).toBeLessThan(handle);
  });

  test("the handle cannot cover the link chips below it", () => {
    const handle = term.indexOf('aria-label="Show terminal keys"');
    const tray = term.indexOf("{links.length > 0 ? (");
    expect(handle).toBeGreaterThan(-1);
    expect(tray).toBeGreaterThan(-1);
    // Rendered before the tray and inside the host's own stacking context, so
    // the tray's chips sit below it in layout instead of under it in z-order.
    expect(handle).toBeLessThan(tray);
    const afterTray = term.slice(tray);
    expect(afterTray).not.toContain('aria-label="Show terminal keys"');
  });

  test("link chips stay tappable targets with their own open and copy actions", () => {
    expect(term).toMatch(/href=\{u\}[\s\S]{0,120}target="_blank"/);
    expect(term).toContain('aria-label="copy link"');
  });
});
