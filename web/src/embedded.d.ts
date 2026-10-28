import type { OmgTransport } from "@omg-dev/client";
import type { JSX } from "react";

export { createGrantTransport } from "@omg-dev/client";
export type {
  CreateGrantTransportOptions,
  OmgGrant,
  OmgSocket,
  OmgTransport,
} from "@omg-dev/client";

export type AgentKind =
  | "claude"
  | "aisdk"
  | "codex"
  | "codex-aisdk"
  | "opencode"
  | "jcode"
  | "grok"
  | "cursor"
  | "fx"
  | "muse"
  | "deepseek"
  | "pi"
  | "copilot";

/**
 * Central sink for client errors raised inside the surface, in addition to the
 * report that goes through the transport into the user's own lfg instance.
 * Hosted surfaces should set this: when the workspace behind the transport is
 * paused or unreachable — the usual state when the surface itself crashed — it
 * is the only copy of the report that survives.
 */
export interface OmgErrorSink {
  /** Absolute URL that accepts a POSTed JSON error report. */
  url: string;
  /** Short label for which host surface this is, e.g. "omg-dashboard". */
  surface?: string;
  /** Version of the embedded lfg app, so a report can be pinned to a build. */
  appVersion?: string;
}

/**
 * Push notifications in an embedded surface.
 *
 * The machine encrypts each notice INTO the push (RFC 8291), so the worker that
 * receives it needs no callback to the machine — which matters here, because
 * the receiving worker belongs to the HOST's origin, where the machine's
 * /api/push/pending does not exist.
 *
 * A host that wants notifications only has to render the decrypted message in
 * its own service worker:
 *
 *     self.addEventListener("push", (event) => {
 *       const n = event.data?.json();
 *       if (!n?.title) return;
 *       event.waitUntil(self.registration.showNotification(n.title, {
 *         body: n.body || "",
 *         tag: n.tag,
 *         requireInteraction: !!n.requireInteraction,
 *         data: { url: n.url },
 *       }));
 *     });
 *
 * `url` arrives absolute, resolved against the origin the device subscribed
 * from. The host never sees the notification text — it is encrypted end to end
 * between the machine and the device.
 */
export interface OmgPushNotification {
  title: string;
  body?: string;
  /** Absolute deep link into the surface the device subscribed from. */
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}

/**
 * A service-worker scope the host dedicates to OMG push notifications.
 *
 * A push subscription belongs to a service-worker registration, and only the
 * host knows which of its registrations runs a worker that renders
 * notifications — a root app-shell or cache-drain worker usually does not.
 * Guessing enrols the device into silence, so an embedded surface asks instead.
 *
 * The scope must be dedicated: one registration holds exactly one push
 * subscription, so a scope already carrying the host's own subscription cannot
 * also carry OMG's.
 */
export interface HostPushConfig {
  /** Scope of the dedicated registration, e.g. "/__omg_push/". */
  scope: string;
  /** Worker URL to register when that scope has no registration yet. */
  workerUrl?: string;
}

/** A surface's connection state, reported to a host that owns its display. */
export interface OmgConnectionState {
  /** Socket state. "live" when the surface does not use a live socket. */
  status: "connecting" | "live" | "reconnecting" | "offline";
  /** The first bootstrap is still loading. */
  loading: boolean;
  /** Bootstrap data is usable. */
  ready: boolean;
  /**
   * The surface shows its saved screen (the last startup state) while live
   * data loads. Never true once `ready` is: a saved screen is not live data.
   */
  saved: boolean;
  /** Last bootstrap error, while the surface retries it. */
  error: string | null;
  /** Why the runtime is not answering, from the cloud proxy, when it knows. */
  lifecycle: "starting" | "waking" | "ready" | "updating" | "failed" | "paused" | "unavailable" | null;
}

/**
 * The host's toast function. Pass Sonner's `toast` export from the host's own
 * bundle; it satisfies this shape as is.
 */
export type OmgHostToast = ((message: any, data?: any) => string | number) & {
  success: (message: any, data?: any) => string | number;
  error: (message: any, data?: any) => string | number;
  info: (message: any, data?: any) => string | number;
  warning: (message: any, data?: any) => string | number;
  message: (message: any, data?: any) => string | number;
  loading: (message: any, data?: any) => string | number;
  custom: (render: (id: string | number) => any, data?: any) => string | number;
  promise: (...args: any[]) => any;
  dismiss: (id?: string | number) => string | number;
};

/** Presentation-only identity supplied by an embedding host. */
export type ComposerGuideSurface = "new-session" | "session";

/** A host's guided tutorial over the composers (OmgAppSurfaceProps.composerGuide). */
export interface ComposerGuide {
  /** Send stays off, and Enter does nothing, until this returns true for the draft. */
  accepts?: (draft: string, surface: ComposerGuideSurface, sessionId?: string) => boolean;
  /** Every change to a composer's draft, so the host's guide can show progress. */
  onDraft?: (draft: string, surface: ComposerGuideSurface, sessionId?: string) => void;
  /** Added to the session the home composer starts, inside the launch envelope. */
  newSession?: { firstRun?: boolean; guide?: string };
  /** The person sent `text`: from the home composer once the session exists, from a session composer when the send is accepted. */
  onSent?: (event: { surface: ComposerGuideSurface; text: string; sessionId: string | null }) => void;
  /** Each mounted composer hands the host a function that sets its draft (a guide's "Fill it in"); the person still taps Send. Return a cleanup. */
  // sessionId scopes session composers. Fill returns true only for a visible input.
  registerFill?: (fill: (text: string) => boolean | void, surface: ComposerGuideSurface, sessionId?: string) => (() => void) | void;
}

/**
 * A host's tutorials on the phone Create page (OmgAppSurfaceProps.tutorials).
 * The surface draws the cards; the host owns the list, each run's progress,
 * and what Start or Continue does. A surface can outlive the props of its
 * first render, so this is a small store: the surface reads `getCards()` and
 * redraws on every `subscribe` notice. `getCards()` must return the same array
 * until the cards change. No cards, no row.
 */
export interface HostTutorials {
  getCards: () => readonly HostTutorialCard[];
  subscribe: (onChange: () => void) => () => void;
  /** Start the tutorial, or continue the run that is open. */
  onSelect: (id: string) => void;
  /** Opens the host's full list of tutorials. */
  onSeeAll?: () => void;
  /**
   * The name of the app the host's skill cards (`kind: "skill"`) go into,
   * shown as "Add it to <name>". Read on every `subscribe` notice, like the
   * cards. Absent or null: the skill section has no app line.
   */
  getSkillTarget?: () => string | null;
}

export interface HostTutorialCard {
  id: string;
  title: string;
  /** A picture of the finished result, as an absolute URL. */
  imageUrl: string;
  /** One short line, for example "6 steps · 10 min". */
  detail: string;
  /** "continue" while this tutorial's run is open. */
  status: "start" | "continue";
  /** Another run is open, or the host is starting one. */
  disabled?: boolean;
  /**
   * "template" (the default): something new to build, drawn as a picture
   * card in "Start something new". "skill": something to add to an app the
   * person has, drawn as a row in "Learn a skill" with `iconUrl`.
   */
  kind?: "template" | "skill";
  /** A skill's square mark, as an absolute URL. Without it the row shows `imageUrl`. */
  iconUrl?: string;
}

/** A host's own pill in the home composer's starter row (OmgAppSurfaceProps.starterChips). */
export interface HostStarterChip {
  id: string;
  label: string;
  /** A built-in mark: "tutorial" (a graduation cap). */
  icon?: "tutorial";
  onSelect: () => void;
}

export interface EmbeddedViewer {
  id: string;
  name: string;
  avatar?: string;
}

export type EmbeddedAnalyticsEventHandler = (
  name: string,
  data?: Record<string, unknown>,
) => void;

export interface OmgAppSurfaceProps {
  transport: OmgTransport;
  assetBaseUrl?: string;
  /** Initial session and subsequent host navigation requests. Clearing it opens Home. */
  sessionId?: string | null;
  className?: string;
  /** The agent used when this browser has no valid saved selection. */
  defaultAgent?: AgentKind;
  /**
   * Show LFG's embedded first-run provider connection gate. Defaults to true.
   * Managed hosts that preselect a credential-free agent can disable this and
   * keep provider connections as an optional Settings action.
   */
  connectionOnboarding?: boolean;
  /** Deliver embedded product events through the host's analytics client. */
  onAnalyticsEvent?: EmbeddedAnalyticsEventHandler;
  /**
   * Personalizes hosted welcome/status copy without changing LFG roster,
   * session ownership, filtering, or authorization semantics.
   */
  viewer?: EmbeddedViewer;
  /**
   * Route dictation audio to the host's own transcription broker instead of to
   * the LFG server this UI was served from. A hosted surface should set this:
   * transcription is funded and metered by the platform, so it must not depend
   * on a provider key the connected machine may or may not hold.
   */
  hostedTranscription?: HostedTranscription;
  hostedPreviewAuth?: HostedPreviewAuth;
  /**
   * A service-worker scope the host dedicates to OMG push notifications.
   * Without it the notification toggle stays unavailable in an embedded
   * surface, rather than enrolling the device into silence.
   */
  hostedPush?: HostPushConfig;
  /**
   * The host's toast function (Sonner's `toast`). Every toast this surface
   * raises is drawn by the host's Toaster, in the host's top layer, and the
   * surface mounts no toast stack of its own. Omit it and the surface draws
   * its own stack inside its container, below anything the host layers above
   * that container.
   */
  hostToast?: OmgHostToast;
  /**
   * A guided tutorial over the composers. The host draws the guide; the
   * surface holds Send until the draft is accepted, reports drafts and sends,
   * and adds the host's agent instructions to the session the home composer
   * starts.
   */
  composerGuide?: ComposerGuide;
  /** The host's own pills, drawn first in the home composer's starter row, for example "Tutorials". */
  starterChips?: HostStarterChip[];
  /** The host's tutorials as cards on the phone Create page (see HostTutorials). */
  tutorials?: HostTutorials;
  /**
   * Open one of the machine's settings pages (the ones OmgSettingsSurface
   * mounts) in the HOST's own navigation.
   *
   * An embedded surface hides its Settings tab, so without this it has no way
   * to send someone to a setting it knows they need. The agent picker uses it:
   * it shows the popular agents this machine has no account for, greyed out,
   * and a tap has to land on the host's copy of the coding-agent page. Omit
   * this and the picker keeps hiding unconnected agents entirely.
   */
  onOpenSettingsPage?: (page: OmgSettingsPage) => void;
  /**
   * Open the HOST's own settings root — your account chrome, not this
   * machine's pages.
   *
   * Set this and the surface carries a Settings entry in its Pages menu that
   * calls back to you, and marks its `header-actions` slots and the desktop
   * `rail-footer` slot
   * `data-lfg-host-settings="menu"` so a host drawing its own Settings control
   * next to that menu can drop it. Omit it and the surface renders no
   * host-settings entry at all, so the host must keep drawing its own.
   *
   * NOT interchangeable with `onOpenSettingsPage`: that one addresses the
   * MACHINE's pages and is routed per page, so wiring this general entry to it
   * lands on a per-computer page behind a machine selector.
   */
  onOpenHostSettings?: () => void;
  /** A user selects a page, session, thread, or new task in the desktop rail. */
  onNavigate?: () => void;
  /**
   * The machine refused an action because of the plan YOU sold — e.g. starting
   * one more agent than the tier allows.
   *
   * The surface knows nothing about plans or prices, so alone it can only print
   * the server's sentence as an error. Handle this to raise your own upgrade
   * surface instead; when you do, the surface shows nothing itself, so the host
   * owns the entire response.
   */
  onPlanLimit?: (detail: PlanLimitDetail) => void;
  errorSink?: OmgErrorSink;
  /**
   * Machines the viewer can switch this surface between, and which one it
   * shows now. The surface draws its machine switcher (rail row on desktop,
   * header icon on mobile) over this list and calls `onSelect` when a
   * different one is chosen; the host then hands over a new `transport`.
   * Omit it and no switcher is drawn.
   */
  machines?: HostMachines;
  /**
   * Hand the connection display to the host. Pass this and the surface draws
   * no connection overlay, pill, toast, startup pill or inline Retry. It
   * reports each change of its connection state here instead, and the host
   * draws the one message the person sees. Omit it and the surface draws its
   * own connection UI, as before.
   */
  onConnectionChange?: (state: OmgConnectionState) => void;
  /**
   * Draw the last startup state at once while the live one loads. `key` must
   * name the signed-in account and the machine. Call `clearSavedScreens()` on
   * sign-out. Omit to turn off.
   */
  savedScreen?: { key: string };
}

/** One machine in a host-supplied list. `local` is the box serving the page. */
export interface HostMachine {
  id: string;
  name: string;
  kind: "cloud" | "connected" | "local";
  online: boolean;
  /** Short state for the second line, e.g. "Paused". Defaults from `online`. */
  status?: string;
}

export interface HostMachines {
  machines: HostMachine[];
  /** The id the surface is currently pointed at. */
  activeId: string;
  /** The person chose another machine. The host switches and re-renders. */
  onSelect: (id: string) => void;
}

/** One live chat the hosted plan counted. */
export interface PlanLimitLiveAgent {
  sessionId: string;
  /** What the chat list calls it. */
  title: string;
  /** Project key, or "" for a chat with no project. */
  project: string;
}

export interface PlanLimitDetail {
  /** The machine's own sentence, already written for a human to read. */
  message: string;
  /** What the person was trying to do when the plan stopped them. */
  action: "start-session";
  /**
   * The live chats the plan counted, so the host can list them. Home shows one
   * project at a time and can hide most of them. Absent on an older surface.
   */
  live?: PlanLimitLiveAgent[];
  /** Opens one of `live` in this surface. */
  openSession?: (sessionId: string) => void;
  /** Closes one of `live`, which frees its slot. Rejects when the close failed. */
  closeSession?: (sessionId: string) => Promise<void>;
}

export interface HostedTranscription {
  /** Absolute wss:// URL of the transcription broker. */
  url: string;
  /** Fresh viewer JWT, or null when the session can no longer be proven. */
  getToken: () => Promise<string | null>;
}

export interface HostedPreviewAuth {
  getToken(identity: { appId: string; projectId: string; previewUrl: string }): Promise<{ token: string; previewUrl: string } | null>;
}

/**
 * Remove saved screens from this browser. With `keep`, only keys it rejects
 * are removed. Call with no argument on sign-out.
 */
export declare function clearSavedScreens(keep?: (key: string) => boolean): void;

/** Where this browser transcribes dictation. "auto" uses the on-device model when it is ready and the cloud otherwise. */
export type OmgTranscriptionMode = "auto" | "cloud" | "local";

export interface OmgTranscriptionModeState {
  mode: OmgTranscriptionMode;
  /** State of the on-device model. "idle" before it starts to load. */
  status: "idle" | "downloading" | "loading" | "ready" | "error";
  /** Download progress of the on-device model, 0 to 100. */
  progress: number;
  /** False when the selected language can only be transcribed in the cloud. */
  localSupported: boolean;
  /** Saves the mode in this browser. The next recording uses it. */
  setMode(mode: OmgTranscriptionMode): void;
  /** Loads the on-device model again after an error. */
  retry(): void;
}

/**
 * The dictation mode the surface's composer uses in this browser. A host that
 * owns its settings page renders the control with this hook, because the
 * surface's own control lives on the device page that hosts do not mount.
 */
export declare function useOmgTranscriptionMode(): OmgTranscriptionModeState;

export declare function OmgAppSurface(
  props: OmgAppSurfaceProps,
): JSX.Element;

/**
 * Machine-owned settings pages a host can mount on their own, underneath its
 * own account and plan UI, instead of reimplementing them.
 */
/**
 * The machine's settings pages a host can mount.
 *
 * "more" is not one of them. That page is device-level (push, appearance,
 * sound, haptics, install) rather than machine-level, so the host owns it —
 * mounting the machine's copy would show a second, non-working switch beside
 * the host's own. A host that still passes `page: "more"` gets the settings
 * root instead of an error.
 */
export type OmgSettingsPage =
  | "settings"
  | "coding-agents"
  | "auto"
  | "storage"
  | "connectors";

export interface OmgSettingsSurfaceProps {
  transport: OmgTransport;
  assetBaseUrl?: string;
  /**
   * Which page to show. CONTROLLED when the host also passes `onNavigate`:
   * changing this prop navigates the surface, no remount required.
   */
  page?: OmgSettingsPage;
  /**
   * Called when the surface navigates itself — the user tapped "Coding
   * agents", "Storage", "More", or a back link inside a page.
   *
   * Without this the surface's pages are invisible to the host: it runs on a
   * memory history, so a host with its own router shows one URL for five
   * different screens and none of them are linkable. A host that routes these
   * pages passes this and reflects the page back through `page`. Pages the
   * host doesn't route are reported too — ignore the ones you don't handle;
   * the surface navigates internally either way.
   */
  onNavigate?: (page: OmgSettingsPage) => void;
  className?: string;
  errorSink?: OmgErrorSink;
  /**
   * A service-worker scope the host dedicates to OMG push.
   *
   * The push toggle lives on this surface's "more" page, so a host that mounts
   * settings without a full app surface has to grant the scope here or the
   * toggle has nothing to subscribe against. Omitting it is safe — the toggle
   * explains it is unavailable instead of enrolling into the host's own worker.
   */
  hostedPush?: HostPushConfig;
  /**
   * The host's toast function (Sonner's `toast`). Every toast this surface
   * raises is drawn by the host's Toaster, in the host's top layer, and the
   * surface mounts no toast stack of its own. Omit it and the surface draws
   * its own stack inside its container, below anything the host layers above
   * that container.
   */
  hostToast?: OmgHostToast;
  /**
   * Hand the connection display to the host. Pass this and the surface draws
   * no connection overlay, pill, toast, startup pill or inline Retry. It
   * reports each change of its connection state here instead, and the host
   * draws the one message the person sees. Omit it and the surface draws its
   * own connection UI, as before.
   */
  onConnectionChange?: (state: OmgConnectionState) => void;
}

export declare function OmgSettingsSurface(
  props: OmgSettingsSurfaceProps,
): JSX.Element;
