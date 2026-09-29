import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ExternalLink, Globe2, Info, RotateCw, Smartphone, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { renderSVG } from "uqr";
import { PROJECT_PREVIEW_RESTART_MESSAGE, type ProjectPreviewSnapshot } from "../../../packages/protocol/src/project-preview";
import { expoConnectActive, expoConnectMessage, type ExpoAccountSnapshot } from "../../../packages/protocol/src/expo-account";
import { omgFetch } from "../lib/omg-client";
const Computer = lazy(() => import("../views/computer-page").then(m => ({ default: m.ComputerPage })));

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
  const expo = useExpoAccount(preview?.expoGoUrl ? sessionId : null, suffix);
  const [showComputer, setShowComputer] = useState(false);
  // The Computer view closes itself once the sign-in there has worked.
  const signedIn = expo.account?.signedIn === true;
  useEffect(() => { if (signedIn) setShowComputer(false); }, [signedIn]);
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
  // Older Computers have no account check, so they keep "Open in Expo Go".
  const needsConnect = !!expoGoUrl && !stopped && expo.account !== null && !expo.account.signedIn;
  const connecting = expoConnectActive(expo.account?.connect);
  const connect = async () => { if (await expo.connect()) setShowComputer(true); };
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
        {stopped ? null : expoGoUrl && phone && needsConnect
          ? <Button size="sm" disabled={connecting} onClick={() => void connect()} data-testid="project-preview-connect-expo">Connect Expo</Button>
          // TODO(expo-go-58): add expo_go_prompt_device_auth=1 to this link when
          // Expo Go 58 ships, so the phone signs in to the same account.
          : expoGoUrl && phone
          ? <Button size="sm" render={<a href={expoGoUrl} />} nativeButton={false} data-testid="project-preview-expo-go">Open in Expo Go</Button>
          : <Button size="sm" onClick={openWeb}>{expoGoUrl ? "Open web preview" : "Open preview"}</Button>}
      </div>
      {expoGoUrl && !stopped && expo.account
        ? <ExpoAccountRow account={expo.account} phone={phone} error={expo.error}
            onConnect={() => void connect()} onOpenComputer={() => setShowComputer(true)} onCancel={() => void expo.cancel()} />
        : null}
      {stopped ? <div className="space-y-2 border-t px-3 py-2.5" data-testid="project-preview-stopped">
        <p className="text-xs text-muted-foreground">{expired
          ? "The Expo Go link expired. Restart the preview to get a new one."
          : "The development server is not running. This happens when the Computer sleeps."}</p>
        <button className="inline-flex items-center gap-1.5 font-medium text-primary disabled:text-muted-foreground" disabled={restartAsked} onClick={() => void restart()}>
          <RotateCw className="size-3.5" />{restartAsked ? "Asked the agent to restart it" : "Restart preview"}
        </button>
      </div> : expoGoUrl && expanded ? <div className="border-t px-3 pb-3" data-testid="project-preview-details">
        <ExpoGoGuide url={expoGoUrl} phone={phone} />
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          {phone ? <><button className="font-medium text-primary" onClick={openWeb}>Web preview</button><span aria-hidden>·</span></> : null}
          <a className="inline-flex items-center gap-1" href={preview.url} target="_blank" rel="noreferrer" aria-label="Open preview in new tab">New tab <ExternalLink className="size-3" aria-hidden /></a>
          <span className="ml-auto inline-flex" title="Private to you. The link is temporary." aria-label="Private to you. The link is temporary." role="img"><Info className="size-3.5" aria-hidden /></span>
        </div>
      </div> : null}
    </div>
    {showComputer && createPortal(<div className="fixed inset-0 z-[100] bg-background" role="dialog" aria-label="Sign in to Expo on the Computer">
      <Suspense fallback={<p>Opening Computer…</p>}><Computer active onClose={() => setShowComputer(false)} /></Suspense>
    </div>, document.body)}
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

const EXPO_GO_ANY = "https://expo.dev/go";

/** The store for this phone. A computer gets Expo's page, which lists both. */
function expoGoStore(): { url: string; name: string } {
  try {
    const agent = navigator.userAgent;
    if (/android/i.test(agent)) return { url: EXPO_GO_ANDROID, name: "Google Play" };
    if (/iphone|ipad|ipod/i.test(agent) || (/macintosh/i.test(agent) && navigator.maxTouchPoints > 1)) return { url: EXPO_GO_IOS, name: "the App Store" };
  } catch { /* No navigator: use the neutral page. */ }
  return { url: EXPO_GO_ANY, name: "expo.dev/go" };
}

/**
 * A phone cannot scan its own screen, so a phone gets only the store line.
 * "Open in Expo Go" in the header is its main path. A computer gets the QR.
 */
function ExpoGoGuide({ url, phone }: { url: string; phone: boolean }) {
  const store = expoGoStore();
  if (phone) {
    return <p className="mt-3 text-xs text-muted-foreground" data-testid="expo-go-guide">
      Need Expo Go? Get it on{" "}
      <a className="font-medium text-primary" href={store.url} target="_blank" rel="noreferrer">{store.name}</a>
    </p>;
  }
  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(url, { border: 1 }))}`;
  return <div className="mt-3 flex items-center gap-3" data-testid="expo-go-guide">
    <img className="size-24 shrink-0 rounded-md bg-white p-1" src={qr} alt="QR code that opens this app in Expo Go" />
    <p className="min-w-0 flex-1 text-xs text-muted-foreground">
      Scan with your phone camera to open in{" "}
      <a className="font-medium text-primary" href={store.url} target="_blank" rel="noreferrer">Expo Go</a>.
    </p>
  </div>;
}

/**
 * The Computer's Expo CLI account. Expo Go on an iPhone opens a project only
 * when this account is signed in and Expo Go uses the same one. `account` is
 * null on a Computer without the check, and the card then behaves as before.
 */
function useExpoAccount(sessionId: string | null, suffix: string) {
  const [account, setAccount] = useState<ExpoAccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionId) { setAccount(null); return; }
    let live = true;
    const refresh = async () => {
      try {
        const response = await omgFetch(`/api/expo-account${suffix}`);
        const body = response.ok ? await response.json() as ExpoAccountSnapshot : null;
        if (live) setAccount(typeof body?.signedIn === "boolean" ? body : null);
      } catch { /* Keep the last answer through a network blip. */ }
    };
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 3_000);
    return () => { live = false; clearInterval(timer); };
  }, [sessionId, suffix]);
  const post = async (action: "connect" | "cancel"): Promise<boolean> => {
    setError(null);
    try {
      const response = await omgFetch(`/api/expo-account/${action}${suffix}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json().catch(() => ({})) as ExpoAccountSnapshot & { error?: string };
      if (!response.ok) { setError(body.error ?? "Could not reach the Computer. Try again."); return false; }
      setAccount(body);
      return true;
    } catch {
      setError("Could not reach the Computer. Try again.");
      return false;
    }
  };
  return { account, error, connect: () => post("connect"), cancel: () => post("cancel") };
}

function ExpoAccountRow({ account, phone, error, onConnect, onOpenComputer, onCancel }: {
  account: ExpoAccountSnapshot; phone: boolean; error: string | null;
  onConnect(): void; onOpenComputer(): void; onCancel(): void;
}) {
  const status = account.connect;
  if (account.signedIn) {
    return <p className="border-t px-3 py-2 text-xs text-muted-foreground" data-testid="project-preview-expo-account">
      Sign in to Expo Go as <span className="font-medium text-foreground">{account.username}</span>.
    </p>;
  }
  if (status && expoConnectActive(status)) {
    return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs" data-testid="project-preview-expo-connecting">
      <span className="text-muted-foreground">{expoConnectMessage(status)}</span>
      <button className="font-medium text-primary" onClick={onOpenComputer}>Open Computer</button>
      {status.state === "waiting" ? <button className="text-muted-foreground" onClick={onCancel}>Cancel</button> : null}
    </div>;
  }
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-xs" data-testid="project-preview-expo-signed-out">
    <span className="min-w-0 flex-1 text-muted-foreground">
      {status?.state === "failed" || status?.state === "cancelled" ? `${expoConnectMessage(status)} ` : ""}
      iPhone needs Expo signed in on the Computer.
    </span>
    {/* On a phone the header button is "Connect Expo". */}
    {phone ? null : <Button size="sm" variant="outline" onClick={onConnect} data-testid="project-preview-connect-expo">Connect Expo</Button>}
    {error ? <p className="w-full text-destructive" role="alert">{error}</p> : null}
  </div>;
}
