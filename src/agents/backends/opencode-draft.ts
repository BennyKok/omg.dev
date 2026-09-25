// Live draft state for one OpenCode turn.
//
// OpenCode sends `message.part.updated` with a full snapshot of one part. A
// turn is many assistant messages (one per model step), and each message has
// its own parts: a `reasoning` part, `text` parts and `tool` parts. Reasoning
// models such as DeepSeek V4 emit a reasoning part on almost every step and
// answer text rarely.
//
// This tracker is the single owner of what the live draft shows:
//   - answer text comes only from `text` parts. Parts of one message are kept
//     by part id and joined in arrival order, the same way the final commit
//     joins them. A part update replaces only its own slot.
//   - reasoning never becomes answer text. It is published with kind
//     "thinking" and only while no answer text is on screen.
//   - a text part from a newer assistant message starts a fresh answer draft,
//     because the final commit also comes from the last message only.

export type OpencodeDraftPart = {
  id?: string;
  type?: string;
  text?: string;
  messageID?: string;
};

export type OpencodeDraft = { text: string; kind: "text" | "thinking" };

export class OpencodeDraftTracker {
  private textMessageId: string | null = null;
  private textParts = new Map<string, string>();
  private answer = "";

  /**
   * Feed one assistant part snapshot. Returns the draft to publish, or null
   * when the visible draft does not change.
   */
  apply(part: OpencodeDraftPart): OpencodeDraft | null {
    if (typeof part.text !== "string") return null;
    if (part.type === "text") {
      if (part.messageID !== undefined && part.messageID !== this.textMessageId) {
        this.textMessageId = part.messageID;
        this.textParts.clear();
      }
      this.textParts.set(part.id ?? "", part.text);
      this.answer = [...this.textParts.values()]
        .filter((text) => text.trim())
        .join("\n\n");
      return this.answer ? { text: this.answer, kind: "text" } : null;
    }
    if (part.type === "reasoning") {
      if (this.answer || !part.text.trim()) return null;
      return { text: part.text, kind: "thinking" };
    }
    return null;
  }

  /** Forget the draft. Call at turn start and when the session goes idle. */
  reset(): void {
    this.textMessageId = null;
    this.textParts.clear();
    this.answer = "";
  }
}
