import { useEffect, useRef, useState, type AnchorHTMLAttributes, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Check, Copy, ExternalLink, MessageSquare } from "lucide-react";

import { sessionHrefFromCodespan, sessionRefFromHref, threadRefFromHref } from "@omg-dev/protocol";

import { openSessionRef, openThreadRef, useSessionRefLabel } from "@/lib/session-ref-link";
import { agentIconAlt, agentIconSrc } from "@/lib/session-ui";
import { cn } from "@/lib/utils";

// The markdown link and inline code renderers. They live apart from
// streamdown-response so a surface can use them without importing streamdown:
// a static import of streamdown-response puts streamdown (and tailwind-merge)
// in the eager embed chunk, which the release embed smoke rejects.

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown;
};
type InlineCodeProps = HTMLAttributes<HTMLElement> & { node?: unknown };

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

/** Streamdown's own inline code classes, kept when the span is not a session id. */
const INLINE_CODE_CLASS = "rounded bg-muted px-1.5 py-0.5 font-mono text-sm";

/**
 * Agents cite a session as a bare short id in inline code (`228efabd`).
 * Such a span opens that session; every other span renders as before.
 */
export function SessionAwareInlineCode({ children, className, node: _node, ...props }: InlineCodeProps) {
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

/** A `[#Title](omg:thread_<id>)` reference: a chip like a session's, that opens the thread. */
function ThreadRefChip({ href, children }: { href: string; children: ReactNode }) {
  const label = textOf(children)?.replace(/^#/, "").trim() || "Thread";
  return (
    <button
      type="button"
      data-thread-ref={threadRefFromHref(href) ?? undefined}
      onClick={(event) => {
        event.preventDefault();
        openThreadRef(href);
      }}
      className="mx-0.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-px align-baseline text-[0.9em] font-medium leading-snug text-foreground no-underline transition-colors hover:bg-muted"
    >
      <MessageSquare aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span aria-hidden="true" className="text-muted-foreground">#</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** The default markdown link: exported so a surface that adds its own link kinds can fall back to it. */
export function CopyableMarkdownLink({ children, className, href, node: _node, ...props }: AnchorProps) {
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
  if (canCopy && threadRefFromHref(href)) return <ThreadRefChip href={href}>{children}</ThreadRefChip>;
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
