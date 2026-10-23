import { omgMessagesToUIMessages, type OmgChatMessage } from "./omg-chat-transport";

// The first message of a session you just created, drawn before the server
// has it.
//
// Create answers at once and starts the agent behind it, so the session opens
// before the agent has written your prompt into its transcript. Its page came
// back empty and the message appeared a moment later, which read as lost. The
// composer records the prompt here; the session's history draws it as a
// pending bubble until the transcript has a user turn of its own.

const LAUNCH_ID_PREFIX = "launch-";
/** Long enough for a slow worktree checkout; a launch that never writes the turn is reported by the session row. */
const LAUNCH_MAX_AGE_MS = 2 * 60_000;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const launches = new Map<string, { text: string; at: number }>();

export function recordLaunchMessage(sid: string, text: string): void {
  const trimmed = text.trim();
  if (!sid || !trimmed) return;
  launches.set(sid, { text: trimmed, at: Date.now() });
}

/** The pending bubble for a session created from this page, while the transcript has no user turn yet. */
export function launchMessageRows(sid: string | null | undefined): OmgChatMessage[] {
  if (!sid) return [];
  const launch = launches.get(sid);
  if (!launch) return [];
  if (Date.now() - launch.at > LAUNCH_MAX_AGE_MS) {
    launches.delete(sid);
    return [];
  }
  return omgMessagesToUIMessages([
    {
      id: `${LAUNCH_ID_PREFIX}${sid}`,
      role: "user",
      kind: "text",
      text: launch.text,
      html: escapeHtml(launch.text).replace(/\n/g, "<br>"),
      ts: launch.at,
      pending: true,
    },
  ]);
}

function isLaunchRow(message: OmgChatMessage): boolean {
  return message.id.startsWith(LAUNCH_ID_PREFIX);
}

/**
 * Drop the launch bubble once the transcript has a row of its own: normally
 * the user turn the agent wrote for it, but any confirmed row counts, so a run
 * that hides its launch text cannot leave the bubble behind. Returns
 * `messages` itself when nothing changes.
 */
export function settleLaunchMessage(sid: string | null | undefined, messages: OmgChatMessage[]): OmgChatMessage[] {
  if (!sid || !messages.some(isLaunchRow)) return messages;
  const confirmed = messages.some(
    (message) => !isLaunchRow(message) && !message.metadata?.omgMessage?.pending,
  );
  if (!confirmed) return messages;
  launches.delete(sid);
  return messages.filter((message) => !isLaunchRow(message));
}
