import { useState } from "react";
import { createRoot } from "react-dom/client";
import * as App from "../App";
import { AppDialogProvider } from "../components/ui/app-dialog";
import { AskProvider } from "../components/ask-center";
import type { OmgTranscriptEvent } from "../lib/omg-chat-transport";
import "../index.css";
const SessionChat = (App as any).SessionChat;
const listeners = new Set<(event: OmgTranscriptEvent) => void>();
const subscribe = (_sid: string, fn: (event: OmgTranscriptEvent) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const session = {
  sessionId: "perf-send",
  title: "Send performance",
  runtime: "command-file",
  agent: "codex",
};
const refresh = async () => {};
(window as any).__send = {
  emit: (event: OmgTranscriptEvent) => {
    for (const fn of listeners) fn(event);
  },
};
function Harness() {
  const [error, setError] = useState<string | null>(null);
  return (
    <AppDialogProvider>
      <AskProvider>
        <div
          style={{
            width: 680,
            height: 750,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <SessionChat
            session={session}
            busy={false}
            prompt={null}
            error={error}
            onError={setError}
            onRefresh={refresh}
            onSubscribeTranscript={subscribe}
          />
        </div>
      </AskProvider>
    </AppDialogProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
