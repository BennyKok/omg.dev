import { parseOmgPromptEnvelope } from "./omg-prompt-envelope";
import { classifySystemMessage } from "./system-message";

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
  const system = classifySystemMessage(promptPreviewText(value));
  if (system) return system.kind !== "routine";
  return (
    /^\[Request interrupted by user(?: for tool use)?\]/i.test(value) ||
    /^\[Image:/i.test(value)
  );
}

/**
 * The text a preview may show for one turn: the person's task alone.
 *
 * A managed session's first user turn carries omg.dev's launch envelope (the
 * runtime contract, standing instructions, first-run rules) ahead of the
 * task. The transcript folds that into its own block. Every one-line preview
 * (card header, rail row, bot row) must read through this, or a customer sees
 * "=== omg.dev RUNTIME CONTRACT ..." where their own request belongs.
 */
export function promptPreviewText(text?: string): string {
  const value = text ?? "";
  return parseOmgPromptEnvelope(value)?.task ?? value;
}

/**
 * Keep prose for a one-line session description and remove fenced code.
 * An unclosed fence removes the rest of the message because it is still code.
 */
export function prosePreviewText(text?: string): string {
  const lines = promptPreviewText(text).split(/\r?\n/);
  const prose: string[] = [];
  let fence: "```" | "~~~" | null = null;
  for (const line of lines) {
    const marker = line.trimStart().slice(0, 3);
    if (marker === "```" || marker === "~~~") {
      if (!fence) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (!fence) prose.push(line);
  }
  return prose.join(" ").replace(/\s+/g, " ").trim();
}
