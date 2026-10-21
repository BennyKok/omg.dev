// Browser-only fixture. check-chat-performance.mjs exposes the real ChatStream.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import * as App from "../App";
import { AppDialogProvider } from "../components/ui/app-dialog";
import "../index.css";
import { AskProvider } from "../components/ask-center";
const ChatStream = (App as any).ChatStream;
const history = Array.from({ length: 1000 }, (_, index) => ({
  id: `message-${index}`,
  role: index % 2 ? "assistant" : "user",
  kind: "text",
  ts: 1700000000000 + index * 1000,
  text:
    index % 2
      ? `## Reply ${index}\n\nHere is the current result. This paragraph contains enough text to wrap over several lines when the chat panel is narrow.\n\n- Keep the first result.\n- Check the second result.\n- Compare the final result.\n\n\`\`\`js\nconst total = ${index};\nconsole.log(total);\n\`\`\``
      : `Please review message ${index} and explain the result.`,
}));
const tail = {
  id: "draft-live",
  role: "assistant",
  kind: "text",
  ts: 1700002000000,
  text: "Streaming response.\n\n",
};
const loadOlder = async () => false;
function Harness() {
  const [messages, setMessages] = useState([...history, tail]);
  const [sid, setSid] = useState("perf-transcript-a");
  (window as any).__chat = {
    update: (n: number) =>
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          ...tail,
          text:
            "Streaming response.\n\n" +
            "New words arrive and wrap naturally.\n\n".repeat(n) +
            "Update " +
            n +
            "\n\n",
        },
      ]),
    switch: () => {
      setSid((s) =>
        s === "perf-transcript-a" ? "perf-transcript-b" : "perf-transcript-a",
      );
      setMessages([...history, tail]);
    },
  };
  return (
    <AppDialogProvider>
      <AskProvider>
        <div
          style={{
            width: 680,
            height: 650,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ChatStream
            sid={sid}
            messages={messages}
            busy
            loading={false}
            onLoadOlderMessages={loadOlder}
          />
        </div>
      </AskProvider>
    </AppDialogProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
