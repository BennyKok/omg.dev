// Is this string something a browser can actually open as a sign-in page?
//
// The sign-in URL is not composed by us. The server spawns a provider CLI and
// regexes the first https:// match out of its terminal output, so what arrives
// here is whatever that scrape produced — a real authorize URL most of the
// time, and on a bad day a fragment of a log line or nothing at all.
//
// A control that opens a non-URL is the blank tab in another costume, which is
// the bug this file was created for. Everything that can open the provider
// checks here first.
//
// This module used to also carry a popup "carrier" that opened `about:blank`
// up front and wrote a holding page into it, because `window.open` is only
// trusted inside the synchronous part of a click and the URL took a server
// round trip to appear. That whole apparatus is gone: the dialog now opens on
// the click and its own button opens the tab from a fresh gesture, so there is
// never a tab waiting on a URL. The guard is what remains because it is the
// part that was about correctness rather than about timing.

export function isAuthorizationUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
