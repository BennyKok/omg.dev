// A headless copy of every shell's screen, kept in the terminal host.
//
// The host feeds each shell's output through Ghostty's VT engine (the same
// WASM build the browser renders with), so it always knows the exact screen,
// scrollback, cursor and modes. When a browser (re)attaches, the host turns
// that state back into a VT byte string. The new client paints the restored
// screen in one write, and nothing is re-run or re-rendered by an intermediate
// multiplexer. This is what replaced `tmux attach` for resuming a terminal.
import { createRequire } from "node:module";
import { Ghostty, type GhosttyCell } from "ghostty-web";

let ghosttyLoad: Promise<Ghostty> | null = null;

/** Load the VT engine once per process. */
export function loadGhostty(): Promise<Ghostty> {
  ghosttyLoad ??= (async () => {
    const require = createRequire(import.meta.url);
    return Ghostty.load(require.resolve("ghostty-web/ghostty-vt.wasm"));
  })();
  return ghosttyLoad;
}

/** The subset of ghostty-web's GhosttyTerminal the serializer reads. */
export interface VtScreen {
  readonly cols: number;
  readonly rows: number;
  /** Refresh the render state. getViewport() and getColors() read it as-is. */
  update(): unknown;
  getViewport(): GhosttyCell[];
  getScrollbackLength(): number;
  getScrollbackLine(offset: number): GhosttyCell[] | null;
  isRowWrapped(row: number): boolean;
  getCursor(): { x: number; y: number; visible: boolean };
  /** Default colours. Only valid after update(). */
  getColors(): { foreground: Rgb; background: Rgb };
  isAlternateScreen(): boolean;
  getMode(mode: number, isAnsi?: boolean): boolean;
  getGraphemeString(row: number, col: number): string;
  getScrollbackGraphemeString(offset: number, col: number): string;
}

type Rgb = { r: number; g: number; b: number };

// Cell flag bits (ghostty-web CellFlags).
const BOLD = 1;
const ITALIC = 2;
const UNDERLINE = 4;
const STRIKE = 8;
const INVERSE = 16;
const INVISIBLE = 32;
const BLINK = 64;
const FAINT = 128;

/**
 * DEC private modes that change how input is encoded or what the app expects
 * from the terminal. They are re-asserted after a restore so a reattached
 * client sends the same bytes the app is waiting for (mouse reports in a TUI,
 * bracketed paste, application cursor keys).
 */
const RESTORED_DEC_MODES = [1, 1000, 1002, 1003, 1004, 1006, 2004];

const ESC = "\x1b";

function sameRgb(r: number, g: number, b: number, c: Rgb) {
  return r === c.r && g === c.g && b === c.b;
}

/** SGR parameter list for one cell; "" means the default pen. */
function cellPen(cell: GhosttyCell, colors: { foreground: Rgb; background: Rgb }): string {
  const p: string[] = [];
  const f = cell.flags;
  if (f & BOLD) p.push("1");
  if (f & FAINT) p.push("2");
  if (f & ITALIC) p.push("3");
  if (f & UNDERLINE) p.push("4");
  if (f & BLINK) p.push("5");
  if (f & INVERSE) p.push("7");
  if (f & INVISIBLE) p.push("8");
  if (f & STRIKE) p.push("9");
  if (!sameRgb(cell.fg_r, cell.fg_g, cell.fg_b, colors.foreground)) {
    p.push(`38;2;${cell.fg_r};${cell.fg_g};${cell.fg_b}`);
  }
  if (!sameRgb(cell.bg_r, cell.bg_g, cell.bg_b, colors.background)) {
    p.push(`48;2;${cell.bg_r};${cell.bg_g};${cell.bg_b}`);
  }
  return p.join(";");
}

function isBlank(cell: GhosttyCell, colors: { foreground: Rgb; background: Rgb }) {
  const cp = cell.codepoint;
  return (
    (cp === 0 || cp === 32) &&
    cell.grapheme_len === 0 &&
    (cell.flags & (INVERSE | UNDERLINE | STRIKE)) === 0 &&
    sameRgb(cell.bg_r, cell.bg_g, cell.bg_b, colors.background)
  );
}

interface LineSource {
  cells: GhosttyCell[];
  wrapped: boolean;
  grapheme: (col: number) => string;
}

/**
 * Render one row. `pen` carries the SGR state across rows so a run of styled
 * text that wraps does not emit a reset and a re-set at every row edge.
 */
function renderLine(
  line: LineSource,
  colors: { foreground: Rgb; background: Rgb },
  pen: { current: string },
): string {
  const cells = line.cells;
  let end = cells.length;
  // A soft-wrapped row is written to the last column, so the terminal's own
  // autowrap continues it onto the next row and a later resize can reflow it.
  if (!line.wrapped) {
    while (end > 0 && isBlank(cells[end - 1], colors)) end--;
  }
  let out = "";
  for (let col = 0; col < end; col++) {
    const cell = cells[col];
    if (cell.width === 0) continue; // trailing half of a wide character
    const next = cellPen(cell, colors);
    if (next !== pen.current) {
      out += next ? `${ESC}[0;${next}m` : `${ESC}[0m`;
      pen.current = next;
    }
    if (cell.grapheme_len > 0) out += line.grapheme(col) || " ";
    else out += cell.codepoint > 32 ? String.fromCodePoint(cell.codepoint) : " ";
  }
  return out;
}

export interface SerializeOptions {
  /** How much scrollback to include. Defaults to 2000 lines. */
  scrollback?: number;
  /** The last title the shell set, re-sent so the client tab can show it. */
  title?: string | null;
}

/**
 * Turn a headless screen into the bytes that rebuild it on a blank terminal of
 * the same size. The result is written as one chunk, so the client paints the
 * whole restored screen in a single frame.
 */
export function serializeScreen(vt: VtScreen, opts: SerializeOptions = {}): string {
  // The render state is only refreshed on request. Before that the default
  // colours read as black-on-black and the viewport is stale.
  vt.update();
  const colors = vt.getColors();
  const pen = { current: "" };
  const rows = vt.rows;
  const total = vt.getScrollbackLength();
  const keep = Math.min(total, Math.max(0, opts.scrollback ?? 2000));
  const parts: string[] = [];

  const lineBreak = (wrapped: boolean) => {
    if (wrapped) return;
    // Reset before the newline: a scroll fills the new row with the current
    // background colour, which would smear a styled pen across it.
    if (pen.current) {
      parts.push(`${ESC}[0m`);
      pen.current = "";
    }
    parts.push("\r\n");
  };

  // isRowWrapped(row) marks a row that CONTINUES the one above it, so a row
  // wraps into the next when the next one carries the flag.
  //
  // Scrollback rows have no wrap flag in the WASM API. A scrollback row that
  // reaches the last column is treated as soft-wrapped: at the same width that
  // renders exactly like a hard break, and it lets a wider client reflow it.
  // The newest scrollback row can use the first screen row's flag instead.
  const alt = vt.isAlternateScreen();
  for (let off = total - keep; off < total; off++) {
    const cells = vt.getScrollbackLine(off);
    if (!cells) continue;
    const wrapped =
      off === total - 1 && !alt
        ? vt.isRowWrapped(0)
        : cells.length > 0 && !isBlank(cells[cells.length - 1], colors);
    parts.push(
      renderLine({ cells, wrapped, grapheme: (c) => vt.getScrollbackGraphemeString(off, c) }, colors, pen),
    );
    lineBreak(wrapped);
  }

  if (alt) {
    // The hidden primary screen is not readable while the alternate one is
    // active. Enter the alternate screen and paint it row by row.
    parts.push(`${ESC}[0m${ESC}[?1049h${ESC}[H${ESC}[2J`);
    pen.current = "";
  }
  const viewport = vt.getViewport();
  const cols = vt.cols;
  for (let row = 0; row < rows; row++) {
    const cells = viewport.slice(row * cols, row * cols + cols);
    const wrapped = !alt && row < rows - 1 && vt.isRowWrapped(row + 1);
    if (alt) parts.push(`${ESC}[${row + 1};1H`);
    parts.push(renderLine({ cells, wrapped, grapheme: (c) => vt.getGraphemeString(row, c) }, colors, pen));
    if (!alt && row < rows - 1) lineBreak(wrapped);
  }

  const cursor = vt.getCursor();
  parts.push(`${ESC}[0m${ESC}[${cursor.y + 1};${cursor.x + 1}H`);
  if (!cursor.visible) parts.push(`${ESC}[?25l`);
  if (!vt.getMode(7)) parts.push(`${ESC}[?7l`);
  for (const mode of RESTORED_DEC_MODES) {
    if (vt.getMode(mode)) parts.push(`${ESC}[?${mode}h`);
  }
  if (opts.title) parts.push(`${ESC}]2;${opts.title.replace(/[\x00-\x1f\x7f]/g, "")}\x07`);
  return parts.join("");
}

/**
 * Plain text of the last `lines` rows (scrollback then screen), one row per
 * line and not rejoined. Link detection (src/links.ts) stitches wrapped URLs
 * itself and needs the rows kept separate, the same input tmux's
 * `capture-pane -p` used to give it.
 */
export function screenText(vt: VtScreen, lines = 200): string {
  const out: string[] = [];
  const textOf = (cells: GhosttyCell[], grapheme: (c: number) => string) => {
    let s = "";
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col];
      if (cell.width === 0) continue;
      if (cell.grapheme_len > 0) s += grapheme(col) || " ";
      else s += cell.codepoint > 32 ? String.fromCodePoint(cell.codepoint) : " ";
    }
    return s.replace(/\s+$/, "");
  };
  vt.update();
  const total = vt.getScrollbackLength();
  const screenRows = vt.rows;
  const fromScrollback = Math.max(0, Math.min(total, lines - screenRows));
  for (let off = total - fromScrollback; off < total; off++) {
    const cells = vt.getScrollbackLine(off);
    if (cells) out.push(textOf(cells, (c) => vt.getScrollbackGraphemeString(off, c)));
  }
  const viewport = vt.getViewport();
  const cols = vt.cols;
  for (let row = 0; row < screenRows; row++) {
    out.push(textOf(viewport.slice(row * cols, row * cols + cols), (c) => vt.getGraphemeString(row, c)));
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
