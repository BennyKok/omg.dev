// The one string that identifies a scheduled auto-agent run.
//
// An auto agent runs headless through the Agent SDK (src/auto/runner.ts), so it
// writes an ordinary transcript into ~/.claude/projects next to every human
// session. Nothing else on disk tells the two apart: same folder, same agent,
// same file shape. The only reliable marker is that the run's first user
// message always opens with the runner's own SYSTEM preamble.
//
// That preamble therefore lives here rather than in runner.ts, so the prompt
// builder and the resume-cache scan read the SAME literal. If you edit the
// opening sentence, both sides move together and old rows are repaired by a
// resume-cache migration (see 008_archive_scheduled_runs.sql).
export const WATCH_AGENT_OPENING = "You are an autonomous watch agent.";

/** True when a transcript's first prompt is a scheduled auto-agent run. */
export function isScheduledRunPrompt(text: string | null | undefined): boolean {
  return (text ?? "").trimStart().startsWith(WATCH_AGENT_OPENING);
}
