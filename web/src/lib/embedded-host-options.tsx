import { createContext, useContext, type ReactNode } from "react";

export interface EmbeddedHostOptions {
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
 */
export type HostSettingsPage =
  | "settings"
  | "coding-agents"
  | "auto"
  | "storage"
  | "more";

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
