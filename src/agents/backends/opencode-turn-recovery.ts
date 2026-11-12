export const OPENCODE_RECOVERY_MESSAGE = "The reply could not be completed. Please send your message again.";
export const OPENCODE_OUT_OF_CREDIT_MESSAGE =
  "You are out of AI credit, so the agent could not reply. Upgrade your plan or wait until your credit resets, then send your message again.";
export const OPENCODE_MODEL_NOT_IN_PLAN_MESSAGE =
  "Your plan does not include this model. Choose another model or upgrade your plan, then send your message again.";

/**
 * The text shown when a turn fails. A billing refusal from the hosted router
 * (HTTP 402) cannot succeed on a resend, so it gets its own message. Before
 * this, an out-of-credit customer saw "Please send your message again" three
 * times and then cancelled (2026-10-24). OpenCode reports the router reply as
 * "Payment Required: <router text>".
 */
export function opencodeTurnFailureMessage(error: unknown): string {
  if (error instanceof OpencodeProviderWait) return error.message;
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/upgrade your plan to use this model|model_not_in_plan/i.test(text)) return OPENCODE_MODEL_NOT_IN_PLAN_MESSAGE;
  if (/out of credits?|insufficient.?credit/i.test(text)) return OPENCODE_OUT_OF_CREDIT_MESSAGE;
  return OPENCODE_RECOVERY_MESSAGE;
}

export class EmptyOpencodeReply extends Error {}

/**
 * The turn stopped because the provider asked OpenCode to wait too long. The
 * message is the provider's own text, so it is shown as it is.
 */
export class OpencodeProviderWait extends Error {}

/**
 * The longest provider retry wait a turn sits through. OpenCode obeys the
 * provider's Retry-After header with no practical cap (2^31 ms). A plan usage
 * limit ("5 hour usage limit reached. It will reset in 1 hour 47 minutes")
 * therefore left a session on Working for over two hours with nothing on
 * screen (2026-11-12). Its normal backoff stays under 30 s per attempt.
 */
export const OPENCODE_MAX_RETRY_WAIT_MS = 2 * 60_000;

export type OpencodeRetryStatus = { type?: string; attempt?: number; message?: string; next?: number };

/**
 * What to do with an OpenCode `session.status` value. OpenCode reports a
 * provider retry ONLY this way: no `session.error` arrives until every
 * attempt has failed, and `session.prompt()` stays open the whole time.
 */
export function opencodeRetryDecision(
  status: OpencodeRetryStatus | null | undefined,
  now: number,
  maxWaitMs = OPENCODE_MAX_RETRY_WAIT_MS,
): { action: "notice"; text: string } | { action: "stop"; text: string } | null {
  if (status?.type !== "retry") return null;
  const reason = status.message?.trim() || "The model provider is not answering";
  const waitMs = typeof status.next === "number" ? Math.max(0, status.next - now) : 0;
  if (waitMs > maxWaitMs) {
    return {
      action: "stop",
      text: `${reason}\n\nThe model provider asked to wait about ${formatWait(waitMs)} before the next try, so this turn stopped. Choose another model, or send your message again later.`,
    };
  }
  const attempt = typeof status.attempt === "number" ? ` (attempt ${status.attempt})` : "";
  return { action: "notice", text: `${reason}. Trying again in ${formatWait(waitMs)}${attempt}.` };
}

function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** Check persisted parts too: the event stream may have missed a tool call. */
export function opencodeTurnHasProgress(messages: Array<{
  info: { role: string; time: { created: number } };
  parts: Array<{ type: string; text?: string }>;
}>, since: number): boolean {
  return messages.some(({ info, parts }) => info.role === "assistant" && info.time.created >= since &&
    parts.some(part => part.type === "tool" ||
      ((part.type === "text" || part.type === "reasoning") && !!part.text?.trim())));
}

function retryable(error: unknown): boolean {
  // The provider already said when it can take a request again.
  if (error instanceof OpencodeProviderWait) return false;
  const text = error instanceof Error ? error.message : String(error);
  // Configuration and request failures need a change, not another request.
  if (/unauthorized|forbidden|auth|api.?key|not found|too large|context|quota|credit|billing|invalid|unsupported/i.test(text)) return false;
  return error instanceof EmptyOpencodeReply ||
    /timeout|timed out|connection|fetch failed|ECONNRESET|EAI_AGAIN|rate.?limit|\b(408|429|500|502|503|504)\b|temporarily unavailable|overloaded/i.test(text);
}

/** Retry once, before any visible output or tool activity. The caller owns cancellation. */
export async function recoverOpencodeTurn<T>(options: {
  request: () => Promise<T>;
  abort: () => Promise<unknown>;
  stopped: () => boolean;
  hasProgress: () => boolean | Promise<boolean>;
  report: (error: unknown) => void;
  pause?: () => Promise<unknown>;
}): Promise<T | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.stopped()) return;
    try {
      const result = await options.request();
      return options.stopped() ? undefined : result;
    } catch (error) {
      if (options.stopped()) return;
      options.report(error);
      // Settle the old provider turn before starting another one.
      await options.abort();
      if (options.stopped()) return;
      if (attempt || !retryable(error) || await options.hasProgress()) throw error;
      await (options.pause ?? (() => Bun.sleep(1000)))();
    }
  }
}
