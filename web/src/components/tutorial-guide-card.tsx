// The tutorial guide card as drawn (tutorial-guide.tsx places it). A lazy
// chunk: the surface loads it only while a host's tutorial runs.

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Mic, X } from "lucide-react";
import type { HostGuideCard, HostGuideCardStore, HostGuideMood } from "@/lib/embedded-host-options";
import { cn } from "@/lib/utils";

export default function GuideCardView({
  mode,
  store,
  card,
  fill,
  className,
}: {
  mode: "card" | "resume";
  store: HostGuideCardStore;
  card: HostGuideCard;
  fill: (text: string) => boolean | void;
  className?: string;
}) {
  return mode === "card" ? (
    <GuideCard store={store} card={card} fill={fill} className={className} />
  ) : (
    <ResumeRow store={store} card={card} className={className} />
  );
}

function Avatar({ store, mood, size }: { store: HostGuideCardStore; mood: HostGuideMood; size: number }) {
  if (!store.renderAvatar) return null;
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
      {store.renderAvatar(mood, size)}
    </span>
  );
}

function StepDots({ step }: { step: NonNullable<HostGuideCard["step"]> }) {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: step.count }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all",
            i + 1 < step.number ? "w-1.5 bg-primary" : i + 1 === step.number ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/25",
          )}
        />
      ))}
    </span>
  );
}

function GuideCard({
  store,
  card,
  fill,
  className,
}: {
  store: HostGuideCardStore;
  card: HostGuideCard;
  fill: (text: string) => boolean | void;
  className?: string;
}) {
  // Per step (the parent keys this by card.key).
  const [confirmStop, setConfirmStop] = useState(false);
  const [filled, setFilled] = useState(false);
  useEffect(() => setFilled(false), [card.sentence?.text]);
  const stepLabel = card.step ? `Step ${card.step.number} of ${card.step.count}` : null;

  // The host owns hidden: a hidden guide also lets the chat box send anything.
  if (card.collapsed) {
    return (
      <button
        type="button"
        data-testid="tutorial-guide-collapsed"
        onClick={() => store.onAction("show")}
        className={cn(
          "mb-2 flex w-full items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2 text-left shadow-sm",
          className,
        )}
      >
        <Avatar store={store} mood={card.mood} size={24} />
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {stepLabel ? <span className="font-semibold">{stepLabel} · </span> : null}
          <span className="text-muted-foreground">{card.text}</span>
        </span>
        <span className="flex items-center gap-0.5 text-[12.5px] font-semibold text-primary">
          Show <ChevronUp className="size-3.5" aria-hidden="true" />
        </span>
      </button>
    );
  }

  return (
    <section
      data-testid="tutorial-guide-card"
      data-guide-key={card.key}
      aria-label="Tutorial guide"
      className={cn(
        // In the page flow, above the field. The cap keeps the chat visible on
        // a short phone; a long card scrolls inside itself.
        "mb-2 max-h-[min(22rem,45dvh)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card px-3.5 pb-3 pt-2.5 shadow-sm",
        className,
      )}
    >
      <header className="flex items-center gap-2.5">
        <Avatar store={store} mood={card.mood} size={32} />
        <div className="min-w-0 flex-1">
          {stepLabel ? (
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-muted-foreground">{stepLabel}</span>
              {card.step ? <StepDots step={card.step} /> : null}
            </div>
          ) : (
            <span className="block truncate text-[12px] font-semibold text-muted-foreground">{card.title}</span>
          )}
        </div>
        <button
          type="button"
          aria-label="Hide the guide"
          title="Hide the guide"
          onClick={() => store.onAction("hide")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <ChevronDown className="size-4" />
        </button>
        {card.stoppable ? (
          <button
            type="button"
            aria-label="Quit tutorial"
            title="Quit tutorial"
            onClick={() => setConfirmStop(true)}
            className="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </header>

      {confirmStop ? (
        <div className="mt-2" role="alertdialog" aria-label="Quit tutorial?">
          <p className="text-[14.5px] font-semibold leading-snug">Quit this tutorial?</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
            Your app and this chat stay. You can start the tutorial again from Tutorials.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmStop(false)}
              className="flex h-9 flex-1 items-center justify-center rounded-full bg-primary text-[13.5px] font-semibold text-primary-foreground"
            >
              Keep going
            </button>
            <button
              type="button"
              onClick={() => store.onAction("stop")}
              className="flex h-9 flex-1 items-center justify-center rounded-full bg-muted text-[13.5px] font-semibold"
            >
              Quit
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-[14.5px] leading-snug" role="status">
            {card.text}
          </p>
          {card.sentence ? (
            <div className="mt-2 flex items-stretch gap-2">
              <p
                className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2 text-[14.5px] font-semibold leading-snug"
                aria-label={card.sentence.voice ? "Say this" : "Type this"}
              >
                {card.sentence.voice ? <Mic className="mr-1.5 inline size-3.5 -translate-y-px text-primary" aria-hidden="true" /> : null}
                {card.sentence.text}
              </p>
              {card.ready ? null : (
                <button
                  type="button"
                  aria-label="Fill in this sentence"
                  onClick={() => {
                    if (fill(card.sentence!.text) !== false) {
                      setFilled(true);
                      store.onAction("fill");
                    }
                  }}
                  className="shrink-0 self-center rounded-full bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground active:scale-95"
                >
                  {filled ? "Filled" : "Fill it in"}
                </button>
              )}
            </div>
          ) : null}
          {card.ready ? (
            <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white" aria-hidden="true">
                <Check className="size-2.5" strokeWidth={4} />
              </span>
              Ready. Tap Send.
            </p>
          ) : card.hint ? (
            <p className="mt-1.5 text-[12.5px] leading-snug text-muted-foreground">{card.hint}</p>
          ) : null}
          {card.badge ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 py-1 pr-2.5 pl-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white" aria-hidden="true">
                <Check className="size-2.5" strokeWidth={4} />
              </span>
              {card.badge}
            </span>
          ) : null}
          {card.offer ? (
            <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-muted/70 p-2.5">
              {card.offer.iconUrl ? <img src={card.offer.iconUrl} alt="" className="size-8 shrink-0 rounded-[10px]" /> : null}
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold leading-tight">Next: {card.offer.title}</p>
                {card.offer.subtitle ? <p className="truncate text-[12px] text-muted-foreground">{card.offer.subtitle}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => store.onAction(card.offer!.actionId)}
                className="h-8 shrink-0 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground"
              >
                {card.offer.label}
              </button>
            </div>
          ) : null}
          {card.actions?.length ? (
            <div className="mt-2.5 flex gap-2">
              {card.actions.map((action) => (
                <ActionButton key={action.id} action={action} onAction={() => store.onAction(action.id)} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ActionButton({ action, onAction }: { action: NonNullable<HostGuideCard["actions"]>[number]; onAction: () => void }) {
  const className = cn(
    "flex h-9 flex-1 items-center justify-center rounded-full text-[13.5px] font-semibold",
    action.primary ? "bg-primary text-primary-foreground" : "bg-muted",
  );
  if (action.href) {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" className={className} onClick={onAction}>
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onAction}>
      {action.label}
    </button>
  );
}

function ResumeRow({ store, card, className }: { store: HostGuideCardStore; card: HostGuideCard; className?: string }){
  return (
    <button
      type="button"
      data-testid="tutorial-guide-resume"
      onClick={() => store.onAction("resume")}
      className={cn(
        "mb-2 flex w-full items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2 text-left shadow-sm",
        className,
      )}
    >
      <Avatar store={store} mood={card.mood} size={24} />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        <span className="font-semibold">{card.title}</span>
        {card.step ? <span className="text-muted-foreground"> · Step {card.step.number} of {card.step.count}</span> : null}
      </span>
      <span className="text-[12.5px] font-semibold text-primary">Continue</span>
    </button>
  );
}
