// Ported from web/src/lib/omg-prompt-envelope.ts — keep the two in sync. If
// the header/end/task markers ever change, update both, or (better) move this
// into packages/ so mobile and web share one implementation instead of two
// copies that can quietly drift.

export type OmgPromptEnvelope = {
  instructions: string;
  task: string;
  version: string | null;
};

// The envelope was branded "LFG", then "OMG", before settling on the company
// name "omg.dev". All three spellings must parse forever: every transcript
// recorded under an older brand still opens with that header, and those messages
// are re-rendered every time the session is opened. Recognising only the current
// one would regress them to showing the raw contract.
const CONTRACT_HEADERS = [
  "=== omg.dev RUNTIME CONTRACT",
  "=== OMG RUNTIME CONTRACT",
  "=== LFG RUNTIME CONTRACT",
] as const;
const CONTRACT_ENDS = [
  "=== END omg.dev RUNTIME CONTRACT ===",
  "=== END OMG RUNTIME CONTRACT ===",
  "=== END LFG RUNTIME CONTRACT ===",
] as const;
const USER_TASK = "=== USER TASK ===";
// Envelopes with no END marker, each terminated by USER TASK. Keep in step
// with SUBAGENT_HEADERS in src/omg-capabilities.ts.
const INNER_ENVELOPE_HEADERS = [
  "=== omg.dev FIRST RUN ===",
  "=== omg.dev THREAD TASK ===",
  "=== omg.dev SUBAGENT OPERATING CONTRACT ===",
  "=== OMG SUBAGENT OPERATING CONTRACT ===",
  "=== LFG SUBAGENT OPERATING CONTRACT ===",
] as const;

/**
 * Splits omg.dev's agent-facing launch envelope for presentation only.
 *
 * The complete text remains in the transcript and is still sent to the agent;
 * callers use this projection to keep the user's actual first message readable.
 */
export function parseOmgPromptEnvelope(text: string): OmgPromptEnvelope | null {
  const header = CONTRACT_HEADERS.find((candidate) => text.startsWith(candidate));
  if (!header) return null;

  const headerEnd = text.indexOf("\n");
  if (headerEnd < 0) return null;

  // Pair the end marker to whichever spelling opened the envelope, but accept
  // either: a prompt resumed across the rename can legitimately be mixed.
  let contractEnd = -1;
  let endMarker = "";
  for (const candidate of CONTRACT_ENDS) {
    const at = text.indexOf(candidate, headerEnd + 1);
    if (at < 0) continue;
    if (contractEnd < 0 || at < contractEnd) {
      contractEnd = at;
      endMarker = candidate;
    }
  }
  if (contractEnd < 0) return null;

  const taskMarker = text.indexOf(USER_TASK, contractEnd + endMarker.length);
  if (taskMarker < 0) return null;

  const headerLine = text.slice(0, headerEnd);
  const version = headerLine.match(/\(capability version ([^)]+)\)/)?.[1] ?? null;
  // Keep in lockstep with web/src/lib/omg-prompt-envelope.ts: standing
  // instructions ride after the END marker and belong in the inspect chip.
  const contractBody = text.slice(headerEnd + 1, contractEnd).trim();
  const standing = text.slice(contractEnd + endMarker.length, taskMarker).trim();
  let task = text.slice(taskMarker + USER_TASK.length).replace(/^\s*\n?/, "").trim();
  // Inner envelopes (first run, subagent, thread task) sit after the first
  // USER TASK and are terminated by their own USER TASK. They are agent rules,
  // not the person's words: peel them into the inspect chip so a new user's
  // first message is their prompt, not "=== omg.dev FIRST RUN ===".
  const inner: string[] = [];
  for (let i = 0; i < 4; i++) {
    const innerHeader = INNER_ENVELOPE_HEADERS.find((candidate) => task.startsWith(candidate));
    if (!innerHeader) break;
    const innerEnd = task.indexOf(USER_TASK, innerHeader.length);
    if (innerEnd < 0) break;
    inner.push(task.slice(0, innerEnd).trim());
    task = task.slice(innerEnd + USER_TASK.length).replace(/^\s*\n?/, "").trim();
  }
  const instructions = [contractBody, standing, ...inner].filter(Boolean).join("\n\n");

  if (!instructions || !task) return null;
  return { instructions, task, version };
}
