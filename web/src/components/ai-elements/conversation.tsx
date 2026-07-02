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
  return <div className={cn("flex flex-col gap-3", className)} {...props} />;
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
