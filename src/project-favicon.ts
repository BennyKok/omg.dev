import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

/**
 * Conventional project icons, ordered from the repository root outwards.
 *
 * This list is deliberately static. The HTTP route selects a configured
 * repository first, then this resolver selects one known relative path. The
 * browser never gets to turn an arbitrary path into a local-file read.
 */
export const PROJECT_FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "public/icon.svg",
  "public/icon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  // Monorepos commonly keep the product shell one level below the checkout.
  "web/public/favicon.svg",
  "web/public/favicon.ico",
  "web/public/favicon.png",
  "web/public/icon.svg",
  "web/public/icon.png",
  "apps/web/public/favicon.svg",
  "apps/web/public/favicon.ico",
  "apps/web/public/favicon.png",
  // Expo apps keep the app icon here.
  "assets/icon.png",
  "assets/images/icon.png",
] as const;

/**
 * Pages whose <link rel="icon"> names the real icon when its file name is not
 * a convention (erase-site ships public/favicon-64.png). Fixed paths, like
 * the list above: the page only picks a file inside the same repository.
 */
export const PROJECT_FAVICON_PAGES = [
  "index.html",
  "public/index.html",
  "web/index.html",
  "apps/web/index.html",
  "src/index.html",
] as const;

/**
 * A macOS app has no favicon, only an .icns bundle icon (erase-mac). Browsers
 * cannot draw .icns, so the route serves one of the PNGs inside it.
 */
export const PROJECT_APP_ICON_PATTERNS = [
  "AppIcon.icns",
  "assets/AppIcon.icns",
  "*/assets/AppIcon.icns",
  "crates/*/assets/AppIcon.icns",
  "*/Resources/AppIcon.icns",
] as const;

const DRAWABLE_EXTENSIONS = new Set([".svg", ".ico", ".png", ".webp", ".jpg", ".jpeg", ".gif"]);

function pathIsWithin(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

/** The canonical path when it is a real file inside the repository. */
async function fileWithin(root: string, candidate: string): Promise<string | null> {
  const canonical = await realpath(candidate).catch(() => null);
  if (!canonical || !pathIsWithin(canonical, root)) return null;
  const info = await stat(canonical).catch(() => null);
  return info?.isFile() ? canonical : null;
}

/**
 * The icon hrefs a page declares, best first: an SVG, then the others in
 * page order. Apple touch icons and remote or inline URLs are skipped.
 */
export function pageIconHrefs(html: string): string[] {
  const svg: string[] = [];
  const other: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (!rel.split(/\s+/).includes("icon")) continue;
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.trim();
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
    const path = href.replace(/[?#].*$/, "");
    if (!DRAWABLE_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    (extname(path).toLowerCase() === ".svg" ? svg : other).push(path);
  }
  return [...svg, ...other];
}

async function iconFromPages(root: string): Promise<string | null> {
  for (const page of PROJECT_FAVICON_PAGES) {
    const pagePath = await fileWithin(root, resolve(root, page));
    if (!pagePath) continue;
    const html = await readFile(pagePath, "utf8").catch(() => "");
    const pageDir = dirname(pagePath);
    for (const href of pageIconHrefs(html.slice(0, 256 * 1024))) {
      // "/x.png" is served from the page's public folder (Vite, CRA), or
      // from beside the page for a plain static site.
      const bases = href.startsWith("/")
        ? [resolve(pageDir, "public"), pageDir]
        : [pageDir, resolve(pageDir, "public")];
      for (const base of bases) {
        const found = await fileWithin(root, resolve(base, `.${href.startsWith("/") ? href : `/${href}`}`));
        if (found) return found;
      }
    }
  }
  return null;
}

async function iconFromAppBundle(root: string): Promise<string | null> {
  for (const pattern of PROJECT_APP_ICON_PATTERNS) {
    const glob = new Bun.Glob(pattern);
    for await (const match of glob.scan({ cwd: root, onlyFiles: true, followSymlinks: false })) {
      const found = await fileWithin(root, resolve(root, match));
      if (found) return found;
    }
  }
  return null;
}

async function resolveProjectFavicon(root: string): Promise<string | null> {
  for (const relativePath of PROJECT_FAVICON_CANDIDATES) {
    const found = await fileWithin(root, resolve(root, relativePath));
    if (found) return found;
  }
  return (await iconFromPages(root)) ?? (await iconFromAppBundle(root));
}

/**
 * The search reads a page and may scan a few folders, and every row of the
 * list asks. One answer per repository is reused for a minute.
 */
const FAVICON_LOOKUP_TTL_MS = 60_000;
const faviconLookups = new Map<string, { at: number; path: Promise<string | null> }>();

/** Find the first real image file without following a symlink outside the repo. */
export async function findProjectFavicon(cwd: string): Promise<string | null> {
  const root = await realpath(cwd).catch(() => null);
  if (!root) return null;
  const now = Date.now();
  const cached = faviconLookups.get(root);
  if (cached && now - cached.at < FAVICON_LOOKUP_TTL_MS) return cached.path;
  const path = resolveProjectFavicon(root).catch(() => null);
  faviconLookups.set(root, { at: now, path });
  return path;
}

/** Test seam: forget the per-repository answers. */
export function resetProjectFaviconLookups(): void {
  faviconLookups.clear();
}

/**
 * The PNG to draw from an .icns file: the smallest one at least 64 px wide,
 * else the largest. Null when the file holds no PNG (old .icns formats).
 */
export function pngFromIcns(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "icns") return null;
  const end = Math.min(bytes.byteLength, view.getUint32(4));
  let best: { width: number; data: Uint8Array } | null = null;
  for (let at = 8; at + 8 <= end; ) {
    const length = view.getUint32(at + 4);
    if (length < 8 || at + length > end) break;
    const data = bytes.subarray(at + 8, at + length);
    const isPng = data.byteLength > 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
    if (isPng) {
      const width = new DataView(data.buffer, data.byteOffset).getUint32(16);
      const better =
        !best ||
        (width >= 64 && (best.width < 64 || width < best.width)) ||
        (width < 64 && best.width < 64 && width > best.width);
      if (better) best = { width, data };
    }
    at += length;
  }
  return best?.data ?? null;
}

/** Serve the PNG inside an .icns with the same caching as a plain icon. */
export async function icnsFaviconResponse(req: Request, path: string): Promise<Response> {
  const info = await stat(path).catch(() => null);
  if (!info) return projectFaviconMissResponse();
  const etag = `"icns-${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    ETag: etag,
  };
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch?.split(",").some((tag) => tag.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }
  const png = pngFromIcns(new Uint8Array(await readFile(path)));
  if (!png) return projectFaviconMissResponse();
  return new Response(png, { headers });
}

export function projectFaviconMime(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

/**
 * How long a browser may reuse "this project has no icon".
 *
 * Most projects have none. Without a cache header the 404 was asked again on
 * every row mount, and each ask walks the candidate list above. Ten minutes
 * keeps that quiet while an icon added to a repository still shows up soon.
 */
export const PROJECT_FAVICON_MISS_CACHE_CONTROL = "private, max-age=600";

export function projectFaviconMissResponse(): Response {
  return Response.json(
    { error: "project favicon not found" },
    { status: 404, headers: { "Cache-Control": PROJECT_FAVICON_MISS_CACHE_CONTROL } },
  );
}
