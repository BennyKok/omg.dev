import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");

/**
 * Swipe-to-archive was carried by the mobile session card. When the mobile
 * list became rail rows, the card went away and took the gesture with it — the
 * row's swipe only pinned and unpinned, so there was no way to archive by
 * gesture at all. Nothing caught it, because no test named the gesture.
 *
 * The gesture machinery itself now lives on RailRow, the shell RailItem
 * (session rows) and the bot roster row both wrap — see RailRow's docstring.
 * This pins the generic commit contract on RailRow, and the session-specific
 * wiring (pin on the right, archive on the left) on RailItem.
 */
function railRowBody(): string {
  const start = APP.indexOf("const RailRow = memo(function RailRow({");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("\nconst RailItem = memo(function RailItem({", start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

function railItemBody(): string {
  const start = APP.indexOf("const RailItem = memo(function RailItem({");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("\nconst SEV_DOT", start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("the row shell's swipe machinery (RailRow)", () => {
  test("right commits onSwipeRight, left commits onSwipeLeft", () => {
    const shell = railRowBody();
    // Direction is the whole point: a single `Math.abs(d.x) >= COMMIT` cannot
    // tell the two apart, and that is exactly what it used to be.
    expect(shell).toContain("if (d.x >= COMMIT && onSwipeRight)");
    expect(shell).toContain("onSwipeRight.onCommit();");
    expect(shell).toContain("d.x <= -COMMIT && onSwipeLeft");
    expect(shell).toContain("onSwipeLeft.onCommit();");
    expect(shell).not.toMatch(/if\s*\(\s*Math\.abs\(d\.x\)\s*>=\s*COMMIT\s*\)/);
  });

  // Neither direction is mandatory any more — a bot row offers no left
  // action at all — so each direction only travels when there is something
  // for it to commit to, not just the left one.
  test("each direction only travels when there is something to commit to", () => {
    expect(railRowBody()).toContain(
      "let v = dx >= 0 ? (onSwipeRight ? dx : 0) : (onSwipeLeft ? dx : 0);",
    );
  });

  test("both actions are revealed, each on its own edge", () => {
    expect(railRowBody()).toContain("justify-between");
  });
});

describe("the session row's swipe actions (RailItem)", () => {
  test("right pins, left archives", () => {
    const body = railItemBody();
    expect(body).toContain("onCommit: onTogglePin");
    expect(body).toContain("onCommit: onArchive");
    expect(body).toContain("<Archive className=\"size-4 text-destructive\" />");
    expect(body).toContain("<Pin");
  });

  // A row on a surface that does not offer archive must not rubber-band left
  // toward an action that will never fire — RailRow enforces this generically
  // now (see the shell's own test above); this just confirms RailItem leaves
  // `onSwipeLeft` unset rather than always supplying it.
  test("archive is conditional; pin is not", () => {
    const body = railItemBody();
    expect(body).toContain(
      "onSwipeLeft={\n        onArchive ? { icon: <Archive className=\"size-4 text-destructive\" />, onCommit: onArchive } : undefined\n      }",
    );
  });

  // The mobile list is the surface that offers it; the gesture is touch-only.
  test("the mobile list wires archive into its rows", () => {
    expect(APP).toContain("onArchive={() => void archiveSession(sid)}");
    expect(APP).toContain('closeSessionRequest(sid, "mobile_swipe_archive")');
  });

  // Dropping the row before the request lands is what makes the gesture feel
  // immediate; the refresh afterwards is the source of truth.
  test("archiving drops the row first and reconciles after", () => {
    const start = APP.indexOf("const archiveSession = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = APP.slice(start, start + 900);
    expect(body.indexOf("onRemove(sid);")).toBeLessThan(
      body.indexOf("closeSessionRequest"),
    );
    expect(body).toContain("await onRefresh().catch(() => {});");
  });
});
