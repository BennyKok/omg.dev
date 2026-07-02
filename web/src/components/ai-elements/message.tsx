"use client";

import { memo, type ComponentProps, type HTMLAttributes } from "react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

import { cn } from "@/lib/utils";

type MessageRole = "user" | "assistant" | "system" | "data" | string;

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
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
        "min-w-0 max-w-[92%] text-sm leading-relaxed group-data-[role=user]/message:max-w-[85%]",
        className,
      )}
      {...props}
    />
  );
}

const streamdownPlugins = { cjk, code, math, mermaid };

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, mode = "static", ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("markdown msg-text size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      mode={mode}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prev, next) =>
    prev.children === next.children &&
    prev.className === next.className &&
    prev.isAnimating === next.isAnimating &&
    prev.animated === next.animated &&
    prev.mode === next.mode &&
    prev.caret === next.caret,
);

MessageResponse.displayName = "MessageResponse";
