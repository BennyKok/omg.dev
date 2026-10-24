import { useEffect, useState, type ReactNode } from "react";

/** How long a dock takes to open or close. Matches .lfg-dock in index.css. */
export const DOCK_MS = 220;

/**
 * Room for a list that comes and goes inside a composer (held sends, attached
 * files), opened and closed over DOCK_MS instead of in one frame.
 *
 * The composer is anchored at the bottom of the screen and grows upward, so a
 * row appearing or leaving at full height in one frame moved every message
 * above it by that height at once. While closing, the dock keeps drawing the
 * last items it had, inert, so there is something to fold away.
 */
export function PresenceDock<T>({
  items,
  children,
}: {
  items: readonly T[];
  children: (items: readonly T[]) => ReactNode;
}) {
  const open = items.length > 0;
  const [last, setLast] = useState(items);
  if (open && last !== items) setLast(items);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const timer = setTimeout(() => setShown(false), DOCK_MS);
    return () => clearTimeout(timer);
  }, [open]);
  if (!open && !shown) return null;
  return (
    <div className="lfg-dock" data-state={open ? "open" : "closed"} inert={!open || undefined}>
      <div>{children(open ? items : last)}</div>
    </div>
  );
}
