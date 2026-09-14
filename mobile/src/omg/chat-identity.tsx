import { createContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import type { OmgClient } from "@omg-dev/client";
import type { Conversation } from "../../../src/conversation-contract";
import type { ChatIdentity } from "./message-author";

const UNKNOWN: ChatIdentity = { viewerParticipantId: null, conversation: null };
export const ChatIdentityContext = createContext<ChatIdentity>(UNKNOWN);

/** Bootstrap owns viewer attribution. Never derive a participant id from a profile name. */
export function useChatIdentity(client: OmgClient | null, sessionId: string | null, email?: string) {
  const [value, setValue] = useState<{ client: OmgClient; sessionId: string; email?: string; identity: ChatIdentity } | null>(null);
  useEffect(() => {
    if (!client || !sessionId) return;
    let disposed = false;
    let revision = 0;
    const refresh = async () => {
      const requestRevision = ++revision;
      const result = await client.transport.request<{
        viewer?: { participantId?: string | null };
        sessions?: { sessionId?: string; nativeSessionId?: string; conversation?: Conversation | null }[];
      }>(`/api/bootstrap${email ? `?user=${encodeURIComponent(email)}` : ""}`).catch(() => null);
      if (disposed || requestRevision !== revision) return;
      const session = result?.sessions?.find((row) => row.sessionId === sessionId || row.nativeSessionId === sessionId);
      setValue({ client, sessionId, email, identity: {
        viewerParticipantId: result?.viewer?.participantId ?? null,
        conversation: session?.conversation ?? null,
      } });
    };
    void refresh();
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    return () => { disposed = true; listener.remove(); };
  }, [client, sessionId, email]);
  return value?.client === client && value?.sessionId === sessionId && value?.email === email ? value.identity : UNKNOWN;
}
