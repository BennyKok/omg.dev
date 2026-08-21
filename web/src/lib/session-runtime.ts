export type DriveableSession = {
  agent?: string | null;
  runtime?: "tmux" | "command-file" | null;
  tmuxTarget?: string | null;
  shippedReview?: boolean;
};

function isLegacyHarnessAgent(agent?: string | null): boolean {
  return agent === "aisdk" || agent === "codex-aisdk" || agent === "opencode";
}

/** True when the Live view can control this session without a terminal pane. */
export function canDriveSession(session: DriveableSession): boolean {
  if (session.shippedReview) return false;
  // Every new SDK/ACP provider uses the command-file control plane and has no
  // tmux target. Keep the legacy agent-name check for older harness rows that
  // predate the persisted runtime field.
  return (
    !!session.tmuxTarget ||
    session.runtime === "command-file" ||
    isLegacyHarnessAgent(session.agent)
  );
}
