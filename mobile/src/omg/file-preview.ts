/**
 * What the file page previews, and when it asks first.
 *
 * Mirrors web/src/components/artifact-file-page.tsx so both clients make the
 * same call for the same file. Pure functions, no React, so the rules can be
 * read in one place.
 *
 * The preview is TEXT ONLY. A PDF, an archive, or an audio file gets the
 * download and nothing else; the bytes are agent-chosen and are never handed
 * to a web view or a document renderer.
 */

const TEXT_EXTENSIONS = new Set([
  "txt", "log", "md", "markdown", "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml",
  "toml", "ini", "cfg", "conf", "env", "xml", "svg", "html", "htm", "css", "scss", "less",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "h", "cc", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "fish", "ps1", "sql",
  "diff", "patch", "lock", "gitignore", "dockerfile", "makefile", "proto", "graphql", "tf",
]);

const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/javascript",
  "application/x-sh",
  "image/svg+xml",
]);

/** A text file up to this size previews on open. */
export const AUTO_PREVIEW_BYTES = 1024 * 1024;
/** Above AUTO the page asks first; above this it does not offer a preview. */
export const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
/** How much of the file the preview shows. Larger files are cut here. */
export const PREVIEW_BYTES = 1024 * 1024;
/** Rows a CSV/TSV table shows. A table of a hundred thousand rows is not a preview. */
export const TABLE_ROWS = 500;

export type PreviewPolicy = "auto" | "ask" | "none";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function baseMime(mimeType: string | undefined): string {
  return (mimeType || "").toLowerCase().split(";")[0].trim();
}

export function isTextLike(input: { name?: string; mimeType?: string }): boolean {
  const mime = baseMime(input.mimeType);
  if (mime.startsWith("text/")) return true;
  if (TEXT_MIME_EXACT.has(mime)) return true;
  const name = (input.name || "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? name : name.slice(dot + 1);
  return TEXT_EXTENSIONS.has(ext);
}

export function previewPolicy(input: { name?: string; mimeType?: string; size?: number }): PreviewPolicy {
  if (!isTextLike(input)) return "none";
  const size = input.size ?? 0;
  if (size > MAX_PREVIEW_BYTES) return "none";
  return size > AUTO_PREVIEW_BYTES ? "ask" : "auto";
}

/** A NUL in the head is the same binary test the Files panel's server side uses. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export function delimiterFor(input: { name?: string; mimeType?: string }): "," | "\t" | null {
  const mime = baseMime(input.mimeType);
  const name = (input.name || "").toLowerCase();
  if (mime === "text/tab-separated-values" || name.endsWith(".tsv")) return "\t";
  if (mime === "text/csv" || name.endsWith(".csv")) return ",";
  return null;
}

/**
 * A small CSV/TSV reader: quoted fields, doubled quotes, CRLF. It stops at
 * `maxRows`.
 */
export function parseDelimited(text: string, delimiter: "," | "\t", maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
