"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";

import { cn } from "@/lib/utils";

import { CopyableMarkdownLink, SessionAwareInlineCode } from "./markdown-links";

export { CopyableMarkdownLink } from "./markdown-links";

type StreamdownPlugins = NonNullable<ComponentProps<typeof Streamdown>["plugins"]>;

let extraPlugins: Partial<StreamdownPlugins> | null = null;
let extraPluginsPromise: Promise<void> | null = null;
const extraPluginsListeners = new Set<() => void>();

function needsExtraPlugins(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /```(?:mermaid|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart|block-beta|architecture-beta|packet-beta)\b/i.test(value)
    || /(^|\n)\s*(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart)\b/.test(value)
    || /(^|[^\\])(\$\$|\\\(|\\\[)/.test(value);
}

function loadExtraPlugins(): Promise<void> {
  if (!extraPluginsPromise) {
    extraPluginsPromise = Promise.all([
      import("@streamdown/math"),
      import("@streamdown/mermaid"),
    ])
      .then(([mathMod, mermaidMod]) => {
        extraPlugins = { math: mathMod.math, mermaid: mermaidMod.mermaid };
        for (const notify of extraPluginsListeners) notify();
      })
      .catch(() => {
        extraPluginsPromise = null;
      });
  }
  return extraPluginsPromise;
}

function useStreamdownPlugins(children: unknown): StreamdownPlugins {
  const shouldLoadExtra = needsExtraPlugins(children);
  const [extra, setExtra] = useState<Partial<StreamdownPlugins> | null>(
    shouldLoadExtra ? extraPlugins : null,
  );
  useEffect(() => {
    if (!shouldLoadExtra) {
      setExtra(null);
      return;
    }
    if (extraPlugins) {
      setExtra(extraPlugins);
      return;
    }
    const notify = () => setExtra(extraPlugins);
    extraPluginsListeners.add(notify);
    void loadExtraPlugins();
    return () => {
      extraPluginsListeners.delete(notify);
    };
  }, [shouldLoadExtra]);
  return { cjk, code, ...(extra ?? {}) };
}

/**
 * Streamdown's default rehype chain (raw, sanitize, harden) with one change:
 * the sanitizer also keeps `omg:` hrefs. Without it a `#session` reference
 * renders as "[blocked]". `CopyableMarkdownLink` renders only the
 * `omg:session_` form as a link; any other `omg:` href stays plain text.
 */
type SanitizeTuple = [unknown, { protocols?: Record<string, string[]> } & Record<string, unknown>];
const [sanitizePlugin, sanitizeSchema] = defaultRehypePlugins.sanitize as unknown as SanitizeTuple;
const REHYPE_PLUGINS = [
  defaultRehypePlugins.raw,
  [
    sanitizePlugin,
    {
      ...sanitizeSchema,
      protocols: {
        ...sanitizeSchema.protocols,
        href: [...(sanitizeSchema.protocols?.href ?? []), "omg"],
      },
    },
  ],
  defaultRehypePlugins.harden,
] as unknown as NonNullable<StreamdownResponseProps["rehypePlugins"]>;

export type StreamdownResponseProps = ComponentProps<typeof Streamdown>;
type StreamdownComponents = NonNullable<StreamdownResponseProps["components"]>;

export function StreamdownResponse({ className, mode = "static", children, components, ...props }: StreamdownResponseProps) {
  const plugins = useStreamdownPlugins(children);
  const markdownComponents = useMemo<StreamdownComponents>(
    () => ({ a: CopyableMarkdownLink, inlineCode: SessionAwareInlineCode, ...components }) as StreamdownComponents,
    [components],
  );
  return (
    <Streamdown
      className={cn("markdown msg-text size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      components={markdownComponents}
      mode={mode}
      plugins={plugins}
      rehypePlugins={REHYPE_PLUGINS}
      // Streamdown 2.6 caps fenced code at 400px and tables at 300px by
      // default. The transcript height model treats those blocks as full
      // height, so a silent cap would leave empty space on unmounted rows.
      // Infinity keeps the previous unbounded layout. Callers can still
      // override through props.
      codeBlockMaxHeight={Infinity}
      tableMaxHeight={Infinity}
      {...props}
    >
      {children}
    </Streamdown>
  );
}
