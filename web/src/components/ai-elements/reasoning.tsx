"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { MessageResponse } from "./message";
import { Shimmer } from "./shimmer";

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
};

export function Reasoning({ className, isStreaming: _isStreaming, ...props }: ReasoningProps) {
  return (
    <Collapsible
      className={cn("group/reasoning not-prose w-full text-muted-foreground", className)}
      {...props}
    />
  );
}

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  isStreaming?: boolean;
};

function formatThinkingDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/**
 * How long the thinking took, measured here because nothing upstream records
 * it.
 *
 * The transcript carries a thinking message's text and a timestamp, but that
 * timestamp is not a start: consecutive thinking messages collapse onto the
 * latest one as the block streams (see collapseThinkingRuns), so it moves. The
 * only place that knows when this block began is the component that watched it
 * begin.
 *
 * Which means a transcript loaded already-complete has no duration to show,
 * and says plain "Thought" rather than inventing one.
 */
function useThinkingDuration(isStreaming: boolean | undefined): number | null {
  const startedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!isStreaming) return;
    if (startedAt.current == null) startedAt.current = Date.now();
    const tick = () => setElapsed(Date.now() - (startedAt.current ?? Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    // Leaves `elapsed` at its last value when streaming stops, which is the
    // final duration — the label switches from counting to reporting it.
    return () => clearInterval(timer);
  }, [isStreaming]);

  return elapsed;
}

export function ReasoningTrigger({ className, isStreaming, children, ...props }: ReasoningTriggerProps) {
  const elapsed = useThinkingDuration(isStreaming);
  const duration = elapsed == null ? null : formatThinkingDuration(elapsed);
  return (
    <CollapsibleTrigger
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {/* No brain glyph. It was the only illustrated icon in the
              transcript, and it sat on the quietest row there. The words say
              what this is, and the duration is the part worth reading. */}
          {isStreaming ? (
            <Shimmer>{duration ? `Thinking… ${duration}` : "Thinking…"}</Shimmer>
          ) : (
            <span>{duration ? `Thought for ${duration}` : "Thought"}</span>
          )}
          <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]/reasoning:rotate-180" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
};

export function ReasoningContent({ className, children, ...props }: ReasoningContentProps) {
  return (
    <CollapsibleContent className={cn("mt-2 text-sm", className)} {...props}>
      <MessageResponse className="ai-live-text max-w-full opacity-90">{children}</MessageResponse>
    </CollapsibleContent>
  );
}
