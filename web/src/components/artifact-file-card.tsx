import { Download, File as FileIcon, FileAudio, FileSpreadsheet, FileText } from "lucide-react";
import { useState, type ReactNode } from "react";

import { omgDirectUrl, omgFetch } from "../lib/omg-client";
import { cn } from "../lib/utils";

/**
 * The card for the general "file" artifact kind: a PDF, an audio clip, a CSV,
 * an archive, anything the agent wants to hand the reader that is not a
 * screenshot or a recording.
 *
 * It names the file and downloads it. It does not render it.
 *
 * That is a deliberate limit, and it is what keeps this safe. These bytes are
 * agent-chosen and are served from the app's own origin, so anything the
 * browser would INTERPRET here is something the agent can execute as the user.
 * The server answers every file artifact with `Content-Disposition:
 * attachment`, so there is no allowlist to get wrong and no embed to sandbox.
 * Adding an inline preview means reopening that question first.
 */

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileIcon(mimeType: string | undefined) {
  const mime = (mimeType || "").toLowerCase().split(";")[0].trim();
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime === "text/csv" || mime === "text/tab-separated-values") return FileSpreadsheet;
  if (mime === "application/pdf" || mime.startsWith("text/") || mime === "application/json") {
    return FileText;
  }
  return FileIcon;
}

export type ArtifactFileCardProps = {
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
  caption?: string;
  className?: string;
};

/**
 * What the size slot says while a signed-transport download is in flight.
 * Exported so the label and the test agree on one shape.
 */
export function downloadProgressLabel(received: number, total: number): string {
  if (total > 0) return `${Math.min(99, Math.floor((received / total) * 100))}%`;
  return formatFileSize(received);
}

type DownloadState =
  | { phase: "idle" }
  | { phase: "busy"; received: number; total: number }
  | { phase: "error" };

const ROW_CLASS =
  "flex w-0 min-w-full items-center gap-3 px-3 py-2 text-left text-foreground no-underline hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The whole row is the download control, not a 16px icon at its end. The
 * name is what the eye lands on, so the name is what you click.
 *
 * The two transports need different mechanics. Same-origin hands back a URL
 * the browser can load itself, so an anchor is the whole implementation: the
 * browser streams the file to disk and shows its own progress. A hosted
 * transport signs each request and an anchor cannot carry that header, so
 * the bytes have to come through `omgFetch` and become an object URL.
 *
 * That fetch happens ON CLICK, never on render. A file artifact can be 100 MB
 * and a transcript can hold several, so fetching eagerly to prepare a link
 * nobody clicked would download the lot just to scroll past them.
 *
 * On the fetch path nothing reaches the browser's download UI until the last
 * byte is in memory, so for a large file a click used to look like it did
 * nothing for as long as the transfer took. The body is read chunk by chunk
 * now and the card reports the percentage itself, and a failure says so in
 * the same slot instead of vanishing.
 */
function DownloadRow({
  url,
  name,
  label,
  mimeType,
  size,
  children,
}: {
  url: string;
  name?: string;
  label: string;
  mimeType?: string;
  size?: number;
  children: (state: DownloadState) => ReactNode;
}) {
  const direct = omgDirectUrl(url);
  const [state, setState] = useState<DownloadState>({ phase: "idle" });

  if (direct !== null) {
    return (
      <a href={direct} download={name || ""} className={ROW_CLASS} title={`Download ${label}`}>
        {children({ phase: "idle" })}
      </a>
    );
  }

  const fetchAndSave = async () => {
    if (state.phase === "busy") return;
    setState({ phase: "busy", received: 0, total: size ?? 0 });
    let objectUrl: string | null = null;
    try {
      const response = await omgFetch(url);
      if (!response.ok) throw new Error(`artifact ${response.status}`);
      const total = Number(response.headers.get("content-length")) || size || 0;
      const type = response.headers.get("content-type") || mimeType || "application/octet-stream";
      let blob: Blob;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          setState({ phase: "busy", received, total });
        }
        blob = new Blob(chunks as BlobPart[], { type });
      } else {
        blob = await response.blob();
      }
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = name || "download";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setState({ phase: "idle" });
    } catch {
      // The file stays listed; the row says what happened and a click retries.
      setState({ phase: "error" });
    } finally {
      // Revoking immediately is safe — the browser has already taken the bytes
      // it needs from a synchronous click.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };

  return (
    <button
      type="button"
      disabled={state.phase === "busy"}
      onClick={fetchAndSave}
      aria-busy={state.phase === "busy"}
      title={`Download ${label}`}
      className={cn(ROW_CLASS, "bg-transparent", state.phase === "busy" && "cursor-progress")}
    >
      {children(state)}
    </button>
  );
}

export function ArtifactFileCard({
  url,
  name,
  mimeType,
  size,
  caption,
  className,
}: ArtifactFileCardProps) {
  const Icon = fileIcon(mimeType);
  const label = name || caption || "File";
  return (
    <div
      className={cn(
        "not-prose flex w-full max-w-[min(34rem,92vw)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm",
        className,
      )}
    >
      <DownloadRow url={url} name={name} label={label} mimeType={mimeType} size={size}>
        {(state) => (
          <>
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
            <span
              data-slot="file-status"
              className={cn(
                "shrink-0 text-xs",
                state.phase === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {state.phase === "busy"
                ? downloadProgressLabel(state.received, state.total)
                : state.phase === "error"
                  ? "Download failed. Click to retry."
                  : size
                    ? formatFileSize(size)
                    : null}
            </span>
            <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{`Download ${label}`}</span>
          </>
        )}
      </DownloadRow>
      {caption && caption !== label ? (
        <div
          data-slot="file-caption"
          className="box-border w-0 min-w-full border-t border-border px-3 py-2 text-xs text-muted-foreground"
        >
          <span className="block truncate">{caption}</span>
        </div>
      ) : null}
    </div>
  );
}
