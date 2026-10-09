import type { OmgTransport } from "@omg-dev/client";

/** Auto replays the original PCM through the selected computer's existing broker. */
export async function replayDictationAudio(transport: OmgTransport, chunks: Uint8Array[], cancelled: () => boolean): Promise<string> {
  if (cancelled()) return "";
  const socket = await transport.openSocket("/api/voice/stt-stream");
  return new Promise((resolve, reject) => {
    let settled = false;
    let sent = false;
    let text = "";
    let finalTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(finalTimer);
      try { socket.close(); } catch { /* Already closed. */ }
      if (cancelled()) resolve(""); else if (error) reject(error); else resolve(text.trim());
    };
    const timer = setTimeout(() => finish(new Error("Cloud transcription timed out")), 30000);
    const send = () => {
      if (sent || settled) return;
      if (cancelled()) { finish(); return; }
      sent = true;
      try {
        for (const chunk of chunks) socket.send(chunk);
        socket.send(JSON.stringify({ type: "flush" }));
      } catch { finish(new Error("Could not send audio to cloud")); }
    };
    socket.addEventListener("open", send);
    socket.addEventListener("message", event => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "error") finish(new Error(message.error || "Cloud transcription failed"));
        if (message.type === "final") {
          text = [text, message.text || ""].filter(Boolean).join(" ");
          clearTimeout(finalTimer);
          finalTimer = setTimeout(() => finish(), 300);
        }
      } catch { /* Ignore frames outside the dictation protocol. */ }
    });
    socket.addEventListener("error", () => finish(new Error("Could not reach cloud transcription")));
    socket.addEventListener("close", () => finish(text ? undefined : new Error("Cloud transcription connection closed")));
    if (socket.readyState === 1) send();
    else if (socket.readyState > 1) finish(new Error("Cloud transcription connection closed"));
  });
}
