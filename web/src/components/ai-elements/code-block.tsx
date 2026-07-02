"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type CodeBlockProps = ComponentProps<"pre"> & {
  code: string;
  language?: string;
};

export function CodeBlock({ code, language = "text", className, ...props }: CodeBlockProps) {
  return (
    <pre
      className={cn("max-h-96 overflow-auto rounded-md bg-muted/70 p-3 text-xs", className)}
      data-language={language}
      {...props}
    >
      <code>{code}</code>
    </pre>
  );
}
