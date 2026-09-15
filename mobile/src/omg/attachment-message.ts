/**
 * The trailing block that carries attachments to the agent.
 *
 * ATTACHMENTS TRAVEL AS TEXT. The bytes go to the Computer, which writes them
 * into its uploads dir and hands back an absolute path; the message then names
 * those paths:
 *
 *     Attached files:
 *     - IMG_0850.png: /tmp/lfg-uploads/…-IMG_0850.png
 *
 * Coding agents read local files, so the path IS the delivery mechanism.
 *
 * ── Why this is its own module ────────────────────────────────────────────
 *
 * `composeAttachmentMessage` in web/src/App.tsx builds the identical block and
 * web/src/lib/message-attachments.ts parses it back off for display. Diverge by
 * a character and the same message renders as a path on one surface and a
 * picture on the other.
 *
 * There are now two callers on this side -- the composers, through
 * useAttachments, and the onboarding launch, which uploads before there is a
 * session to attach to -- so the format lives here rather than being written
 * out twice. No imports, so it can be tested without a React Native runtime.
 */
export type AttachedPath = {
  name: string;
  /** Absolute path ON THE COMPUTER. */
  path: string;
};

export function composeAttachmentMessage(text: string, attached: readonly AttachedPath[]): string {
  if (!attached.length) return text;
  const label = attached.length === 1 ? "Attached file" : "Attached files";
  const list = attached.map((item) => `- ${item.name}: ${item.path}`).join("\n");
  return [text, `${label}:\n${list}`].filter(Boolean).join("\n\n");
}
