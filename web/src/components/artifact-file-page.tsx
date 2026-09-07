import { Download, Loader2 } from "lucide-react";
import { Suspense, useEffect, useState } from "react";

import { lazyWithReload } from "../lib/lazy-with-reload";
import { omgFetch } from "../lib/omg-client";
import { useThemeType } from "../lib/use-theme-type";
import { cn } from "../lib/utils";
import {
  downloadStatusText,
  fileIcon,
  formatFileSize,
  useArtifactDownload,
} from "./artifact-file-card";

/**
 * The full page for one "file" artifact, opened by a tap on its card.
 *
 * It says what the file is, offers the download, and previews the file when
 * a preview is worth having. The preview is TEXT ONLY, drawn by the same
 * read-only viewer the Files panel uses. The bytes are agent-chosen and come
 * from the app's own origin, so they are shown as characters and never handed
 * to the browser as a document, a frame, or a plugin. A PDF, an archive, or an
 * audio file gets the download and nothing else.
 *
 * The preview policy is a size question as much as a type question. A small
 * text file loads on its own. A large one asks first, so a reader on a phone
 * network is not charged for a preview they did not want, and even then only
 * the first `PREVIEW_BYTES` are requested (the server honours byte ranges).
 */

/** Text formats worth previewing, by extension. A mime type of text/* also qualifies. */
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

export type PreviewPolicy = "auto" | "ask" | "none";

export function isTextLike(input: { name?: string; mimeType?: string }): boolean {
  const mime = (input.mimeType || "").toLowerCase().split(";")[0].trim();
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

/**
 * A small CSV/TSV reader: quoted fields, doubled quotes, CRLF. It stops at
 * `maxRows` because a table with a hundred thousand rows is not a preview.
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

const TABLE_ROWS = 500;

function delimiterFor(input: { name?: string; mimeType?: string }): "," | "\t" | null {
  const mime = (input.mimeType || "").toLowerCase().split(";")[0].trim();
  const name = (input.name || "").toLowerCase();
  if (mime === "text/tab-separated-values" || name.endsWith(".tsv")) return "\t";
  if (mime === "text/csv" || name.endsWith(".csv")) return ",";
  return null;
}

const FileViewer = lazyWithReload("session-file-viewer", () => import("./session-files/FileViewer"));

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; text: string; truncated: boolean }
  | { status: "binary" }
  | { status: "error" };

function DelimitedTable({ rows, className }: { rows: string[][]; className?: string }) {
  const [head, ...body] = rows;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return (
    <div className={cn("overflow-auto", className)}>
      <table data-slot="delimited-preview" className="min-w-full border-collapse text-left text-xs">
        {head ? (
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr>
              {Array.from({ length: width }, (_, i) => (
                <th key={i} className="whitespace-nowrap border-b border-border px-2 py-1 font-medium">
                  {head[i] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="odd:bg-muted/20">
              {Array.from({ length: width }, (_, i) => (
                <td key={i} className="whitespace-nowrap border-b border-border/60 px-2 py-1 font-mono">
                  {row[i] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type ArtifactFilePageProps = {
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
  caption?: string;
  className?: string;
};

export function ArtifactFilePage({ url, name, mimeType, size, caption, className }: ArtifactFilePageProps) {
  const Icon = fileIcon(mimeType);
  const label = name || caption || "File";
  const policy = previewPolicy({ name, mimeType, size });
  const download = useArtifactDownload({ url, name, mimeType, size });
  const themeType = useThemeType();
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  useEffect(() => {
    setPreview({ status: "idle" });
  }, [url]);

  const loadPreview = async () => {
    setPreview({ status: "loading" });
    try {
      const partial = (size ?? 0) > PREVIEW_BYTES;
      const response = await omgFetch(
        url,
        partial ? { headers: { Range: `bytes=0-${PREVIEW_BYTES - 1}` } } : undefined,
      );
      if (!response.ok) throw new Error(`artifact ${response.status}`);
      let bytes = new Uint8Array(await response.arrayBuffer());
      // A server that ignored the range sent everything; cut it here instead.
      // Partial means "fewer bytes than the file has", whatever the status.
      if (bytes.byteLength > PREVIEW_BYTES) bytes = bytes.subarray(0, PREVIEW_BYTES);
      const truncated = size != null && size > 0 ? bytes.byteLength < size : false;
      if (looksBinary(bytes)) {
        setPreview({ status: "binary" });
        return;
      }
      setPreview({
        status: "ready",
        text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
        truncated,
      });
    } catch {
      setPreview({ status: "error" });
    }
  };

  useEffect(() => {
    if (policy === "auto") void loadPreview();
    // The policy is a pure function of the props, so `url` is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, policy]);

  const delimiter = delimiterFor({ name, mimeType });
  const busy = download.state.phase === "busy";
  const status = downloadStatusText(download.state, undefined);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Icon className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{label}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[mimeType?.split(";")[0], size ? formatFileSize(size) : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          {download.direct !== null ? (
            <a
              href={download.direct}
              download={name || ""}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="size-4" aria-hidden="true" />
              Download
            </a>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void download.start()}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90",
                busy && "cursor-progress opacity-70",
              )}
            >
              <Download className="size-4" aria-hidden="true" />
              {busy ? status : "Download"}
            </button>
          )}
        </div>
        {caption && caption !== label ? (
          <p data-slot="file-caption" className="text-xs text-muted-foreground">
            {caption}
          </p>
        ) : null}
        {download.state.phase === "error" ? (
          <p role="alert" className="text-xs text-destructive">
            Download failed. Try again.
          </p>
        ) : null}
      </div>

      <div data-slot="file-preview" className="min-h-0 flex-1 overflow-auto">
        {policy === "none" ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No preview for this file type. Download it to open it.
          </p>
        ) : preview.status === "idle" ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {`This file is ${size ? formatFileSize(size) : "large"}. Preview the first ${formatFileSize(PREVIEW_BYTES)}?`}
            </p>
            <button
              type="button"
              data-slot="preview-ask"
              onClick={() => void loadPreview()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Preview
            </button>
          </div>
        ) : preview.status === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Loading preview
          </div>
        ) : preview.status === "binary" ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            This file is not text. Download it to open it.
          </p>
        ) : preview.status === "error" ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-sm text-destructive">The preview could not load.</p>
            <button
              type="button"
              onClick={() => void loadPreview()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {preview.truncated ? (
              <p
                data-slot="preview-truncated"
                className="border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground"
              >
                {`Showing the first ${formatFileSize(PREVIEW_BYTES)}. Download the file for the rest.`}
              </p>
            ) : null}
            {delimiter ? (
              <DelimitedTable rows={parseDelimited(preview.text, delimiter, TABLE_ROWS)} />
            ) : (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Loading preview
                  </div>
                }
              >
                <FileViewer
                  file={{
                    path: name || "file",
                    name: name || "file.txt",
                    contents: preview.text,
                    size: size ?? preview.text.length,
                    binary: false,
                    truncated: preview.truncated,
                  }}
                  themeType={themeType}
                />
              </Suspense>
            )}
          </>
        )}
      </div>
    </div>
  );
}
