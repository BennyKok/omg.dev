import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

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
] as const;

function pathIsWithin(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

/** Find the first real image file without following a symlink outside the repo. */
export async function findProjectFavicon(cwd: string): Promise<string | null> {
  const root = await realpath(cwd).catch(() => null);
  if (!root) return null;

  for (const relativePath of PROJECT_FAVICON_CANDIDATES) {
    const candidate = resolve(root, relativePath);
    const canonical = await realpath(candidate).catch(() => null);
    if (!canonical || !pathIsWithin(canonical, root)) continue;
    const info = await stat(canonical).catch(() => null);
    if (info?.isFile()) return canonical;
  }
  return null;
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
