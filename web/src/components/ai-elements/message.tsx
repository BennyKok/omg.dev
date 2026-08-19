"use client";

import { lazy, memo, Suspense, type ComponentProps, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const StreamdownResponse = lazy(() =>
  import("./streamdown-response").then((m) => ({ default: m.StreamdownResponse })),
);

type MessageRole = "user" | "assistant" | "system" | "data" | string;

// ComponentProps rather than HTMLAttributes so `ref` is accepted: React 19
// treats ref as an ordinary prop, and it already reaches the div via {...props}
// — HTMLAttributes just omits it from the public type.
export type MessageProps = ComponentProps<"div"> & {
  from: MessageRole;
};

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        "group/message flex w-full min-w-0",
        from === "user" ? "justify-end" : "justify-start",
        className,
      )}
      data-role={from}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ className, ...props }: MessageContentProps) {
  return (
    <div
      className={cn(
        // Default cap for assistant content that is a direct Message child.
        // User turns cap width on MessageActions instead (so the percentage
        // resolves against Message's definite width and stays right-aligned).
        //
        // min-w-0 (not min-w-auto, the flex-item default) is needed so long
        // unbroken text can still shrink to the max-width cap above — without
        // it a min-content-sized item can refuse to shrink below one long
        // word. A small min-width floor guards the other direction: a caller
        // that ends up shrink-constrained for any reason (a stacked
        // percentage max-width resolving against an unexpectedly narrow
        // ancestor is the shape that hit bot chat — see MessageBubble's
        // bot-bubble className comment for the actual "Waiting." -> "Waiti" /
        // "ng." bug) shouldn't be able to squeeze a bubble narrower than a
        // single short word can fit in.
        "min-w-[3.5rem] max-w-[92%] text-sm leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export type MessageResponseProps = ComponentProps<typeof StreamdownResponse>;

export const MessageResponse = memo(
  ({ className, mode = "static", ...props }: MessageResponseProps) => {
    return (
      <Suspense
        fallback={
          <div className={cn("markdown msg-text size-full whitespace-pre-wrap", className)}>
            {typeof props.children === "string" ? props.children : null}
          </div>
        }
      >
        <StreamdownResponse className={className} mode={mode} {...props} />
      </Suspense>
    );
  },
  (prev, next) =>
    prev.children === next.children &&
    prev.className === next.className &&
    prev.isAnimating === next.isAnimating &&
    prev.animated === next.animated &&
    prev.mode === next.mode &&
    prev.caret === next.caret,
);

MessageResponse.displayName = "MessageResponse";
