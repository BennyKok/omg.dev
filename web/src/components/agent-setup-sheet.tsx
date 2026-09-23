/**
 * The mobile web copy of the iOS agent setup sheet
 * (mobile/src/omg/agent-setup-sheet.tsx). One bottom sheet holds every choice
 * a new session needs: agent, model, Fast, thinking, and the Claude profile.
 *
 * Presentational only. The composer owns the selection and passes it in, the
 * same way HomeComposer feeds the iOS sheet from useAgentPicker.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Drawer as VaulDrawer } from "vaul";
import { ChevronLeft, ChevronRight, Gauge, Plus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export type SetupSheetPage = "root" | "models" | "profiles" | "usage";

export type SetupAgentTile = {
  /** The agent key. One tile per agent; Claude profiles live on their own page. */
  id: string;
  label: string;
  iconSrc: string;
  selected: boolean;
  /** Supported by the product but not connected on this box. */
  locked?: boolean;
  /** The pinned Claude profile number, drawn in the corner. */
  badge?: number;
};

export type SetupChoice = {
  id: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
};

export function AgentSetupSheet({
  open,
  onOpenChange,
  initialPage = "root",
  title,
  agents,
  onSelectAgent,
  onLockedAgent,
  profiles = [],
  onSelectProfile,
  modelLabel,
  renderModels,
  fast,
  tibo,
  thinking,
  usageRing,
  usageDetails,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPage?: SetupSheetPage;
  title: string;
  agents: SetupAgentTile[];
  onSelectAgent: (id: string) => void;
  onLockedAgent?: (id: string) => void;
  /** Claude profiles. Long-press on the Claude tile opens them. */
  profiles?: SetupChoice[];
  onSelectProfile?: (id: string) => void;
  modelLabel?: string | null;
  /** The searchable model list. `done` returns to the root page. */
  renderModels?: (done: () => void) => ReactNode;
  fast?: { enabled: boolean; onToggle: () => void } | null;
  tibo?: { enabled: boolean; onToggle: () => void } | null;
  thinking?: { options: SetupChoice[]; onPick: (id: string) => void } | null;
  usageRing?: ReactNode;
  usageDetails?: ReactNode;
}) {
  const [page, setPage] = useState<SetupSheetPage>(initialPage);
  useEffect(() => {
    if (open) setPage(initialPage);
  }, [open, initialPage]);
  const back = () => setPage("root");

  // Which way the next page arrives. Every sub-page is reached from root and
  // returns to it, so the page itself says the direction: a sub-page is a
  // push and enters from the right, root is a pop and enters from the left.
  // Without this both directions slid the same way and the back chevron
  // looked like it opened something new.
  const forward = page !== "root";

  // Morph the sheet between pages instead of snapping. The pages have very
  // different heights (four agent tiles against a full model list), so a plain
  // content swap resized the sheet in one frame and read as a different sheet
  // appearing rather than this one changing.
  //
  // Measured from the live page rather than its scroll height, so a page that
  // caps itself (the model list, the usage panel) animates to the height it
  // actually takes, not the height of all its content.
  const pageRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const sync = () => setBodyHeight(el.getBoundingClientRect().height);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [page, open]);
  const heading =
    page === "usage" ? "Usage" : page === "models" ? "Models" : page === "profiles" ? "Claude profile" : title;

  return (
    <VaulDrawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false} shouldScaleBackground={false}>
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay className="fixed inset-0 z-[179] bg-black/60" />
        <VaulDrawer.Content
          data-slot="agent-setup-sheet"
          aria-describedby={undefined}
          // Opt out of vaul's overshoot filler. It paints a ::after with
          // `background: inherit`, full width and 200% tall, starting at this
          // element's bottom edge. On a sheet that is flush to bottom-0 that
          // band is off screen; this one floats inset from the bottom, so the
          // band showed as an opaque square-cornered slab of bg-popover under
          // the card's rounded corners, sitting over the dimmed backdrop.
          data-vaul-custom-container="true"
          // Anchored at bottom-0, NOT inset from it, even though the card
          // floats. vaul dismisses with translate3d(0, 100%, 0) — 100% of
          // this element's own height — so an element held 8px off the bottom
          // stops 8px short and leaves a sliver of itself on screen. The
          // float is drawn by the padding here and the card below, the same
          // way components/ui/drawer.tsx does it with before:inset-2.
          className="fixed inset-x-0 bottom-0 z-[180] flex max-h-[90dvh] select-none flex-col bg-transparent px-2 pb-[max(var(--lfg-safe-bottom),0.5rem)] outline-none"
        >
          <div className="mx-auto flex min-h-0 w-full max-w-[414px] flex-col rounded-[2rem] border border-border bg-popover px-3 pb-3 text-popover-foreground shadow-2xl">
          <div className="mx-auto mb-1 mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="flex min-h-11 items-center gap-2">
            {page !== "root" ? (
              <button
                type="button"
                onClick={back}
                aria-label="Back to agent controls"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground"
              >
                <ChevronLeft className="size-5" />
              </button>
            ) : null}
            <VaulDrawer.Title className="min-w-0 flex-1 truncate text-[17px] font-semibold">
              {heading}
            </VaulDrawer.Title>
            {page === "root" && usageRing ? (
              <button
                type="button"
                onClick={() => setPage(usageDetails ? "usage" : "root")}
                aria-label="Usage and next resets"
                className="flex size-11 shrink-0 items-center justify-center rounded-full"
              >
                {usageRing}
              </button>
            ) : null}
          </div>

          <div
            className="relative overflow-hidden transition-[height] duration-[260ms] ease-out motion-reduce:transition-none"
            style={bodyHeight === null ? undefined : { height: bodyHeight }}
          >
          <div
            ref={pageRef}
            key={page}
            className={cn(
              "animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none",
              forward ? "slide-in-from-right-6" : "slide-in-from-left-6",
            )}
          >
          {page === "root" ? (
            <div className="flex flex-col gap-3 pt-2">
              <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]">
                {agents.map((agent) => (
                  <AgentTile
                    key={agent.id}
                    agent={agent}
                    onPress={() => (agent.locked ? onLockedAgent?.(agent.id) : onSelectAgent(agent.id))}
                    onLongPress={
                      agent.id === "aisdk" && profiles.length && !agent.locked
                        ? () => {
                            onSelectAgent(agent.id);
                            setPage("profiles");
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
              {modelLabel || fast || tibo ? (
                <div className="flex items-center gap-3">
                  {modelLabel ? (
                    <button
                      type="button"
                      onClick={() => setPage("models")}
                      disabled={!renderModels}
                      aria-label={`Model ${modelLabel}. Change model`}
                      className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2.5 rounded-[14px] bg-muted px-3.5 text-left text-[15px] text-foreground"
                    >
                      <span className="min-w-0 flex-1 truncate">{modelLabel}</span>
                      {renderModels ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
                    </button>
                  ) : (
                    <span className="flex-1" />
                  )}
                  {tibo ? (
                    <ToggleSquare
                      label="Tibo mode: Fast service tier and High thinking"
                      enabled={tibo.enabled}
                      onToggle={tibo.onToggle}
                      icon={<Zap className={cn("size-[18px]", tibo.enabled && "fill-orange-400 text-orange-500")} />}
                    />
                  ) : null}
                  {fast ? (
                    <ToggleSquare
                      label="Fast mode"
                      enabled={fast.enabled}
                      onToggle={fast.onToggle}
                      icon={<Gauge className={cn("size-[18px]", fast.enabled && "text-sky-500")} />}
                    />
                  ) : null}
                </div>
              ) : null}
              {thinking?.options.length ? <ThinkingBar options={thinking.options} onPick={thinking.onPick} /> : null}
            </div>
          ) : page === "models" ? (
            <div className="min-h-0 pt-1">{renderModels?.(back)}</div>
          ) : page === "usage" ? (
            <div className="max-h-[60dvh] min-h-0 overflow-y-auto pt-1">{usageDetails}</div>
          ) : (
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pt-2 [scrollbar-width:none]">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  disabled={profile.disabled}
                  aria-pressed={profile.selected}
                  aria-label={`Claude ${profile.label}`}
                  onClick={() => {
                    onSelectProfile?.(profile.id);
                    back();
                  }}
                  className={cn(
                    "flex min-h-[76px] w-[76px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl text-[15px] font-semibold disabled:opacity-40",
                    profile.selected ? "bg-foreground text-background" : "bg-muted text-foreground",
                  )}
                >
                  <img src={agents.find((agent) => agent.id === "aisdk")?.iconSrc} alt="" className="size-6" />
                  <span className="max-w-full truncate px-1">{profile.label}</span>
                </button>
              ))}
            </div>
          )}
          </div>
          </div>
          </div>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  );
}

const LONG_PRESS_MS = 400;

/** An icon-only agent. Long-press on Claude opens its profiles, as on iOS. */
function AgentTile({
  agent,
  onPress,
  onLongPress,
}: {
  agent: SetupAgentTile;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  return (
    <button
      type="button"
      aria-label={agent.locked ? `Connect ${agent.label}` : `${agent.label} agent`}
      aria-pressed={agent.selected}
      title={onLongPress ? `${agent.label}. Long-press to choose a Claude profile` : agent.label}
      onPointerDown={() => {
        fired.current = false;
        if (!onLongPress) return;
        clear();
        timer.current = window.setTimeout(() => {
          fired.current = true;
          onLongPress();
        }, LONG_PRESS_MS);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(event) => {
        if (onLongPress) event.preventDefault();
      }}
      onClick={() => {
        if (fired.current) {
          fired.current = false;
          return;
        }
        onPress();
      }}
      className={cn(
        "relative flex h-12 w-16 shrink-0 items-center justify-center rounded-[14px] border transition [-webkit-touch-callout:none]",
        agent.selected
          ? "border-muted-foreground bg-foreground/15"
          : "border-transparent bg-muted",
      )}
    >
      <img
        src={agent.iconSrc}
        alt=""
        draggable={false}
        className={cn("size-7 select-none", agent.locked && "opacity-40 grayscale")}
      />
      {agent.locked ? (
        <span
          aria-hidden
          className="absolute bottom-1 right-2 flex size-3.5 items-center justify-center rounded-full bg-muted-foreground/70 text-background"
        >
          <Plus className="size-2.5" strokeWidth={3} />
        </span>
      ) : agent.badge != null ? (
        <span
          aria-hidden
          className="absolute bottom-1 right-2 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[8px] font-bold leading-none text-background"
        >
          {agent.badge}
        </span>
      ) : null}
    </button>
  );
}

function ToggleSquare({
  label,
  enabled,
  onToggle,
  icon,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        "flex size-[52px] shrink-0 items-center justify-center rounded-[14px] bg-muted",
        enabled ? "text-foreground ring-1 ring-inset ring-foreground/25" : "text-muted-foreground",
      )}
    >
      {icon}
    </button>
  );
}

/** The iOS thinking gradient, darkened for white label contrast. */
const THINKING_GRADIENT = "linear-gradient(90deg, #2169BD 0%, #595CBE 34%, #914BAD 68%, #AF49B3 100%)";

/**
 * The whole bar owns the gesture: press, drag across, release to pick. The
 * fill always spans the full bar, so its width is the only thing that moves.
 */
export function ThinkingBar({ options, onPick }: { options: SetupChoice[]; onPick: (id: string) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.selected));
  const active = dragIndex ?? selectedIndex;
  const indexAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || !rect.width) return selectedIndex;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(options.length - 1, Math.floor(ratio * options.length)));
  };
  const preview = (clientX: number) => {
    const index = indexAt(clientX);
    if (!options[index]?.disabled) setDragIndex(index);
  };
  const step = (delta: number) => {
    const option = options[selectedIndex + delta];
    if (option && !option.disabled) onPick(option.id);
  };
  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Thinking level"
      aria-valuemin={0}
      aria-valuemax={options.length - 1}
      aria-valuenow={active}
      aria-valuetext={options[active]?.label}
      data-vaul-no-drag
      style={{ touchAction: "none" }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          step(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          step(-1);
        }
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        preview(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragIndex !== null) preview(event.clientX);
      }}
      onPointerUp={(event) => {
        const index = indexAt(event.clientX);
        const option = options[index];
        setDragIndex(null);
        if (option && !option.disabled && index !== selectedIndex) onPick(option.id);
      }}
      onPointerCancel={() => setDragIndex(null)}
      className="relative flex h-[52px] select-none overflow-hidden rounded-[14px] bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden rounded-[14px] transition-[width] duration-150 ease-out motion-reduce:transition-none"
        style={{ width: `${((active + 1) / options.length) * 100}%` }}
      >
        <div className="h-full" style={{ width: `${(options.length / (active + 1)) * 100}%`, background: THINKING_GRADIENT }} />
      </div>
      {options.map((option, index) => (
        <div
          key={option.id}
          aria-hidden
          className={cn(
            "pointer-events-none relative flex flex-1 items-center justify-center",
            option.disabled && "opacity-35",
          )}
        >
          {index === active ? (
            <span className="truncate px-1 text-[13px] font-semibold text-white">{option.label}</span>
          ) : (
            <span className={cn("size-1 rounded-full", index < active ? "bg-white" : "bg-muted-foreground")} />
          )}
        </div>
      ))}
    </div>
  );
}
