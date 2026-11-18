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
          seg.kind === "btw" ? (
            <mark
              key={idx}
              className="rounded-sm bg-primary/15 text-transparent"
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
