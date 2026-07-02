"use client";

import { Brain, ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

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

export function ReasoningTrigger({ className, isStreaming, children, ...props }: ReasoningTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <Brain className="size-3.5" />
          {isStreaming ? <Shimmer>Thinking...</Shimmer> : <span>Thought</span>}
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
