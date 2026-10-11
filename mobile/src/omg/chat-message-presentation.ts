const RECOVERY_MESSAGE = "The reply could not be completed. Please send your message again.";

/** Old transcripts keep their diagnostic text on disk. Present a safe message. */
export function assistantMessageText(text: string): string {
  if (/^OpenCode returned no assistant output for [^\n]+; check the OpenCode provider logs\.$/.test(text.trim()) ||
      /^OpenCode turn failed for [^\n]+:/.test(text.trim())) return RECOVERY_MESSAGE;
  return text;
}

/** Preserve raw text for copying and sending; discard blank trailing display space. */
export function userMessageText(text: string): string {
  return text.trimEnd();
}
