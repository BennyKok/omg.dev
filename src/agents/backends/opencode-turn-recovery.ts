export const OPENCODE_RECOVERY_MESSAGE = "The reply could not be completed. Please send your message again.";

export class EmptyOpencodeReply extends Error {}

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
