// The hosted first run's second half: what to do now that the box is yours.
//
// The connect gate stands in FRONT of the app because a framed LFG cannot run
// a session without an agent. This card deliberately does not. Its steps are
// things the person is free to never do, so it sits inside the home surface as
// a panel that can be dismissed, and the composer underneath keeps working
// while it is on screen.
//
// Step state (which of these are done) lives on the server in
// onboarding.hosted.coach and is resolved by ../lib/hosted-coach.ts, so
// finishing a step on a phone does not re-teach it on a laptop.

import { CalendarClock, Check, Rocket, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./ui/button";
import type { HostedCoachKey, HostedCoachStep } from "../lib/hosted-coach";

const STEP_ICON: Record<HostedCoachKey, LucideIcon> = {
  session: Rocket,
  schedule: CalendarClock,
};

export function HostedCoachCard({
  steps,
  onStep,
  onDismiss,
}: {
  steps: HostedCoachStep[];
  /** Run the step. The caller also records it; this card does not write state. */
  onStep: (key: HostedCoachKey) => void;
  onDismiss: () => void;
}) {
  const done = steps.filter((step) => step.done).length;
  return (
    <section
      aria-label="Getting started"
      className="rounded-xl border border-border/60 bg-card/60 p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Getting started</h2>
          <p className="text-xs text-muted-foreground">
            {done} of {steps.length} done
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="-mr-1 -mt-1 size-7 shrink-0 text-muted-foreground"
          aria-label="Dismiss getting started"
          onClick={onDismiss}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      <ol className="mt-3 flex flex-col gap-1">
        {steps.map((step) => {
          const Icon = STEP_ICON[step.key];
          return (
            <li key={step.key}>
              {/* A finished step stays visible but stops being a target: it is
                  the record of what you already did, not an offer to redo it. */}
              <button
                type="button"
                disabled={step.done}
                onClick={() => onStep(step.key)}
                className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors enabled:hover:bg-muted/60 disabled:cursor-default"
              >
                <span
                  className={
                    step.done
                      ? "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
                      : "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  }
                >
                  {step.done ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <Icon className="size-3.5" aria-hidden />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className={
                      step.done
                        ? "block text-sm text-muted-foreground line-through"
                        : "block text-sm font-medium"
                    }
                  >
                    {step.title}
                  </span>
                  {step.done ? null : (
                    <span className="block text-xs text-muted-foreground">{step.detail}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
