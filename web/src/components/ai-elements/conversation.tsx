"use client";

import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<"div">;

export const Conversation = forwardRef<HTMLDivElement, ConversationProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("relative min-h-0 flex-1 overflow-y-auto", className)}
      role="log"
      {...props}
    />
  ),
);

Conversation.displayName = "Conversation";

export type ConversationContentProps = ComponentProps<"div">;

export function ConversationContent({ className, ...props }: ConversationContentProps) {
  // Tight base gap between every row. The visible breathing room between a
  // speaker change and a same-speaker follow-up comes from each row's own
  // top margin (see the chat-render loop's speaker-change spacing), not from
  // this container gap — a flat gap-3 here made every row equally far apart
  // regardless of who was talking, which read as mostly empty screen on a
  // tall/narrow viewport like an iPad.
  //
  // gap-2, not gap-1: every message used to carry an in-flow copy button that
  // padded ~32px under it, so gap-1 was never the real distance between two
  // bubbles. That button is out of flow now (see MessageActions), and gap-1
  // alone left consecutive bubbles almost touching. This is the whole
  // same-speaker gap now, and it is the same for every pair of rows.
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export function ConversationEmptyState({
  className,
  title = "No messages yet",
  description,
  icon = <MessageSquare className="size-5" />,
  children,
  ...props
}: ConversationEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-64 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {icon}
          <span>{title}</span>
          {description ? <span className="max-w-sm text-xs">{description}</span> : null}
        </>
      )}
    </div>
  );
}
