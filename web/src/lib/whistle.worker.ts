/// <reference lib="webworker" />
import createNeedle, { type NeedleModule } from "./vendor/needle.js";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const ENGINE = "https://huggingface.co/Cactus-Compute/needle3/resolve/2ae11323dc000f5e70c49f7403efa6af12ba9e67/wasm/needle.wasm";
const MODEL = "https://huggingface.co/Cactus-Compute/whistle/resolve/b358ddadd89b7a713b5aa131f23032d3cca1b251/whistle.cact";
const CACHE = "omg-whistle-v1";
let engine: NeedleModule | null = null;
let loading: Promise<void> | null = null;

async function asset(url: string, model = false): Promise<Uint8Array> {
  const cache = await caches.open(CACHE).catch(() => null);
  const cached = await cache?.match(url);
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model download failed (${response.status})`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Model download is unavailable");
  const total = Number(response.headers.get("Content-Length")) || (model ? 16_900_000 : 0);
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (model) scope.postMessage({ type: "progress", progress: Math.min(99, Math.round(received / total * 100)) });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  await cache?.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
  return bytes;
}

async function load() {
  const wasm = await asset(ENGINE);
  const model = await asset(MODEL, true);
  scope.postMessage({ type: "loading" });
  const runtime = await createNeedle({ wasmBinary: wasm });
  const pointer = runtime._malloc(model.length);
  if (!pointer) throw new Error("Not enough memory to load Whistle");
  try {
    runtime.HEAPU8.set(model, pointer);
    if (runtime._needle_load(pointer, BigInt(model.length)) < 0) {
      throw new Error(runtime.UTF8ToString(runtime._needle_last_error()));
    }
  } finally { runtime._free(pointer); }
  engine = runtime;
  scope.postMessage({ type: "ready" });
}

function transcribe(samples: Float32Array, language: string): string {
  if (!engine) throw new Error("Whistle is not ready");
  const runtime = engine;
  const outputSize = 65536;
  const text: string[] = [];
  // The upstream API accepts at most 30 seconds per call.
  for (let start = 0; start < samples.length; start += 480000) {
    const chunk = samples.subarray(start, start + 480000);
    const pcm = runtime._malloc(chunk.byteLength);
    const out = runtime._malloc(outputSize);
    const langBytes = new TextEncoder().encode(language === "auto" ? "" : `${language}\0`);
    const lang = langBytes.length ? runtime._malloc(langBytes.length) : 0;
    try {
      if (!pcm || !out || (langBytes.length && !lang)) throw new Error("Not enough memory to transcribe");
      runtime.HEAPU8.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), pcm);
      if (lang) runtime.HEAPU8.set(langBytes, lang);
      if (runtime._needle_transcribe(pcm, chunk.length, lang, 0, 0, out, outputSize) < 0) {
        throw new Error(runtime.UTF8ToString(runtime._needle_last_error()));
      }
      const result = JSON.parse(runtime.UTF8ToString(out)) as { text: string };
      text.push(result.text.trim());
    } finally { runtime._free(pcm); runtime._free(out); if (lang) runtime._free(lang); }
  }
  return text.filter(Boolean).join(" ");
}

scope.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "load") {
    loading ??= load().catch(async (error) => {
      // Do not keep a corrupt or incompatible download across explicit retries.
      await caches.delete(CACHE).catch(() => {});
      throw error;
    });
    void loading.catch((error) => { scope.postMessage({ type: "error", error: String(error) }); });
  } else if (message.type === "transcribe") {
    try {
      scope.postMessage({ type: "result", id: message.id, text: transcribe(new Float32Array(message.samples), message.language) });
    } catch (error) { scope.postMessage({ type: "error", id: message.id, error: String(error) }); }
  }
};
