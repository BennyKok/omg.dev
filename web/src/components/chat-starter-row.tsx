import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Image as ImageIcon, Smartphone, Terminal } from "lucide-react";
import { CHAT_STARTERS, type ChatStarterId } from "../../../packages/protocol/src/chat-starters";
import { cn } from "@/lib/utils";

/**
 * The four starter pills an empty no-project composer offers.
 *
 * The cards, and only the cards, are what a chat without a folder starts
 * from: there is no hero and no project setup form, because the agent creates
 * the project from the conversation itself (docs/no-project-chat.md). A tap
 * sends the starter prompt immediately, exactly as it does on iOS. It does
 * not fill the box and wait for a second tap on Start, which would put a
 * sentence the person did not write under their cursor.
 *
 * The prompts live in packages/protocol so the two clients cannot drift. Only
 * the icons are chosen here, because Lucide and SF Symbols do not share names.
 */
const STARTER_ICONS: Record<ChatStarterId, typeof Globe> = {
  website: Globe,
  app: Smartphone,
  api: Terminal,
  image: ImageIcon,
};

/**
 * One hue per starter, so the row reads as four different things at a glance
 * instead of four copies of the accent. The -500 step on light, -400 on dark,
 * keeps each mark legible on the pill's fill in both themes.
 */
const STARTER_TINTS: Record<ChatStarterId, string> = {
  website: "text-sky-500 dark:text-sky-400",
  app: "text-emerald-500 dark:text-emerald-400",
  api: "text-amber-500 dark:text-amber-400",
  image: "text-pink-500 dark:text-pink-400",
};

/** Width of the fade at a scrollable edge. */
const EDGE_FADE = "1.5rem";

/**
 * Fade whichever ends still have pills beyond them. An end the row is
 * scrolled to stays sharp, so the first pill is never half-faded at rest.
 */
function edgeMask(left: boolean, right: boolean): string | undefined {
  if (!left && !right) return undefined;
  const start = left ? `transparent 0, black ${EDGE_FADE}` : "black 0";
  const end = right ? `black calc(100% - ${EDGE_FADE}), transparent 100%` : "black 100%";
  return `linear-gradient(to right, ${start}, ${end})`;
}

export function ChatStarterRow({
  onStart,
  disabled = false,
  className,
}: {
  /** Sends this text as a brand new chat. */
  onStart: (prompt: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    // 1px slack: fractional widths leave scrollLeft a hair short of the end.
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  useEffect(() => {
    measure();
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  const mask = edgeMask(edges.left, edges.right);

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="Start something new"
      data-testid="chat-starter-row"
      data-fade-left={edges.left ? "true" : undefined}
      data-fade-right={edges.right ? "true" : undefined}
      onScroll={measure}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      // One swipeable row, like the project pills above it. A 2x2 grid
      // took four card heights off a small phone's list.
      className={cn(
        "flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {CHAT_STARTERS.map((starter) => {
        const Icon = STARTER_ICONS[starter.id];
        return (
          // A pill: the mark and the label. The description is the tooltip
          // and the accessible name; as a second line it made each starter a
          // card, and four cards outweighed the composer they sit above.
          <button
            key={starter.id}
            type="button"
            disabled={disabled}
            data-testid={`chat-starter-${starter.id}`}
            aria-label={`Start ${starter.label.toLowerCase()}. ${starter.description}`}
            title={starter.description}
            onClick={() => onStart(starter.prompt)}
            className="flex h-9 shrink-0 snap-start items-center gap-2 rounded-full border border-border bg-card pl-3 pr-3.5 text-[13px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Icon className={cn("size-4 shrink-0", STARTER_TINTS[starter.id])} aria-hidden="true" />
            <span className="whitespace-nowrap">{starter.label}</span>
          </button>
        );
      })}
    </div>
  );
}
