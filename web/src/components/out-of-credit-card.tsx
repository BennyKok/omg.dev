/**
 * THE OUT-OF-CREDIT CARD.
 *
 * When the hosted AI router refuses a turn because the account has no AI
 * credit left (HTTP 402), the OpenCode backend writes one fixed sentence into
 * the transcript (src/agents/backends/opencode-turn-recovery.ts,
 * OPENCODE_OUT_OF_CREDIT_MESSAGE). Rendered as an ordinary reply, that sentence
 * read as an error: people did not realise they had to upgrade (2026-10-30).
 *
 * This card draws that turn as what it is, a plan limit, with an Upgrade
 * button. LFG knows nothing about plans or prices, so the button hands the
 * refusal to the host's upgrade surface (onPlanLimit, action "out-of-credit"),
 * the same handoff the agent-limit refusal uses. A fresh refusal also hands
 * itself over once, so the upgrade dialog opens without a tap. A standalone
 * box has no host, so it shows the sentence with no button.
 */
import { useEffect } from "react";
import { Sparkles } from "lucide-react";
import { useEmbeddedHostOptions } from "@/lib/embedded-host-options";

/** The leading sentence of OPENCODE_OUT_OF_CREDIT_MESSAGE. */
const OUT_OF_CREDIT_LEAD = "You are out of AI credit, so the agent could not reply.";

/** A refusal this recent opens the host's upgrade dialog by itself. */
export const OUT_OF_CREDIT_AUTO_OPEN_MS = 2 * 60_000;

/** True for the transcript turn the backend writes when the router refuses for credit. */
export function isOutOfCreditNotice(text: string | null | undefined): boolean {
  return (text ?? "").trim().startsWith(OUT_OF_CREDIT_LEAD);
}

/** Messages already handed to the host in this page, so a re-render or remount never reopens it. */
const handedOff = new Set<string>();

/** Test hook: forget which refusals were handed over. */
export function resetOutOfCreditHandoffs(): void {
  handedOff.clear();
}

function tsMs(ts: number | undefined): number | null {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return null;
  return ts < 1e12 ? ts * 1000 : ts;
}

export function OutOfCreditCard({
  text,
  messageKey,
  ts,
  now = Date.now,
}: {
  /** The backend's sentence, shown on a box with no host. */
  text: string;
  /** Stable identity of this transcript row. Without one the card never opens the dialog by itself. */
  messageKey?: string;
  /** When the refusal was written. */
  ts?: number;
  now?: () => number;
}) {
  const { onPlanLimit } = useEmbeddedHostOptions();
  const writtenAt = tsMs(ts);
  const fresh = writtenAt != null && now() - writtenAt < OUT_OF_CREDIT_AUTO_OPEN_MS;

  useEffect(() => {
    if (!onPlanLimit || !messageKey || !fresh || handedOff.has(messageKey)) return;
    handedOff.add(messageKey);
    onPlanLimit({ message: text, action: "out-of-credit" });
  }, [onPlanLimit, messageKey, fresh, text]);

  if (!onPlanLimit) {
    return <p className="text-[15px] leading-relaxed">{text}</p>;
  }

  return (
    <div
      data-testid="out-of-credit-card"
      className="flex w-full max-w-md flex-col gap-3 rounded-[18px] border border-border bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary"
        >
          <Sparkles className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-snug">You're out of AI credit</p>
          <p className="mt-1 text-[13.5px] leading-snug text-muted-foreground">
            Upgrade to keep building. Your chat is saved, so you can send your message again after you upgrade.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onPlanLimit({ message: text, action: "out-of-credit" })}
        className="min-h-11 w-full rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80"
      >
        Upgrade
      </button>
    </div>
  );
}
