"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ComponentProps,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";

import { sessionHrefFromCodespan, sessionRefFromHref } from "@omg-dev/protocol";

import { openSessionRef, useSessionRefLabel } from "@/lib/session-ref-link";
import { agentIconAlt, agentIconSrc } from "@/lib/session-ui";
import { cn } from "@/lib/utils";

type StreamdownPlugins = NonNullable<ComponentProps<typeof Streamdown>["plugins"]>;
type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown;
};
type InlineCodeProps = HTMLAttributes<HTMLElement> & { node?: unknown };

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

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {}

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

/**
 * A link that opens a session in this app instead of a new tab. The `omg:`
 * href would do nothing in a browser, so the click is taken over and the
 * short id is resolved to the session page.
 */
function textOf(node: ReactNode): string | null {
  if (typeof node === "string") return node;
  if (Array.isArray(node) && node.every((part) => typeof part === "string")) return node.join("");
  return null;
}

/**
 * A session reference, drawn as a tag: the agent's icon and the session's
 * title. The `omg:` href would do nothing in a browser, so the click is
 * taken over and the short id is resolved to the session page. `title` is
 * the label the text already carries (a `[#Title](omg:session_...)` token);
 * a bare id has none and waits for the lookup. Until a title is known the
 * `fallback` renders, as a plain link.
 */
function SessionRefChip({ href, title: written, fallback }: { href: string; title?: string | null; fallback: ReactNode }) {
  const ref = sessionRefFromHref(href);
  const known = useSessionRefLabel(ref);
  const title = written || known?.title || null;
  const agent = known?.agent ?? null;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    openSessionRef(href);
  };
  if (!title) {
    return (
      <a
        className="cursor-pointer font-medium text-primary no-underline hover:underline"
        href={href}
        data-session-ref={ref ?? undefined}
        onClick={open}
      >
        {fallback}
      </a>
    );
  }
  return (
    <a
      className="mx-0.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-px align-baseline text-[0.9em] font-medium leading-snug text-foreground no-underline transition-colors hover:bg-muted"
      href={href}
      title={[title, known?.project, ref].filter(Boolean).join(" · ")}
      data-session-ref={ref ?? undefined}
      onClick={open}
    >
      {agent ? (
        <img src={agentIconSrc(agent)} alt={agentIconAlt(agent)} className="size-3.5 shrink-0" />
      ) : (
        <span aria-hidden="true" className="text-muted-foreground">#</span>
      )}
      <span className="truncate">{title}</span>
      {known?.project ? (
        <span className="shrink-0 rounded bg-background px-1 text-[0.8em] font-normal leading-tight text-muted-foreground ring-1 ring-border">
          {known.project}
        </span>
      ) : null}
    </a>
  );
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

/** Streamdown's own inline code classes, kept when the span is not a session id. */
const INLINE_CODE_CLASS = "rounded bg-muted px-1.5 py-0.5 font-mono text-sm";

/**
 * Agents cite a session as a bare short id in inline code (`228efabd`).
 * Such a span opens that session; every other span renders as before.
 */
function SessionAwareInlineCode({ children, className, node: _node, ...props }: InlineCodeProps) {
  const text = textOf(children);
  const sessionHref = text ? sessionHrefFromCodespan(text) : null;
  const code = (
    <code className={cn(INLINE_CODE_CLASS, className)} data-streamdown="inline-code" {...props}>
      {children}
    </code>
  );
  if (!sessionHref || !text) return code;
  return <SessionRefChip href={sessionHref} fallback={code} />;
}

function CopyableMarkdownLink({ children, className, href, node: _node, ...props }: AnchorProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const canCopy = typeof href === "string" && href.length > 0;

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copyHref = async () => {
    if (!canCopy) return;
    await copyText(href);
    setCopied(true);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1200);
  };

  if (canCopy && sessionRefFromHref(href)) {
    return (
      <SessionRefChip href={href} title={textOf(children)?.replace(/^#/, "").trim() || null} fallback={children} />
    );
  }
  if (canCopy && /^omg:/i.test(href)) return <span className={className}>{children}</span>;

  if (!canCopy) {
    return (
      <a className={className} {...props}>
        {children}
      </a>
    );
  }

  return (
    <span className="inline">
      <a
        className={cn("break-all font-medium text-primary underline underline-offset-4", className)}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        {...props}
      >
        {children}
        <ExternalLink className="ml-0.5 inline size-3 align-[-0.125em]" aria-hidden="true" />
      </a>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void copyHref();
        }}
        title={copied ? "Copied" : "Copy link"}
        aria-label={copied ? "Copied" : "Copy link"}
        className="ml-1 inline-grid size-5 place-items-center rounded text-muted-foreground align-[-0.25em] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

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
