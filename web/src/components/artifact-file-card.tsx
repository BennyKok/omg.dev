import { Download, File as FileIcon, FileAudio, FileSpreadsheet, FileText } from "lucide-react";
import { useState, type MouseEvent } from "react";

import { omgDirectUrl, omgFetch } from "../lib/omg-client";
import { cn } from "../lib/utils";

/**
 * The card for the general "file" artifact kind: a PDF, an audio clip, a CSV,
 * an archive, anything the agent wants to hand the reader that is not a
 * screenshot or a recording.
 *
 * It names the file. A tap on the card opens the file's own page
 * (`ArtifactFilePage`), where it can be previewed when that makes sense and
 * downloaded either way. The download icon at the end of the row downloads at
 * once without going through the page.
 *
 * The card never renders the bytes. That is a deliberate limit, and it is
 * what keeps this safe. These bytes are agent-chosen and are served from the
 * app's own origin, so anything the browser would INTERPRET here is something
 * the agent can execute as the user. The server answers every file artifact
 * with `Content-Disposition: attachment`, so there is no allowlist to get
 * wrong and no embed to sandbox. The page's preview keeps the same rule: it
 * shows text as text, and never hands the bytes to the browser to interpret.
 */

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function fileIcon(mimeType: string | undefined) {
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
  /** Opens the file's page. Without it the card is download-only. */
  onOpen?: () => void;
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

export type DownloadState =
  | { phase: "idle" }
  | { phase: "busy"; received: number; total: number }
  | { phase: "error" };

/**
 * One download, on either transport.
 *
 * Same-origin hands back a URL the browser can load itself, so `direct` is
 * set and an `<a download>` is the whole implementation: the browser streams
 * the file to disk and shows its own progress. A hosted transport signs each
 * request and an anchor cannot carry that header, so `direct` is null and
 * `start()` fetches the bytes through `omgFetch` and saves an object URL.
 *
 * That fetch happens ON DEMAND, never on render. A file artifact can be
 * 100 MB and a transcript can hold several, so fetching eagerly to prepare a
 * link nobody clicked would download the lot just to scroll past them.
 *
 * On the fetch path nothing reaches the browser's download UI until the last
 * byte is in memory, so for a large file a click used to look like it did
 * nothing for as long as the transfer took. The body is read chunk by chunk
 * and `state` reports the progress, and a failure is a state too instead of
 * being swallowed.
 */
export function useArtifactDownload(input: {
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
}): { direct: string | null; state: DownloadState; start: () => Promise<void> } {
  const { url, name, mimeType, size } = input;
  const direct = omgDirectUrl(url);
  const [state, setState] = useState<DownloadState>({ phase: "idle" });

  const start = async () => {
    if (state.phase === "busy") return;
    if (direct !== null) {
      // The browser owns this one. A synthetic anchor click is the same thing
      // a real anchor does, minus the need for a real anchor in this spot.
      const anchor = document.createElement("a");
      anchor.href = direct;
      anchor.download = name || "";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
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
      // The file stays listed; the caller says what happened and a click retries.
      setState({ phase: "error" });
    } finally {
      // Revoking immediately is safe — the browser has already taken the bytes
      // it needs from a synchronous click.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };

  return { direct, state, start };
}

/** The status slot's text for a download state, or the resting size. */
export function downloadStatusText(state: DownloadState, size: number | undefined): string | null {
  if (state.phase === "busy") return downloadProgressLabel(state.received, state.total);
  if (state.phase === "error") return "Download failed. Click to retry.";
  return size ? formatFileSize(size) : null;
}

const OPEN_CLASS =
  "flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-foreground bg-transparent hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ArtifactFileCard({
  url,
  name,
  mimeType,
  size,
  caption,
  onOpen,
  className,
}: ArtifactFileCardProps) {
  const Icon = fileIcon(mimeType);
  const label = name || caption || "File";
  const download = useArtifactDownload({ url, name, mimeType, size });
  const busy = download.state.phase === "busy";

  const onDownloadClick = (event: MouseEvent) => {
    // The icon downloads; it must not also open the page behind it.
    event.stopPropagation();
    if (download.direct !== null) return; // the anchor does it
    event.preventDefault();
    void download.start();
  };

  // Name, caption and status open the page; the icon downloads. Two sibling
  // controls, because a control inside a control is not valid HTML and screen
  // readers announce it as one thing.
  const summary = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{label}</span>
        {caption && caption !== label ? (
          <span data-slot="file-caption" className="truncate text-xs text-muted-foreground">
            {caption}
          </span>
        ) : null}
      </span>
      <span
        data-slot="file-status"
        className={cn(
          "shrink-0 text-xs",
          download.state.phase === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {downloadStatusText(download.state, size)}
      </span>
    </>
  );

  // The download icon is a pointer affordance: it appears on hover (or when
  // the download itself is busy or failed, so its state stays readable), and
  // on a touch screen it is not there at all. The page has the Download button.
  const iconClass = cn(
    "hidden shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
    "[@media(hover:hover)]:inline-flex",
    download.state.phase === "idle"
      ? "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      : "opacity-100",
  );

  return (
    <div
      className={cn(
        "not-prose group flex w-full max-w-[min(34rem,92vw)] items-center overflow-hidden rounded-lg border border-border bg-card pr-2 shadow-sm",
        className,
      )}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          data-slot="file-open"
          aria-label={`Open ${label}`}
          className={OPEN_CLASS}
        >
          {summary}
        </button>
      ) : (
        <div className={OPEN_CLASS}>{summary}</div>
      )}
      {download.direct !== null ? (
        <a
          href={download.direct}
          download={name || ""}
          onClick={onDownloadClick}
          aria-label={`Download ${label}`}
          className={iconClass}
        >
          <Download className="size-4" aria-hidden="true" />
        </a>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onDownloadClick}
          aria-label={busy ? `Downloading ${label}` : `Download ${label}`}
          className={cn(iconClass, busy && "cursor-progress")}
        >
          <Download className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
