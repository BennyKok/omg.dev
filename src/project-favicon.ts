import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, posix, relative, resolve, sep } from "node:path";

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

/**
 * Where an icon is read from. The search below runs the same way over the
 * folder on disk and over a git branch, so both answer through this shape.
 * Paths are repository-relative with forward slashes.
 */
interface IconTree {
  /** True when `rel` is a regular file inside the repository. */
  isFile(rel: string): Promise<boolean>;
  readText(rel: string): Promise<string>;
  /** Repository-relative files matching a glob. */
  glob(pattern: string): Promise<string[]>;
}

/** A repository-relative path, or null when it would leave the repository. */
function repoPath(rel: string): string | null {
  const normal = posix.normalize(rel.replace(/^\/+/, ""));
  if (!normal || normal === "." || normal.startsWith("../") || normal === ".." || posix.isAbsolute(normal)) return null;
  return normal;
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

async function iconFromPages(tree: IconTree): Promise<string | null> {
  for (const page of PROJECT_FAVICON_PAGES) {
    if (!(await tree.isFile(page))) continue;
    const html = (await tree.readText(page).catch(() => "")).slice(0, 256 * 1024);
    const pageDir = posix.dirname(page);
    for (const href of pageIconHrefs(html)) {
      // "/x.png" is served from the page's public folder (Vite, CRA), or
      // from beside the page for a plain static site.
      const bases = href.startsWith("/") ? [posix.join(pageDir, "public"), pageDir] : [pageDir, posix.join(pageDir, "public")];
      for (const base of bases) {
        const rel = repoPath(posix.join(base, href));
        if (rel && (await tree.isFile(rel))) return rel;
      }
    }
  }
  return null;
}

async function resolveIcon(tree: IconTree): Promise<string | null> {
  for (const rel of PROJECT_FAVICON_CANDIDATES) {
    if (await tree.isFile(rel)) return rel;
  }
  const fromPage = await iconFromPages(tree);
  if (fromPage) return fromPage;
  for (const pattern of PROJECT_APP_ICON_PATTERNS) {
    const [first] = (await tree.glob(pattern)).sort();
    if (first) return first;
  }
  return null;
}

/** The folder on disk. Every read goes through realpath, so a symlink cannot leave the repo. */
function workingTree(root: string): IconTree & { absolute(rel: string): Promise<string | null> } {
  const absolute = async (rel: string) => {
    const canonical = await realpath(resolve(root, rel)).catch(() => null);
    if (!canonical || !pathIsWithin(canonical, root)) return null;
    const info = await stat(canonical).catch(() => null);
    return info?.isFile() ? canonical : null;
  };
  return {
    absolute,
    isFile: async (rel) => (await absolute(rel)) !== null,
    readText: async (rel) => {
      const path = await absolute(rel);
      return path ? readFile(path, "utf8") : "";
    },
    glob: async (pattern) => {
      const out: string[] = [];
      for await (const match of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true, followSymlinks: false })) {
        if (await absolute(match)) out.push(match.split(sep).join("/"));
      }
      return out;
    },
  };
}

async function git(root: string, args: string[]): Promise<{ ok: boolean; out: Uint8Array }> {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  return { ok: (await proc.exited) === 0, out };
}

/**
 * The branch to read icons from, when the checkout has fallen behind it.
 *
 * Agents work in worktrees and push to the remote's default branch; the
 * project's own checkout is rarely pulled. erase-site and erase-mac were
 * 125 and 216 commits behind and still showed the icon from before the
 * Subtract rename. A checkout at or ahead of the branch keeps reading the
 * folder, so an icon that is not pushed yet still shows.
 */
async function freshestRef(root: string): Promise<string | null> {
  for (const ref of ["refs/remotes/origin/HEAD", "refs/remotes/origin/main", "refs/remotes/origin/master"]) {
    const found = await git(root, ["rev-parse", "-q", "--verify", `${ref}^{commit}`]);
    if (!found.ok) continue;
    const oid = new TextDecoder().decode(found.out).trim();
    const contained = await git(root, ["merge-base", "--is-ancestor", oid, "HEAD"]);
    return contained.ok ? null : oid;
  }
  return null;
}

/** Regular files (no symlinks, no submodules) of one commit, path -> blob id. */
async function gitTree(root: string, commit: string): Promise<(IconTree & { blob(rel: string): string | null }) | null> {
  const listed = await git(root, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  if (!listed.ok) return null;
  const blobs = new Map<string, string>();
  for (const entry of new TextDecoder().decode(listed.out).split("\0")) {
    // "<mode> blob <oid>\t<path>"
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, oid] = entry.slice(0, tab).split(" ");
    if (type === "blob" && (mode === "100644" || mode === "100755")) blobs.set(entry.slice(tab + 1), oid);
  }
  return {
    blob: (rel) => blobs.get(rel) ?? null,
    isFile: async (rel) => blobs.has(rel),
    readText: async (rel) => {
      const oid = blobs.get(rel);
      if (!oid) return "";
      return new TextDecoder().decode((await git(root, ["cat-file", "blob", oid])).out);
    },
    glob: async (pattern) => {
      const glob = new Bun.Glob(pattern);
      return [...blobs.keys()].filter((rel) => glob.match(rel));
    },
  };
}

/** A located icon: a file on disk, or a blob on the default branch. */
export type ProjectIcon = { path: string } & ({ source: "file" } | { source: "git"; blob: string; root: string });

async function locateProjectIcon(root: string): Promise<ProjectIcon | null> {
  const commit = await freshestRef(root).catch(() => null);
  if (commit) {
    const tree = await gitTree(root, commit).catch(() => null);
    const rel = tree ? await resolveIcon(tree) : null;
    const blob = rel && tree ? tree.blob(rel) : null;
    if (rel && blob) return { source: "git", path: rel, blob, root };
    if (tree) return null;
  }
  const tree = workingTree(root);
  const rel = await resolveIcon(tree);
  const path = rel ? await tree.absolute(rel) : null;
  return path ? { source: "file", path } : null;
}

/**
 * The search reads a page, may list a branch, and every row of the list
 * asks. One answer per repository is reused for a minute.
 */
const FAVICON_LOOKUP_TTL_MS = 60_000;
const faviconLookups = new Map<string, { at: number; icon: Promise<ProjectIcon | null> }>();

/** Find the project's icon: on its default branch when the checkout is behind, else on disk. */
export async function findProjectIcon(cwd: string): Promise<ProjectIcon | null> {
  const root = await realpath(cwd).catch(() => null);
  if (!root) return null;
  const now = Date.now();
  const cached = faviconLookups.get(root);
  if (cached && now - cached.at < FAVICON_LOOKUP_TTL_MS) return cached.icon;
  const icon = locateProjectIcon(root).catch(() => null);
  faviconLookups.set(root, { at: now, icon });
  return icon;
}

/** The icon's file on disk, for a project read from its folder. */
export async function findProjectFavicon(cwd: string): Promise<string | null> {
  const icon = await findProjectIcon(cwd);
  return icon?.source === "file" ? icon.path : null;
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

// An hour, not a day: an icon read from the default branch changes when a
// push lands, with no file on disk to bump.
const ICON_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

/**
 * A macOS app icon PNG trimmed to its artwork.
 *
 * Apple's icon grid draws the shape in the centre 824 of 1024 px and leaves
 * the rest transparent for the shadow. At 16 px that margin made the mark
 * visibly smaller than every favicon beside it (erase-mac, 2026-11-18). An
 * SVG wrapper crops to the grid without decoding the PNG.
 */
export function icnsArtworkSvg(png: Uint8Array): Uint8Array {
  const width = new DataView(png.buffer, png.byteOffset).getUint32(16);
  const inset = (width * 100) / 1024;
  const size = width - inset * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${inset} ${inset} ${size} ${size}">` +
    `<image width="${width}" height="${width}" href="data:image/png;base64,${Buffer.from(png).toString("base64")}"/></svg>`;
  return new TextEncoder().encode(svg);
}

/** Bytes with a fixed version tag; .icns becomes the artwork inside it. */
function iconBytesResponse(req: Request, path: string, etag: string, bytes: () => Promise<Uint8Array>): Promise<Response> {
  const icns = path.toLowerCase().endsWith(".icns");
  const headers = {
    "Content-Type": icns ? "image/svg+xml" : projectFaviconMime(path),
    "Cache-Control": ICON_CACHE_CONTROL,
    ETag: etag,
  };
  if (req.headers.get("if-none-match")?.split(",").some((tag) => tag.trim() === etag)) {
    return Promise.resolve(new Response(null, { status: 304, headers }));
  }
  return bytes().then((raw) => {
    const png = icns ? pngFromIcns(raw) : null;
    const body = icns ? (png ? icnsArtworkSvg(png) : null) : raw;
    return body ? new Response(body, { headers }) : projectFaviconMissResponse();
  });
}

/** Serve the PNG inside an .icns with the same caching as a plain icon. */
export async function icnsFaviconResponse(req: Request, path: string): Promise<Response> {
  const info = await stat(path).catch(() => null);
  if (!info) return projectFaviconMissResponse();
  const etag = `"icns2-${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  return iconBytesResponse(req, path, etag, async () => new Uint8Array(await readFile(path)));
}

/**
 * The response for a located icon that is not a plain file on disk: a blob
 * on the default branch. Its blob id is the version tag, so a new icon on
 * the branch is a new ETag.
 */
export function gitIconResponse(req: Request, icon: Extract<ProjectIcon, { source: "git" }>): Promise<Response> {
  return iconBytesResponse(req, icon.path, `"git-${icon.path.toLowerCase().endsWith(".icns") ? "icns2-" : ""}${icon.blob}"`, async () => (await git(icon.root, ["cat-file", "blob", icon.blob])).out);
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
