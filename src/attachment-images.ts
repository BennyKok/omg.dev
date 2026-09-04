import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const PDF_MIME = "application/pdf";

export type ExtractedAttachment = {
  path: string;
  mime: string;
  filename: string;
};

export type ExtractedPrompt = {
  cleanText: string;
  attachments: ExtractedAttachment[];
  hadBlock: boolean;
};

// Mirrors web/lib/message-attachments.ts — must stay in sync with composeAttachmentMessage.
const ATTACHMENT_BLOCK = /(?:^|\n\n)Attached files?:\n((?:-[^\n]*(?:\n|$))+)$/;
const ATTACHMENT_LINE = /^- (.*): (\/\S.*?)\s*$/;
const UPLOAD_DIR_MARKER = "/lfg-uploads/";

function mimeForPath(path: string): string | null {
  const ext = extname(path).slice(1).toLowerCase();
  if (IMAGE_MIME[ext]) return IMAGE_MIME[ext]!;
  if (ext === "pdf") return PDF_MIME;
  return null;
}

/** Extract /tmp/lfg-uploads attachment paths from the trailing "Attached file(s):" block. */
export function extractAttachments(prompt: string): ExtractedPrompt {
  const match = prompt.match(ATTACHMENT_BLOCK);
  if (!match) return { cleanText: prompt, attachments: [], hadBlock: false };

  const block = match[1] ?? "";
  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  const attachments: ExtractedAttachment[] = [];
  for (const line of lines) {
    const m = line.match(ATTACHMENT_LINE);
    if (!m) return { cleanText: prompt, attachments: [], hadBlock: false };
    const filePath = m[2]!.trim();
    if (!filePath.includes(UPLOAD_DIR_MARKER)) continue;
    // Strip traversal attempts.
    if (filePath.includes("..")) continue;
    const mime = mimeForPath(filePath);
    if (!mime) continue;
    // Only forward files that still exist — /tmp is ephemeral.
    if (!existsSync(filePath)) continue;
    const filename = m[1]!.trim() || basename(filePath);
    attachments.push({ path: filePath, mime, filename });
  }

  if (!attachments.length) return { cleanText: prompt, attachments: [], hadBlock: false };
  const cleanText = prompt.slice(0, match.index).trimEnd();
  return { cleanText, attachments, hadBlock: true };
}

/** Base64 for Claude's image/document blocks. Returns null on read failure. */
export function readAsBase64(path: string): string | null {
  try {
    return readFileSync(path).toString("base64");
  } catch {
    return null;
  }
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}
