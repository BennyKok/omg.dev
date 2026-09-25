/**
 * Content shared INTO the app from another app's share sheet.
 *
 * `plugins/with-share-extension.js` adds a Share Extension. It takes the link
 * or text that YouTube, Safari, X or any other app shares, and opens
 *
 *     omg:///share?id=<uuid>&url=<link>&text=<text>
 *
 * This module is the rule for reading that URL. It has no React and no
 * navigator, so it is checked directly (scripts/share-intent.native-check.ts).
 *
 * `share` is not a route. `system-path.ts` drops it so expo-router does not
 * push an unmatched screen, and `share-routing.tsx` turns it into a session.
 */

export type SharedContent = {
  /** Unique per share. Two shares of the same video are two sessions. */
  id: string;
  url?: string;
  text?: string;
};

/** A shared text body is capped so one paste cannot become a huge prompt. */
const MAX_TEXT = 4000;

function routeAndQuery(path: string): { route: string; query: string } {
  const withoutScheme = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const [beforeHash] = withoutScheme.split("#");
  const index = beforeHash.indexOf("?");
  const route = (index === -1 ? beforeHash : beforeHash.slice(0, index)).replace(/^\/+|\/+$/g, "");
  return { route, query: index === -1 ? "" : beforeHash.slice(index + 1) };
}

export function isSharePath(path: string | null | undefined): boolean {
  if (typeof path !== "string" || path === "") return false;
  return routeAndQuery(path).route === "share";
}

export function sharedContent(path: string | null | undefined): SharedContent | null {
  if (!isSharePath(path)) return null;
  const params = new URLSearchParams(routeAndQuery(path as string).query);
  const id = params.get("id")?.trim() ?? "";
  const url = params.get("url")?.trim() || undefined;
  let text = params.get("text")?.trim() || undefined;
  // Many apps share the link twice: once as a URL and once as text.
  if (text && url && text === url) text = undefined;
  if (text && text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}...`;
  if (!id || (!url && !text)) return null;
  return { id, url, text };
}

/** The first message of the session a share starts. */
export function sharePrompt(content: SharedContent): string {
  const parts = ["I shared this with you from another app."];
  if (content.url) parts.push(content.url);
  if (content.text) parts.push(content.text);
  parts.push(
    content.url
      ? "Open it and read it or watch it. Then tell me briefly what it is, and ask me what I want to do with it."
      : "Read it. Then tell me briefly what it is, and ask me what I want to do with it.",
  );
  return parts.join("\n\n");
}
