// Pure rules for scripts/check-ui.mjs. No I/O, so they can be tested alone.

/** Name of a screenshot file for a route: "/" -> "index", "/lists/new" -> "lists_new". */
export function routeFileName(route) {
  const name = route.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
  return name || "index";
}

/**
 * Turn file paths inside a static export (relative to dist) into routes.
 * Dynamic routes ("[id]") need a value, so they are returned in `skipped`.
 * Not-found, sitemap and "+" pages are not screens.
 */
export function discoverRoutes(files) {
  const routes = new Set();
  const skipped = new Set();
  for (const raw of files) {
    const file = raw.replace(/\\/g, "/").replace(/^\.?\//, "");
    if (!file.endsWith(".html")) continue;
    let route = "/" + file.slice(0, -".html".length);
    route = route.replace(/\/index$/, "");
    const segments = route.split("/").filter(Boolean);
    if (segments.some((s) => s.startsWith("+") || s.startsWith("_"))) continue;
    if (segments.some((s) => /\[.*\]/.test(s))) { skipped.add(route); continue; }
    routes.add(route || "/");
  }
  return { routes: [...routes].sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b))), skipped: [...skipped].sort() };
}

const ERROR_TEXT = /something went wrong|unhandled (runtime )?error|application error|render error|uncaught (error|exception)|unmatched route|this screen doesn.?t exist|cannot read propert|is not a function|is not defined|minified react error/i;

/**
 * A page is blank when it shows no text and no media, or when the visible text
 * is an error boundary or a router "not found" message.
 * @param {{ text: string, media: number }} page
 * @returns {{ blank: boolean, errorBoundary: boolean, reason: string }}
 */
export function judgePage(page) {
  const text = (page.text ?? "").trim();
  const errorBoundary = ERROR_TEXT.test(text.slice(0, 2000));
  const blank = text.length === 0 && (page.media ?? 0) === 0;
  const reason = errorBoundary ? `error text: "${text.replace(/\s+/g, " ").slice(0, 80)}"` : blank ? "no visible text or media" : "";
  return { blank, errorBoundary, reason };
}

/**
 * An interactive element is covered when the element on top at its centre is
 * neither the element, one of its children, nor one of its ancestors.
 * @param {{ relation: "self"|"descendant"|"ancestor"|"other"|"none" }} hit
 */
export function isCovered(hit) {
  return hit.relation === "other";
}

/** Keep one entry per covered element, in document order, with who covers it. */
export function coveredElements(elements) {
  return elements.filter((e) => isCovered(e)).map((e) => ({ label: e.label, by: e.by ?? "another element", at: e.at }));
}

/** Console messages that are noise on every Expo web page. */
export function isIgnorableConsole(text) {
  return /download the react devtools|\[expo-notifications\]|"shadow\*" style props are deprecated|"textShadow\*" style props are deprecated|props\.pointerEvents is deprecated|useNativeDriver/i.test(text);
}

/** A route result fails the run on a blank page or an error boundary. */
export function routeFailed(result) {
  return result.blank || result.errorBoundary || Boolean(result.loadError);
}

/** Pull the first useful lines from a crashed process output. */
export function firstErrorLines(output, max = 6) {
  const lines = output.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const at = lines.findIndex((l) => /error|exception|cannot|unexpected|syntax|failed|not found/i.test(l));
  return lines.slice(Math.max(0, at), Math.max(0, at) + max);
}

/** Find the local port a server announced, such as "listening on http://127.0.0.1:8801". */
export function announcedPort(output) {
  const m = /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i.exec(output) ?? /\bport[^\d\n]{0,12}(\d{2,5})/i.exec(output);
  return m ? Number(m[1]) : undefined;
}
