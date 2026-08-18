import { createContext, useContext, type ReactNode } from "react";
import type { AgentKind } from "./coding-agent-options";

export interface EmbeddedHostOptions {
  /** The agent used when this browser has no valid saved selection. */
  defaultAgent: AgentKind;
  /**
   * Whether LFG should own the first-run provider connection gate. A managed
   * host can disable it when it has already selected a credential-free agent
   * and exposes provider connections later in its own Settings surface.
   */
  connectionOnboarding: boolean;
  /**
   * Presentation-only identity supplied by an embedding host. It is deliberately
   * separate from LFG's roster: a hosted Computer is already account-scoped,
   * and showing its viewer must never assign sessions or change authorization.
   */
  viewer?: EmbeddedViewer;
  /**
   * Where a hosted surface wants dictation audio to go.
   *
   * Without this, dictation streams to the LFG server the UI was served from,
   * which then picks a provider from ITS env — so a self-hosted box transcribes
   * with its own key, or cannot transcribe at all. On a hosted surface that is
   * wrong: the platform funds transcription, meters it against the viewer's
   * allowance, and must not depend on what the connected box happens to hold.
   *
   * When set, the mic socket dials this broker instead and the box is not in
   * the audio path at all. `getToken` is called per take, so a long-lived tab
   * cannot pin an expired JWT.
   */
  hostedTranscription?: HostedTranscription;
  /**
   * Open one of the machine's settings pages, when the HOST is the thing that
   * renders them.
   *
   * An embedded surface hides its own Settings tab, because a managed host
   * mounts those pages itself (OmgSettingsSurface) under its own account
   * chrome. That left the surface with no way to send someone to a setting it
   * knows they need — most visibly the coding-agent picker, which can now
   * offer agents this box has no account for. Without this callback the only
   * honest thing that picker could do was hide them, which is exactly the
   * discovery problem.
   *
   * Unset (standalone LFG) the surface navigates to the page itself.
   */
  onOpenSettingsPage?: (page: HostSettingsPage) => void;
  /**
   * Open the host's OWN settings root — its account chrome, not this machine's.
   *
   * Deliberately separate from `onOpenSettingsPage`, which addresses the
   * MACHINE's settings pages and which a host routes accordingly (omg sends it
   * to /settings/computer). The two read alike and are not interchangeable:
   * wiring the surface's general "Settings" entry to the machine callback
   * landed people on a per-computer page with a machine selector, one back tap
   * from where they meant to go.
   *
   * Unset, the surface renders no host-settings entry at all rather than
   * guessing a destination — and a host that is still drawing its own settings
   * control keeps drawing it, because the flag that tells it to stop is only
   * set when this callback exists.
   */
  onOpenHostSettings?: () => void;
  /**
   * The box refused an action because of the plan the HOST sold, not because
   * of anything the person did.
   *
   * LFG has no concept of plans or prices, so the best it can do alone is show
   * the server's sentence as an error. A host that sells the plan can do much
   * better — put its own upgrade surface up — and this is how it finds out it
   * should. When set, the surface hands the refusal over INSTEAD of showing an
   * error; when unset, the message is shown as usual.
   */
  onPlanLimit?: (detail: PlanLimitDetail) => void;
}

/**
 * The machine-owned settings pages a host can mount on its own. Mirrors
 * OmgSettingsSurface's `page` prop — declared here rather than in embedded.tsx
 * so app code can reference it without importing the package entrypoint.
 *
 * "more" is deliberately NOT here. Everything on that page — push
 * notifications, appearance, sound, haptics, install — is a property of the
 * DEVICE you are holding, not of the machine you are talking to. A host
 * already owns all of those for its own app, so mounting the machine's copy
 * gives the person two switches for one thing, and the machine's copy is the
 * one that cannot work: its push toggle would have to borrow a service worker
 * from an origin it does not own. The host owns this page.
 */
export type HostSettingsPage =
  | "settings"
  | "coding-agents"
  | "auto"
  | "storage";

export interface PlanLimitDetail {
  /** The server's own sentence, already written for a human to read. */
  message: string;
  /** What the person was trying to do when the plan stopped them. */
  action: "start-session";
}

export interface HostedTranscription {
  /** Absolute wss:// URL of the platform's dictation broker. */
  url: string;
  /** Fresh viewer JWT, or null when the session can no longer be proven. */
  getToken: () => Promise<string | null>;
}

export interface EmbeddedViewer {
  id: string;
  name: string;
  avatar?: string;
}

const EmbeddedHostOptionsContext = createContext<EmbeddedHostOptions>({
  defaultAgent: "aisdk",
  connectionOnboarding: true,
});

export function EmbeddedHostOptionsProvider({
  value,
  children,
}: {
  value: EmbeddedHostOptions;
  children: ReactNode;
}) {
  return (
    <EmbeddedHostOptionsContext.Provider value={value}>
      {children}
    </EmbeddedHostOptionsContext.Provider>
  );
}

export function useEmbeddedHostOptions(): EmbeddedHostOptions {
  return useContext(EmbeddedHostOptionsContext);
}
