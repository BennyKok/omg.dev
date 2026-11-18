export type ComposerSegmentKind = "plain" | "btw";

export interface ComposerSegment {
  text: string;
  kind: ComposerSegmentKind;
}

/**
 * Split composer text into highlight segments while preserving exact characters.
 */
export function tokenizeComposerText(text: string): ComposerSegment[] {
  if (!text) return [];
  const match = text.match(/^(\s*)(\/btw)(?=\s|$)([\s\S]*)$/i);
  if (!match) {
    return [{ text, kind: "plain" }];
  }
  const segments: ComposerSegment[] = [];
  if (match[1]) segments.push({ text: match[1], kind: "plain" });
  segments.push({ text: match[2], kind: "btw" });
  if (match[3]) segments.push({ text: match[3], kind: "plain" });
  return segments;
}

export function hasComposerHighlight(segments: ComposerSegment[]): boolean {
  return segments.some((segment) => segment.kind !== "plain");
}
