"use client";

import { CheckCircle, ChevronDown, Clock, Wrench } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

type ToolState = "input-available" | "output-available";

export type ToolProps = ComponentProps<typeof Collapsible>;

export function Tool({ className, ...props }: ToolProps) {
  return (
    <Collapsible
      className={cn("tool-fold group/tool not-prose w-full rounded-lg border border-border/80", className)}
      {...props}
    />
  );
}

export function ToolHeader({
  className,
  title,
  state = "output-available",
  summary,
  ...props
}: ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  state?: ToolState;
  summary?: ReactNode;
}) {
  const live = state === "input-available";
  return (
    <CollapsibleTrigger
      className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left", className)}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{title}</span>
        <Badge variant={live ? "outline" : "secondary"} className="shrink-0">
          {live ? <Clock className="size-3" /> : <CheckCircle className="size-3" />}
          {live ? "Running" : "Done"}
        </Badge>
        {summary ? <span className="truncate text-xs text-muted-foreground">{summary}</span> : null}
      </span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/tool:rotate-180" />
    </CollapsibleTrigger>
  );
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return <CollapsibleContent className={cn("border-t border-border/70 p-2", className)} {...props} />;
}

export function ToolOutput({
  className,
  output,
}: {
  className?: string;
  output: string;
}) {
  return <CodeBlock className={className} code={output} language="text" />;
}
