import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ExternalLink, Globe2, RotateCw, Smartphone, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { renderSVG } from "uqr";
import { PROJECT_PREVIEW_RESTART_MESSAGE, type ProjectPreviewSnapshot } from "../../../packages/protocol/src/project-preview";
import { omgFetch } from "../lib/omg-client";

export function ProjectPreviewCard({ sessionId, user }: { sessionId: string | null; user?: string | null }) {
  const [state, setState] = useState<ProjectPreviewSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [restartAsked, setRestartAsked] = useState(false);
  const phone = usePhone();
  const [expanded, setExpandedState] = useState(() => readPreviewCardExpanded(!phone));
  const setExpanded = (value: boolean) => { setExpandedState(value); writePreviewCardExpanded(value); };
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
  // A new preview row means the agent restarted it; allow another restart ask.
  useEffect(() => { setRestartAsked(false); }, [preview?.createdAt]);
  // A preview that has never answered is still starting, not stopped. The
  // first-run Expo task creates its Expo Go link before Metro runs, and
  // "Stopped" there read as broken for minutes.
  if (!preview || state?.starting) return null;
  const expoGoUrl = preview.expoGoUrl;
  const stopped = state?.live === false;
  const expired = state?.expired === true;
  const restart = async () => {
    if (!sessionId || restartAsked) return;
    setRestartAsked(true);
    try {
      const response = await omgFetch(`/api/sessions/${encodeURIComponent(sessionId)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: PROJECT_PREVIEW_RESTART_MESSAGE }),
      });
      if (!response.ok) setRestartAsked(false);
    } catch { setRestartAsked(false); }
  };
  const openWeb = () => setOpen(true);
  return <>
    <div className="mb-2 rounded-xl border bg-card text-sm" role="status" data-testid="project-preview-card" data-expanded={expanded && !stopped ? "true" : "false"}>
      <div className="flex min-h-11 items-center gap-2 py-1 pl-2 pr-1.5">
        {/* The whole left side toggles the details, so the chevron is not a
            second tiny target on a phone. A web-only preview has no details. */}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default"
          aria-expanded={expoGoUrl && !stopped ? expanded : undefined}
          disabled={!expoGoUrl || stopped}
          onClick={() => setExpanded(!expanded)}
          data-testid="project-preview-toggle"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {expoGoUrl ? <Smartphone className="size-4" /> : <Globe2 className="size-4" />}
          </span>
          <span className="min-w-0 truncate font-medium">{preview.title}</span>
          {/* On a narrow phone the main action already says "Expo Go", and the
              chip left the title about 60px. It shows where there is room. */}
          {expoGoUrl && !stopped ? <Badge variant="outline" className={cn("shrink-0", phone && "max-[479px]:hidden")}>Expo Go</Badge> : null}
          {stopped || !expoGoUrl
            ? <span className="shrink-0 text-xs text-muted-foreground">{expired ? "Link expired" : stopped ? "Stopped" : "Live preview"}</span>
            : null}
          {expoGoUrl && !stopped
            ? <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")} aria-hidden />
            : null}
        </button>
        {stopped ? null : expoGoUrl && phone
          ? <Button size="sm" render={<a href={expoGoUrl} />} nativeButton={false} data-testid="project-preview-expo-go">Open in Expo Go</Button>
          : <Button size="sm" onClick={openWeb}>{expoGoUrl ? "Open web preview" : "Open preview"}</Button>}
      </div>
      {stopped ? <div className="space-y-2 border-t px-3 py-2.5" data-testid="project-preview-stopped">
        <p className="text-xs text-muted-foreground">{expired
          ? "The Expo Go link expired. Restart the preview to get a new one."
          : "The development server is not running. This happens when the Computer sleeps."}</p>
        <button className="inline-flex items-center gap-1.5 font-medium text-primary disabled:text-muted-foreground" disabled={restartAsked} onClick={() => void restart()}>
          <RotateCw className="size-3.5" />{restartAsked ? "Asked the agent to restart it" : "Restart preview"}
        </button>
      </div> : expoGoUrl && expanded ? <div className="border-t px-3 pb-3" data-testid="project-preview-details">
        <ExpoGoGuide url={expoGoUrl} />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {phone ? <button className="font-medium text-primary" onClick={openWeb}>Open web preview</button> : null}
          <a className="inline-flex items-center gap-1 text-muted-foreground" href={preview.url} target="_blank" rel="noreferrer">Open in new tab <ExternalLink className="size-3" /></a>
          <span className="text-muted-foreground">Private to you · Temporary</span>
        </div>
      </div> : null}
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

/**
 * The card's open/closed choice, kept in this browser. One answer for every
 * preview card: a person who closed it once does not want each new app to
 * open it again. Unset means the device default: closed on a phone, where
 * the main path is "Open in Expo Go", open on a computer, where the main
 * path is scanning the QR code.
 */
export const PREVIEW_CARD_EXPANDED_KEY = "lfg_preview_card_expanded";

export function readPreviewCardExpanded(fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(PREVIEW_CARD_EXPANDED_KEY);
    return value === "1" ? true : value === "0" ? false : fallback;
  } catch { return fallback; }
}

function writePreviewCardExpanded(value: boolean): void {
  try { window.localStorage.setItem(PREVIEW_CARD_EXPANDED_KEY, value ? "1" : "0"); } catch { /* Private mode: the choice lasts this page only. */ }
}

/** A phone or small tablet: touch-first, or narrower than the md breakpoint. */
function usePhone(): boolean {
  const [phone] = useState(() => {
    try { return window.matchMedia("(pointer: coarse), (max-width: 767px)").matches; } catch { return false; }
  });
  return phone;
}

const EXPO_GO_IOS = "https://apps.apple.com/app/expo-go/id982107779";
const EXPO_GO_ANDROID = "https://play.google.com/store/apps/details?id=host.exp.exponent";

function ExpoGoGuide({ url }: { url: string }) {
  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(url, { border: 1 }))}`;
  return <div className="mt-3 flex gap-3" data-testid="expo-go-guide">
    <img className="size-24 shrink-0 rounded-md bg-white p-1" src={qr} alt="QR code that opens this app in Expo Go" />
    <ol className="min-w-0 flex-1 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
      <li>Install <span className="font-medium text-foreground">Expo Go</span> from the{" "}
        <a className="text-primary" href={EXPO_GO_IOS} target="_blank" rel="noreferrer">App Store</a> or{" "}
        <a className="text-primary" href={EXPO_GO_ANDROID} target="_blank" rel="noreferrer">Google Play</a>.</li>
      <li>Scan this code with your phone camera, or{" "}
        <a className="font-medium text-primary" href={url}>open in Expo Go</a> on this phone.</li>
      <li>The first load can take up to a minute.</li>
    </ol>
  </div>;
}
