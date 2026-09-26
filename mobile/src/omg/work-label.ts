/**
 * The one line a run of work shows: "Working for 4s" while the agent is still
 * in it, "Worked for 12s" once it is done. Mirrors toolGroupWorkLabel in the
 * root src/transcript-rows.ts so both clients say the same thing about the
 * same run. Pure, so the two copies can be checked against each other.
 */

/** "4s", "1m 20s", "2m". Never zero for work that did happen. */
export function formatWorkDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/**
 * What a running agent is doing, in plain words, from its latest step. Same
 * table as workStepLabel in the root src/transcript-rows.ts; a root test
 * checks the two against each other.
 */
export function workStepLabel(step: { kind?: string; name?: string | null } | null): string {
  if (!step) return "Working";
  if (step.kind === "thinking") return "Thinking";
  const name = (step.name ?? "")
    .toLowerCase()
    .replace(/^mcp__.+?__/, "")
    .replace(/^(omg|lfg)_/, "");
  if (name === "deploy") return "Deploying";
  if (name === "expose_port") return "Starting the preview";
  if (/^(display_|publish_artifact|screenshot|computer_screenshot)/.test(name)) return "Sharing a result";
  if (/^(write|edit|multiedit|apply_patch|patch|notebookedit|create_file|str_replace)/.test(name)) return "Writing code";
  if (/^(read|grep|glob|ls|list|find|search|view)/.test(name)) return "Reading files";
  if (/^(bash|shell|local_shell|exec|command|run)/.test(name)) return "Running commands";
  if (/^(webfetch|websearch|web_search|fetch)/.test(name)) return "Researching";
  if (/^(todowrite|todoread|update_plan|plan|task)/.test(name)) return "Planning";
  return "Working";
}

function latestStep(entries: ReadonlyArray<{ kind?: string; text?: string }>): { kind?: string; name?: string | null } | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.kind === "thinking") return { kind: "thinking" };
    if (entry.kind === "tool_use") {
      return { kind: "tool_use", name: (entry.text || "").split(":")[0].trim().split(/\s+/)[0] || null };
    }
  }
  return null;
}

export function workLabel(
  entries: ReadonlyArray<{ ts?: number | null; kind?: string; text?: string }>,
  options: { live: boolean; now?: number; endTs?: number | null },
): string {
  let start: number | null = null;
  let last: number | null = null;
  for (const entry of entries) {
    if (typeof entry.ts !== "number") continue;
    if (start === null || entry.ts < start) start = entry.ts;
    if (last === null || entry.ts > last) last = entry.ts;
  }
  if (options.live) {
    const now = options.now ?? Date.now();
    const step = workStepLabel(latestStep(entries));
    return start === null ? `${step}…` : `${step} · ${formatWorkDuration(now - start)}`;
  }
  const end = options.endTs ?? last;
  if (start === null || end === null || end <= start) return "Worked";
  return `Worked for ${formatWorkDuration(end - start)}`;
}
