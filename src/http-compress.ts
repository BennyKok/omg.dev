import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

type CompressionEncoding = "br" | "gzip";
type HeaderSource = Headers | Record<string, string> | Array<[string, string]>;

const DYNAMIC_MIN_BYTES = 1024;
const PRECOMPRESSED_ASSET_SKIP_EXTENSIONS = new Set([
  ".avif",
  ".br",
  ".gif",
  ".gz",
  ".ico",
  ".jpg",
  ".jpeg",
  ".map",
  ".mp3",
  ".mp4",
  ".ogg",
  ".png",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
]);

function isPrecompressedAssetCandidate(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of PRECOMPRESSED_ASSET_SKIP_EXTENSIONS) {
    if (lower.endsWith(ext)) return false;
  }
  return true;
}

function acceptedEncodings(req: Request): CompressionEncoding[] {
  const raw = req.headers.get("accept-encoding") ?? "";
  const accepted = new Set<string>();
  for (const part of raw.split(",")) {
    const [nameRaw, ...params] = part.trim().split(";");
    const name = nameRaw.trim().toLowerCase();
    if (!name) continue;
    const q = params
      .map((p) => p.trim().match(/^q=([0-9.]+)$/i)?.[1])
      .find((v): v is string => !!v);
    if (q !== undefined && Number(q) <= 0) continue;
    accepted.add(name);
  }
  const out: CompressionEncoding[] = [];
  if (accepted.has("br") || accepted.has("*")) out.push("br");
  if (accepted.has("gzip") || accepted.has("*")) out.push("gzip");
  return out;
}

function addAcceptEncodingVary(headers: Headers) {
  const vary = headers.get("vary");
  if (!vary) {
    headers.set("Vary", "Accept-Encoding");
    return;
  }
  if (vary.split(",").some((v) => v.trim().toLowerCase() === "accept-encoding")) return;
  headers.set("Vary", `${vary}, Accept-Encoding`);
}

function compressBody(body: Uint8Array, encoding: CompressionEncoding): Uint8Array {
  if (encoding === "br") {
    return brotliCompressSync(body, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
      },
    });
  }
  return gzipSync(body, { level: 6 });
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return /\bapplication\/(?:[^;\s]+\+)?json\b/.test(contentType);
}

function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("text/html");
}

function shouldSkipDynamicCompression(req: Request, path: string, response: Response): boolean {
  if (req.method === "HEAD") return true;
  if (path.startsWith("/api/live/")) return true;
  if (req.headers.has("range")) return true;
  if (req.headers.get("upgrade")) return true;
  if (response.status === 204 || response.status === 304) return true;
  if (response.headers.has("content-encoding")) return true;
  if (response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) return true;
  // The app shell (`/`, and every SPA route that falls back to it) is HTML
  // rebuilt per request, so it has no precompressed sibling on disk. It is
  // ~17 KB raw and ~5 KB compressed, and it is on the critical path of every
  // cold open — compress it like the JSON under /api/.
  if (!path.startsWith("/api/")) return !isHtmlResponse(response);
  if (!isJsonResponse(response)) return true;
  return false;
}

function responseInit(response: Response, headers: Headers): ResponseInit {
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
  };
}

/**
 * Compressed bodies for assets that shipped WITHOUT a `.br`/`.gz` sibling.
 *
 * The Vite build writes one for every asset, but not every deployment serves
 * the build's output verbatim: an overlay that copies only the raw chunks it
 * changed, a dev checkout, a CDN sync that skipped dotfiles. Before this the
 * server then sent the raw bytes — 1.3 MB for the main chunk, 210 KB for the
 * stylesheet — to a phone on a cell link, on every release. Compressing once
 * on first request and keeping the result costs a few MB of memory and turns
 * that cliff back into the ~400 KB / ~30 KB the build intended.
 *
 * Keyed by path + size + mtime so a rebuilt file under the same name (dev) is
 * never served stale. Bounded by total bytes; the assets under /assets/ are
 * content-hashed and immutable, so eviction is only ever about memory.
 */
const FALLBACK_MIN_BYTES = 1024;
const FALLBACK_MAX_BYTES_PER_FILE = 8 * 1024 * 1024;
const FALLBACK_CACHE_MAX_BYTES = 48 * 1024 * 1024;
const fallbackCache = new Map<string, Uint8Array>();
let fallbackCacheBytes = 0;

function fallbackCompressed(key: string, body: Uint8Array, encoding: CompressionEncoding): Uint8Array {
  const hit = fallbackCache.get(key);
  if (hit) {
    // Refresh recency: Map iterates in insertion order, so re-inserting makes
    // this the newest entry and the oldest one the eviction candidate.
    fallbackCache.delete(key);
    fallbackCache.set(key, hit);
    return hit;
  }
  const compressed = compressBody(body, encoding);
  while (fallbackCacheBytes + compressed.byteLength > FALLBACK_CACHE_MAX_BYTES && fallbackCache.size) {
    const oldest = fallbackCache.keys().next().value as string;
    fallbackCacheBytes -= fallbackCache.get(oldest)?.byteLength ?? 0;
    fallbackCache.delete(oldest);
  }
  fallbackCache.set(key, compressed);
  fallbackCacheBytes += compressed.byteLength;
  return compressed;
}

/** Test seam: forget every on-the-fly compressed asset. */
export function resetCompressedAssetCache(): void {
  fallbackCache.clear();
  fallbackCacheBytes = 0;
}

export async function compressedAssetResponse(
  req: Request,
  filePath: string,
  headersInit: HeaderSource,
): Promise<Response | null> {
  if (req.method === "HEAD" || req.headers.has("range")) return null;
  if (!isPrecompressedAssetCandidate(filePath)) return null;
  const encodings = acceptedEncodings(req);
  if (!encodings.length) return null;
  const headers = new Headers(headersInit);
  addAcceptEncodingVary(headers);
  for (const encoding of encodings) {
    const compressedPath = `${filePath}.${encoding === "br" ? "br" : "gz"}`;
    const file = Bun.file(compressedPath);
    if (!(await file.exists())) continue;
    headers.set("Content-Encoding", encoding);
    headers.set("Content-Length", String(file.size));
    return new Response(file, { headers });
  }
  // No sibling on disk for any accepted encoding: compress the raw file
  // ourselves, once, with the client's most preferred encoding.
  const raw = Bun.file(filePath);
  if (!(await raw.exists())) return null;
  const size = raw.size;
  if (size < FALLBACK_MIN_BYTES || size > FALLBACK_MAX_BYTES_PER_FILE) return null;
  const encoding = encodings[0]!;
  const key = `${filePath}\u0000${encoding}\u0000${size}\u0000${Math.floor(raw.lastModified)}`;
  const compressed = fallbackCache.get(key) ?? fallbackCompressed(key, new Uint8Array(await raw.arrayBuffer()), encoding);
  headers.set("Content-Encoding", encoding);
  headers.set("Content-Length", String(compressed.byteLength));
  return new Response(compressed, { headers });
}

export async function maybeCompressResponse(
  req: Request,
  path: string,
  response: Response | undefined,
): Promise<Response | undefined> {
  if (!response) return response;
  if (shouldSkipDynamicCompression(req, path, response)) return response;
  const [encoding] = acceptedEncodings(req);
  if (!encoding) return response;

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength < DYNAMIC_MIN_BYTES) {
    return new Response(body, responseInit(response, new Headers(response.headers)));
  }

  const headers = new Headers(response.headers);
  const compressed = compressBody(body, encoding);
  headers.set("Content-Encoding", encoding);
  headers.set("Content-Length", String(compressed.byteLength));
  addAcceptEncodingVary(headers);
  return new Response(compressed, responseInit(response, headers));
}
