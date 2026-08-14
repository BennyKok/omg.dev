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

/**
 * Splits omg.dev's agent-facing launch envelope for presentation only.
 *
 * The complete text remains in the transcript and is still sent to the agent;
 * callers use this projection to keep the user's actual first message readable.
 */
export function parseOmgPromptEnvelope(text: string): OmgPromptEnvelope | null {
  // Managed live turns can carry the transport timestamp that omg.dev prepends
  // to user messages. Parse from the contract header, but only when the prefix is
  // exactly one timestamp, so ordinary prose that quotes a contract stays plain.
  const timestampPrefix = text.match(/^\[[^\]\n]+\]\s+/)?.[0] ?? "";
  const envelope = timestampPrefix ? text.slice(timestampPrefix.length) : text;
  const header = CONTRACT_HEADERS.find((candidate) => envelope.startsWith(candidate));
  if (!header) return null;

  const headerEnd = envelope.indexOf("\n");
  if (headerEnd < 0) return null;

  // Pair the end marker to whichever spelling opened the envelope, but accept
  // either: a prompt resumed across the rename can legitimately be mixed.
  let contractEnd = -1;
  let endMarker = "";
  for (const candidate of CONTRACT_ENDS) {
    const at = envelope.indexOf(candidate, headerEnd + 1);
    if (at < 0) continue;
    if (contractEnd < 0 || at < contractEnd) {
      contractEnd = at;
      endMarker = candidate;
    }
  }
  if (contractEnd < 0) return null;

  const taskMarker = envelope.indexOf(USER_TASK, contractEnd + endMarker.length);
  if (taskMarker < 0) return null;

  const headerLine = envelope.slice(0, headerEnd);
  const version = headerLine.match(/\(capability version ([^)]+)\)/)?.[1] ?? null;
  const instructions = envelope.slice(headerEnd + 1, contractEnd).trim();
  const task = envelope.slice(taskMarker + USER_TASK.length).replace(/^\s*\n?/, "").trim();

  if (!instructions || !task) return null;
  return { instructions, task, version };
}
