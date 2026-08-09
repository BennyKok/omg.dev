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
