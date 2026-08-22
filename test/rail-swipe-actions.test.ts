import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");

/**
 * Swipe-to-archive was carried by the mobile session card. When the mobile
 * list became rail rows, the card went away and took the gesture with it — the
 * row's swipe only pinned and unpinned, so there was no way to archive by
 * gesture at all. Nothing caught it, because no test named the gesture.
 *
 * This pins the contract on RailItem, which is now the row on both surfaces.
 */
function railItemBody(): string {
  const start = APP.indexOf("const RailItem = memo(function RailItem({");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("\nconst SEV_DOT", start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("the session row's swipe actions", () => {
  test("right commits the pin, left commits the archive", () => {
    const body = railItemBody();
    // Direction is the whole point: a single `Math.abs(d.x) >= COMMIT` cannot
    // tell the two apart, and that is exactly what it used to be.
    expect(body).toContain("if (d.x >= COMMIT)");
    expect(body).toContain("onTogglePin();");
    expect(body).toContain("d.x <= -COMMIT && onArchive");
    expect(body).toContain("onArchive();");
    expect(body).not.toMatch(/if\s*\(\s*Math\.abs\(d\.x\)\s*>=\s*COMMIT\s*\)/);
  });

  // A row on a surface that does not offer archive must not rubber-band left
  // toward an action that will never fire.
  test("left only travels when there is an archive to commit to", () => {
    expect(railItemBody()).toContain("let v = onArchive ? dx : Math.max(0, dx);");
  });

  test("both actions are revealed, each on its own edge", () => {
    const body = railItemBody();
    expect(body).toContain("justify-between");
    expect(body).toContain("<Archive className=\"size-4 text-destructive\" />");
    expect(body).toContain("<Pin");
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
