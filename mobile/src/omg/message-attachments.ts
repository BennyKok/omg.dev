/**
 * Splitting the "Attached file(s):" block back off a user message.
 *
 * ATTACHMENTS TRAVEL AS TEXT. The composer uploads the bytes to the Computer,
 * gets back an absolute path, and appends a trailing block to the message (see
 * `useAttachments().compose` in attachments.ts) because coding agents read
 * local files — the path IS the delivery mechanism and has to stay in what the
 * agent receives.
 *
 * It reads terribly in the transcript, though: a screenshot someone picked from
 * their library rendered as a line of
 * `/tmp/lfg-uploads/…-IMG_0850.png` under their sentence. This module splits
 * the block back off for DISPLAY ONLY, so the bubble can show the picture and
 * the words the user actually typed. The message itself is untouched — copy,
 * search, and what the agent saw all keep the raw text.
 *
 * THIS IS A PORT, NOT A NEW PARSER. web/src/lib/message-attachments.ts is the
 * original and the two must agree character for character, or the same message
 * renders as a path on one surface and a picture on the other. mobile/ is not a
 * workspace member (it consumes the published @omg-dev packages), so the code
 * cannot simply be imported — scripts/check-attachment-drift.ts diffs the two
 * behaviourally and fails the build when they stop matching, which is the same
 * guard palette.ts already uses against web/src/index.css.
 */

export type MessageAttachment = {
  name: string;
  path: string;
  /** Transcript path for the persisted bytes, or `null` when not displayable. */
  url: string | null;
};

export type ParsedMessageText = {
  /** The message with the attachment block removed. */
  body: string;
  attachments: MessageAttachment[];
};

// Matches the trailing block `compose` appends. Anchored to the end so an
// "Attached files:" the user typed mid-message is left alone.
const ATTACHMENT_BLOCK = /(?:^|\n\n)Attached files?:\n((?:-[^\n]*(?:\n|$))+)$/;

// `- <name>: <path>`. The name is greedy so a colon inside the *name* (rare but
// legal) still splits on the final ": /" that starts the absolute path.
const ATTACHMENT_LINE = /^- (.*): (\/\S.*?)\s*$/;

// The directory the upload endpoint writes into. Only files that live there are
// servable, so anything else (a path the user typed by hand) stays as text.
const UPLOAD_DIR_MARKER = "/lfg-uploads/";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

function fileExtension(path: string): string {
  const leaf = path.split("/").pop() || "";
  const dot = leaf.lastIndexOf(".");
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : "";
}

export function isDisplayableAttachment(path: string): boolean {
  return path.includes(UPLOAD_DIR_MARKER) && IMAGE_EXTENSIONS.has(fileExtension(path));
}

/**
 * The transcript path for an uploaded file. Uploads live in the server's
 * tmpdir rather than the artifact store, and the client doesn't know what that
 * directory is, so the endpoint takes the basename and resolves it server-side.
 */
export function uploadRequestPath(path: string): string {
  const name = path.split("/").pop() || "";
  return `/api/uploads/${encodeURIComponent(name)}`;
}

export function parseMessageAttachments(text: string): ParsedMessageText {
  if (!text || !text.includes("Attached file")) return { body: text, attachments: [] };

  const match = text.match(ATTACHMENT_BLOCK);
  if (!match) return { body: text, attachments: [] };

  const lines = match[1]!.split("\n").filter((line) => line.trim().length > 0);
  const attachments: MessageAttachment[] = [];
  for (const line of lines) {
    const parsed = line.match(ATTACHMENT_LINE);
    // A block we can't fully account for is left in the text rather than
    // partially hidden — better a path on screen than a silently dropped line.
    if (!parsed) return { body: text, attachments: [] };
    const name = parsed[1]!.trim();
    const path = parsed[2]!;
    attachments.push({
      name: name || path.split("/").pop() || "attachment",
      path,
      url: isDisplayableAttachment(path) ? uploadRequestPath(path) : null,
    });
  }
  if (!attachments.length) return { body: text, attachments: [] };

  return { body: text.slice(0, match.index).trimEnd(), attachments };
}
