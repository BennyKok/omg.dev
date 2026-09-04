import { Download, File as FileIcon, FileAudio, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";

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
 * Download the artifact, without fetching it to draw the card.
 *
 * The two transports need different mechanics. Same-origin hands back a URL
 * the browser can load itself, so an anchor is the whole implementation. A
 * hosted transport signs each request and an anchor cannot carry that header,
 * so the bytes have to come through `omgFetch` and become an object URL.
 *
 * That fetch happens ON CLICK, never on render. A file artifact can be 100 MB
 * and a transcript can hold several, so fetching eagerly to prepare a link
 * nobody clicked would download the lot just to scroll past them.
 */
function DownloadControl({
  url,
  name,
  label,
  className,
}: {
  url: string;
  name?: string;
  label: string;
  className?: string;
}) {
  const direct = omgDirectUrl(url);
  const [busy, setBusy] = useState(false);

  if (direct !== null) {
    return (
      <a href={direct} download={name || ""} className={className}>
        <Download className="size-4" aria-hidden="true" />
        <span className="sr-only">{`Download ${label}`}</span>
      </a>
    );
  }

  const fetchAndSave = async () => {
    if (busy) return;
    setBusy(true);
    let objectUrl: string | null = null;
    try {
      const response = await omgFetch(url);
      if (!response.ok) throw new Error(`artifact ${response.status}`);
      objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = name || "download";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      // Nothing to recover: the file stays listed and the click can be retried.
    } finally {
      // Revoking immediately is safe — the browser has already taken the bytes
      // it needs from a synchronous click.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={fetchAndSave}
      className={cn(className, busy && "opacity-50")}
    >
      <Download className="size-4" aria-hidden="true" />
      <span className="sr-only">{busy ? `Downloading ${label}` : `Download ${label}`}</span>
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
      <div className="flex w-0 min-w-full items-center gap-3 px-3 py-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        {size ? (
          <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(size)}</span>
        ) : null}
        <DownloadControl
          url={url}
          name={name}
          label={label}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        />
      </div>
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
