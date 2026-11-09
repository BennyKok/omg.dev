import { describe, expect, test } from "bun:test";
import { loadGhostty, screenText, serializeScreen } from "./vt.ts";

const g = await loadGhostty();
const term = (cols: number, rows: number) => g.createTerminal(cols, rows, { scrollbackLimit: 1000 });

function cells(t: ReturnType<typeof term>) {
  t.update();
  return t.getViewport().map((c) => [c.codepoint, c.fg_r, c.fg_g, c.fg_b, c.bg_r, c.bg_g, c.bg_b, c.flags, c.width].join());
}

describe("serializeScreen", () => {
  test("a fresh terminal fed the snapshot shows the same screen, cell for cell", () => {
    const a = term(24, 6);
    for (let i = 0; i < 9; i++) a.write(`row ${i}\r\n`);
    a.write("\x1b[1;31mbold red\x1b[0m \x1b[7minv\x1b[0m \x1b[48;2;10;20;30mbg\x1b[0m 中文 👍🏽\r\n");
    a.write("a long line that wraps past the edge of the screen");
    const b = term(24, 6);
    b.write(serializeScreen(a));
    expect(screenText(b)).toBe(screenText(a));
    expect(cells(b)).toEqual(cells(a));
    expect(b.getCursor()).toMatchObject({ x: a.getCursor().x, y: a.getCursor().y });
  });

  test("soft-wrapped rows stay soft-wrapped, so a wider screen reflows them", () => {
    const a = term(10, 4);
    a.write("0123456789abcdefghij");
    const b = term(10, 4);
    b.write(serializeScreen(a));
    b.resize(30, 4);
    expect(screenText(b)).toContain("0123456789abcdefghij");
  });

  test("an app on the alternate screen comes back there, with its input modes", () => {
    const a = term(30, 6);
    a.write("shell history\r\n\x1b[?1049h\x1b[3;4Hfull screen\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?25l");
    const b = term(30, 6);
    b.write(serializeScreen(a));
    expect(b.isAlternateScreen()).toBe(true);
    expect(screenText(b, 6)).toContain("   full screen");
    for (const mode of [2004, 1000, 1006]) expect(b.getMode(mode)).toBe(true);
    expect(b.getCursor().visible).toBeFalsy();
  });

  test("the title is re-sent and cannot smuggle escape sequences", () => {
    const out = serializeScreen(term(10, 2), { title: "ok\x1b]52;c;evil\x07" });
    expect(out.endsWith("\x1b]2;ok]52;c;evil\x07")).toBe(true);
  });

  test("scrollback is bounded", () => {
    const a = term(10, 3);
    for (let i = 0; i < 50; i++) a.write(`l${i}\r\n`);
    const b = term(10, 3);
    b.write(serializeScreen(a, { scrollback: 5 }));
    const text = screenText(b, 100);
    expect(text).toContain("l49");
    expect(text).toContain("l43");
    expect(text).not.toContain("l40\n");
  });
});
