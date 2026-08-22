type TranscriptStatusMessage = {
  role?: string;
  kind?: string;
  text?: string;
};

// Claude records steering as a synthetic user turn. Keep that row in the
// transcript for ordering, but let the UI distinguish it from something the
// human actually typed.
export function isRequestInterruptedMessage(message: TranscriptStatusMessage): boolean {
  if (message.role !== "user" || message.kind !== "text") return false;
  return /^\[Request interrupted by user(?: for tool use)?\]$/i.test(message.text?.trim() || "");
}

/**
 * Harness machinery that must never become a row's preview.
 *
 * A list row shows the last thing that happened in a session, which is only
 * useful if it is something a person or an agent actually said. Several
 * synthetic turns are recorded into the transcript for ordering and
 * attribution — a steer, an answered question, an attached image, a peer
 * handoff — and when one of those lands last, the row advertised the
 * plumbing: "[Request interrupted by us…" is what Benny saw on his own
 * session, and "[ask-user answer 4f2a…] Their reply:" and "[Image: original
 * 1260x2736, displayed at…" are the same class of leak.
 *
 * Deliberately NOT filtered: "[Scheduled routine: …]". That one carries the
 * prompt the routine ran, so it is the real content of that turn.
 */
export function isMachineryPreviewText(text?: string): boolean {
  const value = (text ?? "").trim();
  if (!value) return false;
  return (
    /^\[Request interrupted by user(?: for tool use)?\]/i.test(value) ||
    /^\[ask-user answer\b/i.test(value) ||
    /^\[subagent (?:progress|complete|failed)\b/i.test(value) ||
    /^\[Peer message from\b/i.test(value) ||
    /^\[Message from\b/i.test(value) ||
    /^\[Image:/i.test(value)
  );
}
