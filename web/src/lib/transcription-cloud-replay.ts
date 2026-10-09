import type { HostedTranscription } from "./embedded-host-options";

/** Replay a failed local take through the same realtime broker as live dictation. */
export async function replayCloudTranscription(pcm: ArrayBuffer, hosted?: HostedTranscription): Promise<string> {
  let token: string | null = null;
  if (hosted) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      token = await Promise.race([hosted.getToken(), new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 5000); })]);
    } finally { clearTimeout(timer); }
  }
  if (hosted && !token) throw new Error("Cloud transcription login is unavailable");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = hosted ? new WebSocket(hosted.url, [`vibes-bearer.${token}`]) : new WebSocket(`${proto}//${location.host}/api/voice/stt-stream`);
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
    const timer = setTimeout(() => finish(new Error("Cloud transcription timed out")), 30000);
    socket.onopen = () => {
      try {
        for (let offset = 0; offset < pcm.byteLength; offset += 8000) socket.send(pcm.slice(offset, offset + 8000));
        socket.send(JSON.stringify({ type: "flush" }));
      } catch { finish(new Error("Could not send audio to cloud transcription")); }
    };
    socket.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(String(data));
        if (message.type === "final") { text = [text, message.text || ""].filter(Boolean).join(" "); finish(); }
        else if (message.type === "error") finish(new Error("Cloud transcription failed"));
      } catch { /* Ignore non-protocol frames. */ }
    };
    socket.onerror = () => finish(new Error("Could not reach cloud transcription"));
    socket.onclose = () => finish(new Error("Cloud transcription connection closed"));
  });
}
