// Shared streaming-draft publisher for the AI-SDK session harnesses.
//
// The web live view animates an assistant reply *as it generates* by reading a
// transient `draftText`/`draftUpdatedAt` off the session's aisdk-registry entry
// (serve.ts sendAiTextDeltaPart streams it as `ai_part` text-delta events). Each
// harness accumulates the in-flight assistant text and calls the publisher on
// every delta; the publisher throttles the registry writes so we don't rewrite
// the entry once per token.
//
// This is the identical helper all three live harnesses (aisdk-session,
// codex-aisdk-session, opencode-aisdk-session) previously copy-pasted — factored
// out here so the throttle/tail-slice/clear semantics stay in one place.
import { patchEntry } from "../../aisdk-registry.ts";

// Build a draft publisher bound to one session's registry key. The returned
// function:
//   - throttles writes to at most one per 150ms (force=true bypasses — used at
//     turn start/end to guarantee the first/last frame lands),
//   - de-dupes (skips a write when the text is byte-identical to the last one),
//   - tail-slices to the last 12k chars (drafts are never persisted to the
//     transcript, so only the visible tail matters), and
//   - clears the draft (writes null) whenever the text is empty.
export function makeDraftPublisher(
  sessionId: string,
): (text: string, force?: boolean, kind?: "text" | "thinking") => void {
  let lastAt = 0;
  let lastText: string | undefined;
  let lastKind: "text" | "thinking" | undefined;
  return function publishDraft(text: string, force = false, kind = "text"): void {
    const now = Date.now();
    if (!force && now - lastAt < 150) return;
    if (!force && text === lastText && kind === lastKind) return;
    lastAt = now;
    lastText = text;
    lastKind = kind;
    patchEntry(sessionId, {
      draftText: text ? text.slice(-12_000) : null,
      draftKind: text ? kind : null,
      draftUpdatedAt: text ? now : null,
    });
  };
}
