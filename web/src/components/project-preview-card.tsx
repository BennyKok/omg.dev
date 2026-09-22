import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Globe2, X } from "lucide-react";
import type { ProjectPreviewSnapshot } from "../../../packages/protocol/src/project-preview";
import { omgFetch } from "../lib/omg-client";

export function ProjectPreviewCard({ sessionId, user }: { sessionId: string | null; user?: string | null }) {
  const [state, setState] = useState<ProjectPreviewSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const suffix = `?sessionId=${encodeURIComponent(sessionId ?? "")}&user=${encodeURIComponent(user ?? "")}`;
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    setState(null);
    const refresh = async () => {
      try {
        const response = await omgFetch(`/api/project-preview${suffix}`);
        if (response.ok && live) setState(await response.json());
      } catch { /* Older Computers do not have live preview cards. */ }
    };
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 3_000);
    return () => { live = false; clearInterval(timer); };
  }, [sessionId, suffix]);
  const preview = state?.preview;
  if (!preview) return null;
  return <>
    <div className="mb-2 rounded-xl border bg-card p-3 text-sm" role="status" data-testid="project-preview-card">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Globe2 className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{preview.title}</div>
          <div className="text-xs text-muted-foreground">Live preview · Private to you · Temporary</div>
        </div>
      </div>
      <div className="mt-3 flex gap-4">
        <button className="font-medium text-primary" onClick={() => setOpen(true)}>Open preview</button>
        <a className="inline-flex items-center gap-1 text-muted-foreground" href={preview.url} target="_blank" rel="noreferrer">Open in new tab <ExternalLink className="size-3" /></a>
      </div>
    </div>
    {open && createPortal(
      <div className="fixed inset-0 z-[110] flex flex-col bg-background" role="dialog" aria-label={preview.title}>
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
          <Globe2 className="size-4 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{preview.title}</span>
          <a className="text-muted-foreground" href={preview.url} target="_blank" rel="noreferrer" aria-label="Open preview in new tab"><ExternalLink className="size-4" /></a>
          <button className="text-muted-foreground" onClick={() => setOpen(false)} aria-label="Close preview"><X className="size-5" /></button>
        </div>
        <iframe className="min-h-0 flex-1 border-0" src={preview.url} title={preview.title} sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />
      </div>,
      document.body,
    )}
  </>;
}
