import { omgFetch } from "./omg-client";

export async function readRemoteClipboard(): Promise<string> {
  const response = await omgFetch("/api/computer/clipboard");
  if (!response.ok) throw Object.assign(new Error("Computer clipboard unavailable"), { status: response.status });
  return (await response.json() as { text: string }).text;
}

export async function setRemoteClipboard(text: string): Promise<void> {
  const response = await omgFetch("/api/computer/clipboard", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  });
  if (!response.ok) throw Object.assign(new Error("Computer clipboard unavailable"), { status: response.status });
}
