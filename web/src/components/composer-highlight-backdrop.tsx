import { cn } from "../lib/utils";
import type { ComposerSegment } from "../lib/composer-highlight";

export function ComposerHighlightBackdrop({
  segments,
  value,
  scrollTop,
  className,
}: {
  segments: ComposerSegment[];
  value: string;
  scrollTop: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      data-composer-highlight-backdrop=""
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent",
        className,
      )}
    >
      <div style={{ transform: `translateY(${-scrollTop}px)` }}>
        {segments.map((seg, idx) =>
          seg.kind === "command" ? (
            <mark
              key={idx}
              className="rounded-md bg-primary/12 text-transparent ring-1 ring-primary/35 shadow-[0_0_0_2px_rgba(0,122,255,0.08)]"
            >
              {seg.text}
            </mark>
          ) : seg.kind === "mention" ? (
            <mark
              key={idx}
              className="rounded-md bg-amber-500/12 text-transparent ring-1 ring-amber-500/35 shadow-[0_0_0_2px_rgba(245,158,11,0.08)] dark:bg-amber-400/15 dark:ring-amber-400/35"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={idx}>{seg.text}</span>
          ),
        )}
        {value.endsWith("\n") ? " " : null}
      </div>
    </div>
  );
}
