import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  RouterProvider,
  createMemoryHistory,
  type AnyRouter,
} from "@tanstack/react-router";
import type { OmgTransport } from "@omg-dev/client";

import "./index.css";
import { RootErrorBoundary } from "./App";
import { AppDialogProvider } from "./components/ui/app-dialog";
import { configureOmgTransport, type OmgErrorSink } from "./lib/omg-client";
import {
  configureHostPush,
  configureHostedSurface,
  type HostPushConfig,
} from "./lib/push";
import { BareSurfaceProvider } from "./lib/bare-surface";
import {
  EmbeddedHostOptionsProvider,
  type EmbeddedAnalyticsEventHandler,
  type EmbeddedViewer,
  type HostedTranscription,
  type HostSettingsPage,
  type PlanLimitDetail,
} from "./lib/embedded-host-options";
import { claimSurfaceAttribute } from "./lib/surface-attribute";
import { createOmgRouter } from "./router";
import type { AgentKind } from "./lib/coding-agent-options";

export type {
  EmbeddedAnalyticsEventHandler,
  EmbeddedViewer,
  HostedTranscription,
  PlanLimitDetail,
} from "./lib/embedded-host-options";
export type { HostPushConfig } from "./lib/push";

/**
 * The notification a host's push worker receives, already decrypted by the
 * browser. Render it with showNotification(); nothing else is required.
 */
export interface OmgPushNotification {
  title: string;
  body?: string;
  /** Absolute deep link into the surface the device subscribed from. */
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}

export { createGrantTransport } from "@omg-dev/client";
export type {
  CreateGrantTransportOptions,
  OmgGrant,
  OmgSocket,
  OmgTransport,
} from "@omg-dev/client";

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
  /** Deliver embedded product events through the host's analytics client. */
  onAnalyticsEvent?: EmbeddedAnalyticsEventHandler;
  /**
   * Presentation-only identity for the person viewing a hosted surface.
   * This personalizes welcome/status copy but never participates in LFG's
   * roster, session ownership, filtering, or authorization.
   */
  viewer?: EmbeddedViewer;
  /**
   * Route dictation audio to the platform's transcription broker instead of to
   * the LFG server this UI was served from. A hosted surface should set this:
   * transcription is funded and metered by the platform, so it must not depend
   * on a provider key the connected box may or may not hold.
   */
  hostedTranscription?: HostedTranscription;
  /**
   * A service-worker scope the host dedicates to OMG push notifications.
   *
   * Without it the notification toggle stays unavailable in an embedded
   * surface, because a push subscription belongs to a service-worker
   * registration and only the host knows which of its registrations runs a
   * worker that renders notifications. Guessing enrols the device into
   * silence: the browser accepts the subscription and delivers every push to a
   * worker that ignores it.
   *
   * The scope must be dedicated. One registration holds one subscription, so a
   * scope already carrying the host's own subscription cannot also carry ours.
   *
   * The worker itself is ~8 lines — see OmgPushNotification for the payload it
   * receives. Notification text is encrypted between the machine and the
   * device, so the host cannot read it.
   */
  hostedPush?: HostPushConfig;
  /**
   * Open one of the machine's settings pages (the ones OmgSettingsSurface
   * mounts) in the HOST's own navigation.
   *
   * An embedded surface hides its Settings tab, so without this it cannot send
   * someone to a setting it knows they need. Most visibly: the agent picker
   * now shows the popular agents this box has no account for, greyed out, and
   * tapping one has to land on the coding-agent page — the host's copy of it.
   * Omit this and the picker keeps hiding unconnected agents entirely.
   */
  onOpenSettingsPage?: (page: OmgSettingsPage) => void;
  /**
   * Open the HOST's own settings root — your account chrome, not this
   * machine's pages.
   *
   * Set this and the embedded surface carries a Settings entry in its Pages
   * menu that calls straight back to you, and it marks its header slot
   * `data-lfg-host-settings="menu"` so a host drawing its own Settings control
   * beside that menu knows it is now redundant and can drop it. Omit it and
   * the surface renders no host-settings entry at all rather than guessing a
   * destination — so a host that omits it must keep drawing its own control.
   *
   * NOT interchangeable with `onOpenSettingsPage`, which addresses the
   * MACHINE's settings pages and which a host routes per page (omg sends it to
   * /settings/computer). Wiring this general entry to that callback lands
   * people on a per-computer page behind a machine selector, one back tap from
   * where they meant to go.
   */
  onOpenHostSettings?: () => void;
  /**
   * The box refused an action because of the plan YOU sold, not because of
   * anything the person did — e.g. starting one more agent than their tier
   * allows.
   *
   * LFG knows nothing about plans or prices, so on its own the best it can do
   * is print the server's sentence as an error, which is easy to miss and the
   * wrong tone for the moment someone hits the ceiling of what they're paying
   * for. Handle this to put your own upgrade surface up instead; the surface
   * then shows nothing itself, so a host that takes the callback owns the
   * whole response.
   */
  onPlanLimit?: (detail: PlanLimitDetail) => void;
  /**
   * Central sink for client errors, in addition to the report that goes through
   * the transport into the user's own lfg instance. A hosted surface should set
   * this: when the workspace behind the transport is paused or unreachable — the
   * usual state when the surface itself crashed — it is the only copy that
   * survives. Omit it and reporting stays purely transport-local.
   */
  errorSink?: OmgErrorSink;
}

function initialPath(sessionId?: string | null): string {
  const search = new URLSearchParams({ embed: "true" });
  if (sessionId) search.set("session", sessionId);
  return `/?${search.toString()}`;
}

/**
 * Pages a host can mount on their own, without the surrounding session UI.
 *
 * These are the machine-owned settings: what the box has installed, what it
 * runs on a timer, and what it's using. A host that has its own account and
 * plan UI mounts these underneath it rather than reimplementing them, which
 * is what keeps the two products from drifting into different answers for
 * the same setting.
 */
export type OmgSettingsPage = HostSettingsPage;

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
   * different screens, the device back button leaves the whole surface instead
   * of going up one page, and none of it is linkable. A host that routes these
   * pages itself passes this and reflects the page back through `page`.
   *
   * Pages the host doesn't route are reported too — handle the ones you know
   * and ignore the rest; the surface navigates internally either way, so an
   * unhandled page still works.
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

const SETTINGS_PAGES: readonly OmgSettingsPage[] = [
  "settings",
  "coding-agents",
  "auto",
  "storage",
];

function pathToSettingsPage(pathname: string): OmgSettingsPage | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  const page = (seg ? decodeURIComponent(seg) : "settings") as OmgSettingsPage;
  return SETTINGS_PAGES.includes(page) ? page : null;
}

/**
 * The page to actually mount.
 *
 * Hosts pinned to an older build still pass `page: "more"`, and the internal
 * route for it has not gone anywhere — so without this the type change alone
 * would not stop it rendering. Fall back to the settings root: the host's own
 * device settings are what that person should be looking at, and a page that
 * silently shows the root beats one that shows two competing push toggles.
 */
function mountablePage(page: OmgSettingsPage): OmgSettingsPage {
  return SETTINGS_PAGES.includes(page) ? page : "settings";
}

/**
 * A single LFG settings page mounted inside another React product.
 *
 * Same app, same endpoints, same components as the standalone settings page —
 * only the entry route differs. The host supplies the transport, so which
 * machine these settings belong to is entirely the host's decision.
 */
export function OmgSettingsSurface({
  transport,
  assetBaseUrl,
  page = "settings",
  onNavigate,
  className,
  errorSink,
  hostedPush,
}: OmgSettingsSurfaceProps) {
  const mounted = mountablePage(page);
  // The host owns the header, the back affordance and the account, so this
  // surface renders sections only — declared to the tree below, not to a
  // module global that a coexisting full-app surface would also read.
  configureOmgTransport(transport, { assetBaseUrl, errorSink });
  // Declare the host boundary before any child can read it. Push must never
  // fall back to registering the host's own root worker; see
  // configureHostedSurface. This stays even though the page that owned the
  // toggle is no longer mountable — the guard is about what this bundle is
  // allowed to touch, not about which screen happens to be on.
  configureHostedSurface(true);
  configureHostPush(hostedPush ?? null);
  const [router] = useState<AnyRouter>(() =>
    createOmgRouter(
      createMemoryHistory({ initialEntries: [`/${mounted}?embed=true`] }),
    ),
  );

  // Ref, not a dep: a host that passes an inline arrow would otherwise
  // re-subscribe on every render.
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  // Report internal navigation outward. `subscribe` fires after the location
  // has changed, so the host is told where the surface actually IS — echoing
  // that back through `page` is a no-op below rather than a second navigation.
  useEffect(() => {
    return router.subscribe("onResolved", () => {
      const next = pathToSettingsPage(router.state.location.pathname);
      if (next) onNavigateRef.current?.(next);
    });
  }, [router]);

  // Host-driven navigation: the host's URL is the source of truth once it
  // routes these pages, so a browser back/forward or a deep link moves the
  // surface. Guarded on the current location because the common case is the
  // host echoing back the page we just reported.
  useEffect(() => {
    if (pathToSettingsPage(router.state.location.pathname) === mounted) return;
    void router.navigate({ to: `/${mounted}`, search: { embed: true }, replace: true });
  }, [router, mounted]);

  // Ref-counted: a host can have two surfaces alive at once, and the first one
  // to unmount must not strip the stylesheet's anchor off the other.
  useLayoutEffect(() => claimSurfaceAttribute(), []);

  return (
    <div className={className} data-lfg-app-surface="" data-lfg-settings-surface={page}>
      <BareSurfaceProvider bare>
        <RootErrorBoundary>
          <AppDialogProvider>
            <RouterProvider router={router} />
          </AppDialogProvider>
        </RootErrorBoundary>
      </BareSurfaceProvider>
    </div>
  );
}

/**
 * The exact LFG web application mounted inside another React product.
 *
 * A memory router keeps LFG's internal page state private to the surface while
 * the injected transport makes the host the sole owner of authentication.
 *
 * Note it does NOT call installErrorReporting(): those are `window` listeners,
 * and in a shared document they would hoover up the HOST product's errors too,
 * filing them as lfg findings and dispatching auto-fix agents against the wrong
 * repository. Embedded reporting is therefore scoped by construction — the
 * router's error component and RootErrorBoundary only ever see throws from
 * inside this tree.
 */
export function OmgAppSurface({
  transport,
  assetBaseUrl,
  sessionId,
  className,
  defaultAgent = "aisdk",
  connectionOnboarding = true,
  onAnalyticsEvent,
  viewer,
  hostedTranscription,
  hostedPush,
  onOpenSettingsPage,
  onOpenHostSettings,
  onPlanLimit,
  errorSink,
}: OmgAppSurfaceProps) {
  // A full LFG app is the sole owner of its runtime transport. Install it
  // synchronously so child effects cannot race the host boundary; there is no
  // cleanup that can revert another Strict Mode mount back to same-origin.
  configureOmgTransport(transport, { assetBaseUrl, errorSink });
  // Same reasoning as the transport: declare it before any child can read it.
  configureHostedSurface(true);
  configureHostPush(hostedPush ?? null);
  const [router] = useState<AnyRouter>(() =>
    createOmgRouter(
      createMemoryHistory({ initialEntries: [initialPath(sessionId)] }),
    ),
  );

  // Ref-counted: a host can have two surfaces alive at once, and the first one
  // to unmount must not strip the stylesheet's anchor off the other.
  useLayoutEffect(() => claimSurfaceAttribute(), []);

  return (
    <div className={className} data-lfg-app-surface="">
      <EmbeddedHostOptionsProvider
        value={{
          defaultAgent,
          connectionOnboarding,
          onAnalyticsEvent,
          viewer,
          hostedTranscription,
          onOpenSettingsPage,
          // Forwarding this is what makes the Pages-menu Settings entry
          // reachable at all: App.tsx gates both the entry and the
          // `data-lfg-host-settings="menu"` flag on the callback being present
          // in this context, and until it was plumbed through here no host
          // could ever supply one. The feature read as shipped from inside the
          // surface while being dead from the outside.
          onOpenHostSettings,
          onPlanLimit,
        }}
      >
        <BareSurfaceProvider bare={false}>
          <RootErrorBoundary>
            <AppDialogProvider>
              <RouterProvider router={router} />
            </AppDialogProvider>
          </RootErrorBoundary>
        </BareSurfaceProvider>
      </EmbeddedHostOptionsProvider>
    </div>
  );
}
