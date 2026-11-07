// How an open chat reports a failure. One rule: the server's text goes to the
// diagnostic log, never to the screen.
//
// The chat used to print whatever the server said in a red line above the
// composer. That showed "not found" with no way to act on it, after a dropped
// connection the reader never asked about. Now:
//
// - A failure the reader did not cause (the live stream, a history page, a
//   refresh) is only logged. The connection overlay owns connection state, and
//   the live socket sends a fresh snapshot when it comes back.
// - A failure of something the reader did (send, stop, rename) is a short
//   notice in plain words. Their text stays in the box where it applies.

import { toast } from "@/lib/notify";
import { errorMessage } from "./attempt";
import { evlog } from "./evlog";

/** Record a chat error for diagnosis. Nothing is shown. */
export function logChatError(source: string, sid: string | null | undefined, error: unknown): void {
  evlog("chat_error", { source, sid: sid ?? null, error: errorMessage(error) });
}

/** Tell the reader that an action failed. `title` says what did not happen. */
export function notifyChatFailure(
  title: string,
  sid: string | null | undefined,
  error: unknown,
  description = "Try again in a moment.",
): void {
  logChatError(title, sid, error);
  toast.error(title, { description });
}
