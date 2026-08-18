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

/** Presentation-only identity supplied by an embedding host. */
export interface EmbeddedViewer {
  id: string;
  name: string;
  avatar?: string;
}

export interface OmgAppSurfaceProps {
  transport: OmgTransport;
  assetBaseUrl?: string;
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
  /**
   * A service-worker scope the host dedicates to OMG push notifications.
   * Without it the notification toggle stays unavailable in an embedded
   * surface, rather than enrolling the device into silence.
   */
  hostedPush?: HostPushConfig;
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
   * calls back to you, and marks its `header-actions` slot
   * `data-lfg-host-settings="menu"` so a host drawing its own Settings control
   * next to that menu can drop it. Omit it and the surface renders no
   * host-settings entry at all, so the host must keep drawing its own.
   *
   * NOT interchangeable with `onOpenSettingsPage`: that one addresses the
   * MACHINE's pages and is routed per page, so wiring this general entry to it
   * lands on a per-computer page behind a machine selector.
   */
  onOpenHostSettings?: () => void;
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
}

export interface PlanLimitDetail {
  /** The machine's own sentence, already written for a human to read. */
  message: string;
  /** What the person was trying to do when the plan stopped them. */
  action: "start-session";
}

export interface HostedTranscription {
  /** Absolute wss:// URL of the transcription broker. */
  url: string;
  /** Fresh viewer JWT, or null when the session can no longer be proven. */
  getToken: () => Promise<string | null>;
}

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
  | "storage";

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
}

export declare function OmgSettingsSurface(
  props: OmgSettingsSurfaceProps,
): JSX.Element;
