import type { OmgTransport } from "@omg-dev/client";

const CHUNK_BYTES = 8 * 1024 * 1024;

/** Progress spans all chunks and stays below 100 until the server returns a path. */
export async function uploadAttachment(
  transport: Pick<OmgTransport, "fetch" | "upload">,
  endpoint: string,
  blob: Blob,
  mimeType: string,
  uploadId: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  let reported = 0;
  const report = (bytes: number) => {
    const next = Math.max(reported, Math.min(99, Math.floor(bytes / Math.max(1, blob.size) * 100)));
    if (next !== reported) onProgress(reported = next);
  };
  let result: { path?: string } = {};
  for (let offset = 0; offset < Math.max(1, blob.size); offset += CHUNK_BYTES) {
    const body = blob.size > CHUNK_BYTES
      ? blob.slice(offset, Math.min(blob.size, offset + CHUNK_BYTES)) : blob;
    const query = blob.size > CHUNK_BYTES
      ? `&uploadId=${encodeURIComponent(uploadId)}&offset=${offset}&total=${blob.size}` : "";
    const init = { method: "POST", headers: { "Content-Type": mimeType || "application/octet-stream" }, body };
    const response = transport.upload
      ? await transport.upload(`${endpoint}${query}`, init, (event) => {
          if (event.lengthComputable) report(offset + Math.max(0, Math.min(body.size, event.loaded)));
        })
      : await transport.fetch(`${endpoint}${query}`, init);
    if (!response.ok) throw new Error("upload rejected");
    result = await response.json().catch(() => ({})) as { path?: string };
    report(offset + body.size);
  }
  if (!result.path) throw new Error("upload rejected");
  onProgress(100);
  return result.path;
}
