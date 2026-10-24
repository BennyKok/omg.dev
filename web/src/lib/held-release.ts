// Held cards this page has let go of (sent now, or removed), until the server
// agrees.
//
// The cards under the composer are server state: every queue frame replaces
// the list. "Send now" takes a card away at once and deletes its row, and a
// frame that left the server before that delete still lists the row. It drew
// the card again, and the next frame took it away: the card blinked out, back
// in, and out. A released row stays hidden until a frame no longer lists it
// (the server agrees), or the page itself puts it back (a delete that failed
// re-reads the queue and hands the row back).

type Row = { id: string };

export function createHeldRelease() {
  const released = new Set<string>();
  return {
    /** A change this page made to its own list: rows it dropped are released, rows it kept or got back are not. */
    change<T extends Row>(previous: readonly T[], next: readonly T[]): readonly T[] {
      const kept = new Set(next.map((row) => row.id));
      for (const row of previous) if (!kept.has(row.id)) released.add(row.id);
      for (const id of kept) released.delete(id);
      return next;
    },
    /** A server frame: the rows to draw. A row the frame no longer lists is settled. */
    frame<T extends Row>(rows: readonly T[]): T[] {
      const listed = new Set(rows.map((row) => row.id));
      for (const id of [...released]) if (!listed.has(id)) released.delete(id);
      return rows.filter((row) => !released.has(row.id));
    },
    clear() {
      released.clear();
    },
  };
}
