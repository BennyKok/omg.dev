/**
 * Replay a failed on-device take through this box's own realtime speech
 * service (/api/voice/stt-stream), the same one live dictation uses.
 */
export async function replayTranscription(pcm: ArrayBuffer): Promise<string> {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/api/voice/stt-stream`);
  return new Promise((resolve, reject) => {
    let settled = false;
    let text = "";
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error); else resolve(text.trim());
    };
    const timer = setTimeout(() => finish(new Error("Transcription timed out")), 30000);
    socket.onopen = () => {
      try {
        for (let offset = 0; offset < pcm.byteLength; offset += 8000) socket.send(pcm.slice(offset, offset + 8000));
        socket.send(JSON.stringify({ type: "flush" }));
      } catch { finish(new Error("Could not send audio to transcription")); }
    };
    socket.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(String(data));
        if (message.type === "final") { text = [text, message.text || ""].filter(Boolean).join(" "); finish(); }
        else if (message.type === "error") finish(new Error("Transcription failed"));
      } catch { /* Ignore non-protocol frames. */ }
    };
    socket.onerror = () => finish(new Error("Could not reach transcription"));
    socket.onclose = () => finish(new Error("Transcription connection closed"));
  });
}
