/**
 * What a session row says underneath its name.
 *
 * The phone showed `lastUserText` — the last thing YOU said. That line never
 * moved while an agent worked, so a row that had been running for ten minutes
 * still advertised the prompt that started it, and the list could not be used
 * to tell what was happening. The rail has always shown the latest turn in the
 * transcript whoever spoke it.
 *
 * `session.last` is that turn, already on the wire. This module only decides
 * whether it is fit to show.
 */

type PreviewSession = {
  last?: { role?: string; kind?: string; text?: string; ts?: number } | null;
  lastUserText?: string | null;
};

/**
 * Turns that exist for ordering and attribution rather than to be read.
 *
 * A HAND-MAINTAINED COPY of isMachineryPreviewText() in
 * web/src/lib/transcript-status.ts, which has tests. When one of these lands
 * last the row advertises it: a real session whose preview reads
 * "[Request interrupted by user]" or "[Message from …]" looks broken, and the
 * home screen was showing exactly that.
 */
export function isMachineryPreviewText(text?: string | null): boolean {
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

/** Collapse whitespace so a multi-line turn cannot blow out a one-line row. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The preview line for a session row.
 *
 * The latest turn wins. It falls back to the last user text only when the
 * latest turn is machinery or empty, so the row still says SOMETHING on a
 * session whose most recent event was plumbing — and returns "" rather than a
 * placeholder, because the row reserves the line either way and an empty line
 * is quieter than "No messages".
 *
 * The web walks the whole transcript backwards past every machinery turn. The
 * phone has one turn to work with here, not the transcript, so it checks the
 * two it has rather than pretending to the same reach.
 */
export function sessionPreview(session: PreviewSession): string {
  const latest = session.last?.text?.trim();
  if (latest && !isMachineryPreviewText(latest)) return flatten(latest);
  const user = session.lastUserText?.trim();
  if (user && !isMachineryPreviewText(user)) return flatten(user);
  return "";
}
