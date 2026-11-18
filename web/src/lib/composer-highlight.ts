export type ComposerSegmentKind = "plain" | "command" | "mention";

export interface ComposerSegment {
  text: string;
  kind: ComposerSegmentKind;
}

const LEADING_COMMAND_RE = /^(\s*)(\/[a-zA-Z0-9:_-]+)(?=\s|$)([\s\S]*)$/;
const MENTION_RE = /(^|\s)(@[a-zA-Z0-9_./:-]+)(?=\s|$|[.,!?;:)\]])/g;

function tokenizeMentions(text: string): ComposerSegment[] {
  if (!text) return [];
  const out: ComposerSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(MENTION_RE)) {
    const idx = match.index ?? 0;
    const prefix = match[1] ?? "";
    const mention = match[2] ?? "";
    const mentionStart = idx + prefix.length;

    if (mentionStart > lastIndex) {
      out.push({ text: text.slice(lastIndex, mentionStart), kind: "plain" });
    }
    out.push({ text: mention, kind: "mention" });
    lastIndex = mentionStart + mention.length;
  }

  if (lastIndex < text.length) {
    out.push({ text: text.slice(lastIndex), kind: "plain" });
  }
  return out;
}

/**
 * Split composer text into highlight segments while preserving exact characters.
 * Supports a leading `/command` (such as `/btw`, `/fast`, or a skill) and `@mention` tokens.
 */
export function tokenizeComposerText(text: string): ComposerSegment[] {
  if (!text) return [];
  const cmdMatch = text.match(LEADING_COMMAND_RE);
  if (!cmdMatch) {
    return tokenizeMentions(text);
  }
  const segments: ComposerSegment[] = [];
  if (cmdMatch[1]) segments.push({ text: cmdMatch[1], kind: "plain" });
  segments.push({ text: cmdMatch[2], kind: "command" });
  if (cmdMatch[3]) {
    segments.push(...tokenizeMentions(cmdMatch[3]));
  }
  return segments;
}

export function hasComposerHighlight(segments: ComposerSegment[]): boolean {
  return segments.some((segment) => segment.kind !== "plain");
}
