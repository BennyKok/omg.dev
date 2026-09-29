/**
 * Where a saved image lands on disk. Import-free so it can be tested without
 * a React Native runtime.
 *
 * The extension matters: the share sheet offers "Save Image" only when the
 * file looks like an image, and an artifact path (`/api/artifacts/:id`) often
 * has no extension at all. So the response's content type decides it, and the
 * path's own extension is the fallback.
 */
const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg",
};

export function imageCacheName(path: string, contentType: string | null | undefined): string {
  const tail = path.split("?")[0].split("/").pop() ?? "";
  const dot = tail.lastIndexOf(".");
  const own = dot > 0 ? tail.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const stemRaw = dot > 0 ? tail.slice(0, dot) : tail;
  const stem = stemRaw.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40) || "image";
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = TYPES[mime] ?? (own || "png");
  return `${stem}.${ext}`;
}
