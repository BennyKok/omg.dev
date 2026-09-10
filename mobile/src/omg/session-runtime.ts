/**
 * Which sessions the list shows: the web's rule, copied so the two lists
 * agree (web/src/lib/session-runtime.ts).
 *
 * A session the app can drive has a tmux pane, or runs on the command-file
 * control plane, or is one of the older harness agents that predate the
 * persisted runtime field. Anything else — a bare process the box noticed
 * but does not own — cannot be steered, stopped or archived from a client,
 * and the web leaves it out. The phone used to list it, and every action on
 * it failed.
 */
export type DriveableSession = {
  agent?: string | null;
  runtime?: string | null;
  tmuxTarget?: string | null;
  shippedReview?: boolean;
};

function isLegacyHarnessAgent(agent?: string | null): boolean {
  return agent === "aisdk" || agent === "codex-aisdk" || agent === "opencode";
}

export function canDriveSession(session: DriveableSession): boolean {
  if (session.shippedReview) return false;
  return (
    !!session.tmuxTarget ||
    session.runtime === "command-file" ||
    isLegacyHarnessAgent(session.agent)
  );
}
