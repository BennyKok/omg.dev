import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, ChevronDown, Download, ExternalLink, Globe2, Info, Maximize2, MonitorSmartphone, RotateCw, Smartphone, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { renderSVG } from "uqr";
import {
  inlinePreviewUrl, PREVIEW_LEVEL_LABEL, PROJECT_PREVIEW_RESTART_MESSAGE, PROJECT_PREVIEW_SIMULATOR_PATH, previewLevels, simulatorStatusText,
  type PreviewLevel, type ProjectPreviewSnapshot, type SimulatorStream,
} from "../../../packages/protocol/src/project-preview";
import { expoConnectActive, expoConnectMessage, EXPO_SIGNUP_LABEL, type ExpoAccountSnapshot, type ExpoConnectMode } from "../../../packages/protocol/src/expo-account";
import { omgFetch } from "../lib/omg-client";
const Computer = lazy(() => import("../views/computer-page").then(m => ({ default: m.ComputerPage })));
// noVNC stays out of the card's chunk until a sign-in sheet opens.
const ExpoSigninSheet = lazy(() => import("./expo-signin-sheet"));

export function ProjectPreviewCard({ sessionId, user }: { sessionId: string | null; user?: string | null }) {
  const [state, setState] = useState<ProjectPreviewSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [restartAsked, setRestartAsked] = useState(false);
  const phone = usePhone();
  // Open by default on every device: the inline web preview is the first
  // thing a new Expo app shows. A stored choice still wins.
  const [expanded, setExpandedState] = useState(() => readPreviewCardExpanded(true));
  const setExpanded = (value: boolean) => { setExpandedState(value); writePreviewCardExpanded(value); };
  // Web is level 1 and the default for every new preview.
  const [level, setLevelState] = useState<PreviewLevel>("web");
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
    // Only while visible: the simulator provider frees an unwatched simulator.
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 3_000);
    return () => { live = false; clearInterval(timer); };
  }, [sessionId, suffix]);
  const preview = state?.preview;
  const expo = useExpoAccount(preview?.expoGoUrl ? sessionId : null, suffix);
  const [showComputer, setShowComputer] = useState(false);
  // The sign-in sheet: Expo's own page, from the Computer kiosk window.
  // `run` is the connect run it belongs to, once the Computer answers.
  const [sheet, setSheet] = useState<{ mode: ExpoConnectMode; run?: number } | null>(null);
  // The Computer view and the sheet close themselves once the sign-in there
  // has worked, and the card shows the checklist.
  const signedIn = expo.account?.signedIn === true;
  useEffect(() => { if (signedIn) { setShowComputer(false); setSheet(null); } }, [signedIn]);
  const connectStatus = expo.account?.connect;
  useEffect(() => {
    // The run ended: done, failed or cancelled. The card says which.
    if (sheet?.run !== undefined && connectStatus?.startedAt === sheet.run && !expoConnectActive(connectStatus)) setSheet(null);
  }, [sheet, connectStatus]);
  // A new preview row means the agent restarted it; allow another restart ask
  // and start again from the web level.
  useEffect(() => { setRestartAsked(false); setLevelState("web"); }, [preview?.createdAt]);
  const simulatorAction = async (action: "start" | "stop") => {
    try {
      await omgFetch(`${PROJECT_PREVIEW_SIMULATOR_PATH}${suffix}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
    } catch { /* The next poll shows the real state. */ }
  };
  // A preview that has never answered is still starting, not stopped. The
  // first-run Expo task creates its Expo Go link before Metro runs, and
  // "Stopped" there read as broken for minutes.
  if (!preview || state?.starting) return null;
  const expoGoUrl = preview.expoGoUrl;
  const stopped = state?.live === false;
  const expired = state?.expired === true;
  const levels = expoGoUrl ? previewLevels(state ?? {}) : ["web" as const];
  const current: PreviewLevel = levels.includes(level) ? level : "web";
  const setLevel = (next: PreviewLevel) => {
    // Leaving the simulator frees it now instead of after the idle timeout.
    const sim = state?.simulator?.state;
    if (current === "simulator" && next !== "simulator" && (sim === "starting" || sim === "ready" || sim === "queued")) void simulatorAction("stop");
    setLevelState(next);
    if (!expanded) setExpanded(true);
  };
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
  // Android's Expo Go opens a project with no Expo account. Only an iPhone
  // needs the Computer signed in first. Older Computers have no account
  // check, so they keep "Open in Expo Go".
  const android = isAndroid();
  const needsConnect = !!expoGoUrl && !stopped && !android && expo.account !== null && !expo.account.signedIn;
  const connecting = expoConnectActive(expo.account?.connect);
  const connect = async (mode: ExpoConnectMode = "login") => {
    // The sheet opens on the tap; the Computer takes a moment to open the page.
    setSheet({ mode });
    const run = await expo.connect(mode);
    if (!run) { setSheet(null); return; }
    setSheet((open) => open ? { mode, run: run.connect?.startedAt } : open);
  };
  const closeSheet = () => { setSheet(null); void expo.cancel(); };
  const reopenSheet = () => setSheet({ mode: connectStatus?.state === "signup" ? "signup" : "login", run: connectStatus?.startedAt });
  const deviceAction = current === "device" && expoGoUrl && phone && !stopped;
  return <>
    <div className="mb-2 rounded-xl border bg-card text-sm" role="status" data-testid="project-preview-card" data-expanded={expanded && !stopped ? "true" : "false"} data-level={current}>
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
          {stopped || !expoGoUrl
            ? <span className="shrink-0 text-xs text-muted-foreground">{expired ? "Link expired" : stopped ? "Stopped" : "Live preview"}</span>
            : null}
          {expoGoUrl && !stopped
            ? <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")} aria-hidden />
            : null}
        </button>
        {/* Expanded, the level itself holds its action. The one-line card
            keeps the action of the level it shows. */}
        {stopped ? null : expoGoUrl && expanded
          ? current === "web" ? <Button size="icon-sm" variant="ghost" onClick={openWeb} aria-label="Full screen web preview" title="Full screen" data-testid="project-preview-fullscreen"><Maximize2 className="size-4" /></Button> : null
          : deviceAction && needsConnect
          ? <Button size="sm" disabled={connecting} onClick={() => void connect()} data-testid="project-preview-connect-expo">Connect Expo</Button>
          : deviceAction
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
      </div> : expoGoUrl && expanded ? <div className="border-t px-3 pb-2" data-testid="project-preview-details">
        {current === "web"
          ? <PhoneFrame src={inlinePreviewUrl(preview)} title={`${preview.title} web preview`} testId="project-preview-web" />
          : current === "simulator" && state?.simulator
          ? <SimulatorLevel stream={state.simulator} webUrl={inlinePreviewUrl(preview)} title={preview.title} onStart={() => void simulatorAction("start")} />
          : <DeviceLevel url={expoGoUrl} phone={phone} android={android} account={expo.account} error={expo.error} connecting={connecting}
              onConnect={(mode) => void connect(mode)} onOpenComputer={reopenSheet} onCancel={() => void expo.cancel()} />}
        {/* The level switcher sits under the preview, with the two small links. */}
        <div className="mt-2 flex items-center gap-2">
          <LevelSwitcher levels={levels} value={current} onChange={setLevel} />
          <a className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" href={preview.url} target="_blank" rel="noreferrer" aria-label="Open preview in new tab" title="New tab"><ExternalLink className="size-4" aria-hidden /></a>
          <InfoTip text={current === "device" ? DEVICE_INFO : "Private to you. The link is temporary."} store={current === "device" ? expoGoStore() : null} />
        </div>
      </div> : null}
    </div>
    {sheet && !signedIn ? <Suspense fallback={null}>
      <ExpoSigninSheet mode={sheet.mode} onClose={closeSheet} onOpenComputer={() => setShowComputer(true)} />
    </Suspense> : null}
    {showComputer && createPortal(<div className="fixed inset-0 z-[120] bg-background" role="dialog" aria-label="Sign in to Expo on the Computer">
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
        <iframe className="min-h-0 flex-1 border-0" src={inlinePreviewUrl(preview)} title={preview.title} sandbox={FRAME_SANDBOX} />
      </div>,
      document.body,
    )}
  </>;
}

const FRAME_SANDBOX = "allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts";
/** The phone the inline frame imitates: an iPhone 15 in CSS pixels. */
const PHONE_W = 390;
const PHONE_H = 844;

/**
 * Web | Simulator | Your phone. A future "Install" level (a signed build on
 * the user's own device) is one more entry after "device".
 */
function LevelSwitcher({ levels, value, onChange }: { levels: PreviewLevel[]; value: PreviewLevel; onChange(level: PreviewLevel): void }) {
  return <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Preview level" data-testid="project-preview-levels">
    {levels.map((level) => {
      const Icon = LEVEL_ICON[level];
      return <button
        key={level}
        type="button"
        role="tab"
        aria-selected={value === level}
        aria-label={PREVIEW_LEVEL_LABEL[level]}
        title={PREVIEW_LEVEL_LABEL[level]}
        data-testid={`project-preview-level-${level}`}
        className={cn("flex h-7 w-10 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
          value === level && "bg-background text-foreground shadow-sm")}
        onClick={() => onChange(level)}
      ><Icon className="size-4" aria-hidden /></button>;
    })}
  </div>;
}

/** Web | Simulator | Your phone. A future "Install" level adds one icon here. */
const LEVEL_ICON: Record<PreviewLevel, typeof Globe2> = { web: Globe2, simulator: MonitorSmartphone, device: Smartphone };

const DEVICE_INFO = "An iPhone opens the app only when Expo Go and the Computer use the same Expo account. Android needs no account.";

/** Long explanations live behind a small icon: a tooltip on hover, a line on tap. */
function InfoTip({ text, store }: { text: string; store: { url: string; name: string } | null }) {
  const [shown, setShown] = useState(false);
  return <span className="relative inline-flex">
    <button type="button" className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      aria-label={text} aria-expanded={shown} title={text} onClick={() => setShown(!shown)} data-testid="project-preview-info">
      <Info className="size-4" aria-hidden />
    </button>
    {shown ? <span className="absolute bottom-9 right-0 z-10 w-60 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md" role="note">
      {text}
      {store ? <> Get Expo Go on <a className="font-medium text-primary" href={store.url} target="_blank" rel="noreferrer">{store.name}</a>.</> : null}
    </span> : null}
  </span>;
}

/**
 * Level 3, Expo Go on the person's own phone. A computer gets the QR code, a
 * phone gets one button. An iPhone needs the Computer's Expo account first:
 * signed out, the card offers "Create free account" and "I have one". Signed
 * in, three short steps. The rules are in the info tip.
 */
function DeviceLevel({ url, phone, android, account, error, connecting, onConnect, onOpenComputer, onCancel }: {
  url: string; phone: boolean; android: boolean; account: ExpoAccountSnapshot | null; error: string | null; connecting: boolean;
  onConnect(mode: ExpoConnectMode): void; onOpenComputer(): void; onCancel(): void;
}) {
  // Android's Expo Go and older Computers (no account check) need no sign-in.
  const signedOut = !android && account !== null && !account.signedIn;
  const status = account?.connect;
  const action = connecting && status
    ? <div className="flex flex-col items-center gap-1" data-testid="project-preview-expo-connecting">
        <Button size="sm" onClick={onOpenComputer} data-testid="project-preview-open-sheet">Show Expo page</Button>
        <span className="text-xs text-muted-foreground">{expoConnectMessage(status)}{" "}
          {status.state === "waiting" || status.state === "signup" ? <button className="font-medium text-foreground underline-offset-2 hover:underline" onClick={onCancel} data-testid="project-preview-cancel-expo">Cancel</button> : null}
        </span>
      </div>
    : signedOut
    ? <div className="flex flex-col items-center gap-2" data-testid="project-preview-expo-signed-out">
        <span className="flex items-center gap-2 text-xs font-medium">
          <ExpoLogo className="size-4" />
          {status?.state === "failed" || status?.state === "cancelled" ? <span className="font-normal text-muted-foreground">{expoConnectMessage(status)}</span> : "Preview on your iPhone"}
        </span>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onConnect("signup")} data-testid="project-preview-expo-signup">{EXPO_SIGNUP_LABEL}</Button>
          <Button size="sm" variant="outline" onClick={() => onConnect("login")} data-testid="project-preview-connect-expo">I have one</Button>
        </div>
      </div>
    : account?.signedIn && !android
    ? <ExpoSteps url={url} phone={phone} username={account.username} />
    : <div className="flex flex-col items-center gap-1">
        {phone
          ? <Button size="sm" render={<a href={url} />} nativeButton={false} data-testid="project-preview-expo-go"><Smartphone className="size-4" aria-hidden />Open in Expo Go</Button>
          : <span className="text-xs font-medium">Scan with Expo Go</span>}
      </div>;
  const qr = phone ? null : `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(url, { border: 1 }))}`;
  return <div className="mt-2.5 flex items-center justify-center gap-4 py-2" data-testid="project-preview-device">
    {qr ? <img className="size-24 shrink-0 rounded-md bg-white p-1" src={qr} alt="QR code that opens this app in Expo Go" data-testid="expo-go-guide" /> : null}
    <div className="flex flex-col items-center gap-1">
      {action}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  </div>;
}

/**
 * The Computer is signed in: get Expo Go, sign in there with the same
 * account, open the app. Only the Computer's account can be detected, so
 * step 2 ticks that and the other steps stay plain.
 */
function ExpoSteps({ url, phone, username }: { url: string; phone: boolean; username?: string }) {
  const row = "flex h-7 items-center gap-2 text-xs";
  return <ol className="flex flex-col gap-0.5" data-testid="project-preview-expo-steps">
    <li className={row}>
      <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>Get Expo Go</span>
      {phone
        // Android never reaches these steps: this is the iPhone path.
        ? <a className="font-medium text-primary" href={EXPO_GO_IOS} target="_blank" rel="noreferrer" data-testid="project-preview-get-expo-go">App Store</a>
        : <><a className="font-medium text-primary" href={EXPO_GO_IOS} target="_blank" rel="noreferrer" data-testid="project-preview-get-expo-go">App Store</a>
            <a className="font-medium text-primary" href={EXPO_GO_ANDROID} target="_blank" rel="noreferrer">Play Store</a></>}
    </li>
    <li className={row} data-testid="project-preview-expo-account">
      <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>Sign in as <span className="font-medium">{username ?? "your Expo account"}</span></span>
      <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-label="The Computer is signed in" data-testid="project-preview-expo-computer-ok" />
    </li>
    <li className={row}>
      <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {phone
        // TODO(expo-go-58): add expo_go_prompt_device_auth=1 to this link when
        // Expo Go 58 ships, so the phone signs in to the same account.
        ? <Button size="sm" className="h-7" render={<a href={url} />} nativeButton={false} data-testid="project-preview-expo-go">Open in Expo Go</Button>
        : <span>Scan to open in Expo Go</span>}
    </li>
  </ol>;
}

/** Expo's mark, from Expo's own log-box header. */
function ExpoLogo({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden data-testid="expo-logo">
    <path d="M0 20.084c.043.53.23 1.063.718 1.778.58.849 1.576 1.315 2.303.567.49-.505 5.794-9.776 8.35-13.29a.761.761 0 011.248 0c2.556 3.514 7.86 12.785 8.35 13.29.727.748 1.723.282 2.303-.567.57-.835.728-1.42.728-2.046 0-.426-8.26-15.798-9.092-17.078-.8-1.23-1.044-1.498-2.397-1.542h-1.032c-1.353.044-1.597.311-2.398 1.542C8.267 3.991.33 18.758 0 19.77Z" />
  </svg>;
}

/**
 * A page at phone size: the frame is 390x844 CSS pixels, so the app lays out
 * as on an iPhone, then scaled to fit the height the composer dock allows.
 */
function PhoneFrame({ src, title, testId, allow, children }: { src: string; title: string; testId: string; allow?: string; children?: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.55);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => { if (el.clientHeight > 0) setScale(el.clientHeight / PHONE_H); };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={box} data-testid={testId}
    className="relative mx-auto mt-2.5 overflow-hidden rounded-[22px] border-[3px] border-foreground/85 bg-background"
    style={{ height: "min(560px, 52dvh)", aspectRatio: `${PHONE_W} / ${PHONE_H}` }}>
    <iframe src={src} title={title} sandbox={FRAME_SANDBOX} allow={allow}
      className="absolute left-0 top-0 origin-top-left border-0"
      style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})` }} />
    {children}
  </div>;
}

/**
 * Level 2. Until the stream is ready the web preview stays in the frame under
 * a status line, so the wait never shows a blank phone.
 */
function SimulatorLevel({ stream, webUrl, title, onStart }: { stream: SimulatorStream; webUrl: string; title: string; onStart(): void }) {
  const status = simulatorStatusText(stream);
  if (!status && stream.streamUrl) {
    // Keyed by streamId: a rotated token in streamUrl must not reload the frame.
    return <PhoneFrame key={stream.streamId ?? stream.streamUrl} src={stream.streamUrl} title={`${title} on the iPhone simulator`}
      testId="project-preview-simulator" allow="autoplay; clipboard-read; clipboard-write" />;
  }
  const canStart = stream.state === "idle" || stream.state === "error";
  return <PhoneFrame src={webUrl} title={`${title} web preview`} testId="project-preview-simulator-waiting">
    <div className="absolute inset-x-0 bottom-0 space-y-2 bg-background/95 p-3 text-xs" data-testid="project-preview-simulator-status">
      <p className="text-muted-foreground">{status}</p>
      {stream.state === "starting" && typeof stream.progress === "number"
        ? <div className="h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.round(Math.min(1, Math.max(0, stream.progress)) * 100)}%` }} /></div>
        : null}
      {canStart ? <Button size="sm" className="w-full" onClick={onStart} data-testid="project-preview-simulator-start">{stream.state === "error" ? "Try again" : "Start simulator"}</Button> : null}
    </div>
  </PhoneFrame>;
}

function isAndroid(): boolean {
  try { return /android/i.test(navigator.userAgent); } catch { return false; }
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
  const post = async (action: "connect" | "cancel", mode?: ExpoConnectMode): Promise<ExpoAccountSnapshot | null> => {
    setError(null);
    try {
      const response = await omgFetch(`/api/expo-account/${action}${suffix}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode ? { mode } : {}) });
      const body = await response.json().catch(() => ({})) as ExpoAccountSnapshot & { error?: string };
      if (!response.ok) { setError(body.error ?? "Could not reach the Computer. Try again."); return null; }
      setAccount(body);
      return body;
    } catch {
      setError("Could not reach the Computer. Try again.");
      return null;
    }
  };
  return { account, error, connect: (mode: ExpoConnectMode) => post("connect", mode), cancel: () => post("cancel") };
}
