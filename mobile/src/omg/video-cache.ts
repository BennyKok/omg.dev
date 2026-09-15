/**
 * Where a downloaded video lands on disk.
 *
 * A separate, import-free module so the naming rule can be tested without a
 * React Native runtime, and so nothing pulls the native video modules in just
 * to work out a filename.
 */

/**
 * A stable, filesystem-safe name for a server path.
 *
 * STABLE is the whole point: the same artifact scrolled past twice must reuse
 * the file rather than download again, and a phone on a cellular link is
 * exactly where that matters. So this is a pure function of the path, not a
 * random name or a timestamp.
 *
 * The hash is FNV-1a, not a cryptographic digest. Nothing here is a security
 * boundary -- the bytes already came through an authenticated fetch -- and
 * expo-crypto's digest is async, which would make every call site await
 * something that is really just string arithmetic. A readable prefix is kept
 * in front of it so a cache directory listing is legible while debugging.
 */
export function videoCacheName(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const tail = path.split("/").pop() ?? "";
  // Keep the real extension when there is one: AVPlayer picks a demuxer from
  // it, and a file called `x.bin` can fail to open a video it would otherwise
  // play.
  const dot = tail.lastIndexOf(".");
  const ext = dot > 0 ? tail.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const stem = (dot > 0 ? tail.slice(0, dot) : tail).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40);
  const base = `${stem || "video"}-${hash.toString(16)}`;
  return ext ? `${base}.${ext}` : `${base}.mp4`;
}
