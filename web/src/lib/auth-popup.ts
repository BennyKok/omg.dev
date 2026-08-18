// The tab a provider sign-in opens into.
//
// WHY THIS EXISTS. Every browser login here is two steps that cannot be
// merged: open a tab (only trusted inside the synchronous part of a click) and
// mint an authorization URL (a server round trip that spawns a provider CLI and
// waits for it to print one). `startBrowserAuth` therefore opened
// `about:blank` and awaited — and `about:blank` is not "a tab that is about to
// become the sign-in page", it is a blank page, for as long as the round trip
// takes. On a cold Computer the CLI can take seconds to print its URL, and when
// it never does the tab was closed out from under the user. Both read as
// exactly one thing: "connect Claude opens a blank page".
//
// The fix is not a faster round trip; it is making a contentless auth tab
// impossible to have. Opening one through this module IS writing its document,
// in the same statement, so there is no window in which a caller holds a tab
// with nothing in it. From there a tab only ever ends in a state that explains
// itself: the provider's page, or a legible failure the user can read in the
// tab that has their attention.
//
// The host toast is not that explanation. The popup takes focus, so a message
// rendered behind it is a message nobody sees — which is why `fail()` paints
// the tab rather than closing it. `close()` stays for the one case with nothing
// to say: the login finished, or it needs input back on the host page.

/** A tab opened up-front, already showing something, waiting for a URL. */
export interface PendingAuthTab {
  /** False when the popup was blocked — the caller keeps its in-page fallback. */
  readonly opened: boolean;
  /** Point the tab at the provider. Returns false if it is gone or the URL is unusable. */
  settle(url: string | undefined): boolean;
  /** Show why no sign-in page is coming, in the tab the user is looking at. */
  fail(message: string): void;
  /** Close it — only when the host surface owns what happens next. */
  close(): void;
}

/** Only an absolute http(s) URL can be a provider sign-in page. A CLI's URL is
 *  scraped out of its stdout, so a parse that drifts must land on a legible
 *  failure rather than navigating the tab somewhere blank (or worse). */
export function isAuthorizationUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function documentFor(body: string): string {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<style>
  html { color-scheme: light dark }
  body { margin:0; min-height:100vh; display:flex; flex-direction:column; gap:14px;
         align-items:center; justify-content:center; text-align:center; padding:24px;
         font:500 17px/1.45 ui-sans-serif,-apple-system,system-ui,sans-serif;
         letter-spacing:-.01em }
  .msg { max-width:32ch; opacity:.72 }
  .hint { font-size:14px; opacity:.5 }
  .spinner { width:18px; height:18px; border-radius:50%; opacity:.55;
             border:2px solid currentColor; border-top-color:transparent;
             animation:spin .7s linear infinite }
  @keyframes spin { to { transform:rotate(360deg) } }
  /* A frozen ring reads as hung, so reduced motion gets a slow breath instead
     of a still image. */
  @media (prefers-reduced-motion:reduce) {
    .spinner { border-top-color:currentColor; animation:pulse 1.6s ease-in-out infinite }
    @keyframes pulse { 50% { opacity:.18 } }
  }
</style>
<body>${body}</body>`;
}

export function waitingDocument(providerLabel: string): string {
  return documentFor(
    `<div class="spinner"></div><div class="msg">Opening ${escapeHtml(providerLabel)} sign in…</div>`,
  );
}

export function failureDocument(message: string): string {
  return documentFor(
    `<div class="msg">${escapeHtml(message)}</div>` +
      `<div class="hint">You can close this tab and try again.</div>`,
  );
}

/** The provider label and the server's error both reach this document as text.
 *  Neither is markup, so neither is written as markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Open the sign-in tab. MUST be called synchronously from the click handler —
 * awaiting first is what gets it blocked.
 *
 * No `noopener` flag: it makes `window.open` return null by design, and the
 * handle is the entire point. The child's back-reference is severed below
 * instead, while it is still same-origin.
 */
export function openAuthTab(providerLabel: string): PendingAuthTab {
  let tab: Window | null = null;
  try {
    tab = window.open("", "_blank");
    if (tab) {
      try {
        tab.opener = null;
      } catch {
        // Some engines make `opener` read-only. The destination is the
        // provider's own sign-in page, not untrusted content.
      }
      write(tab, waitingDocument(providerLabel));
    }
  } catch {
    tab = null;
  }

  return {
    opened: tab !== null,
    settle(url) {
      if (!tab || tab.closed || !isAuthorizationUrl(url)) return false;
      try {
        tab.location.replace(url);
        // Focus is not guaranteed, and losing it is fine — the tab exists
        // either way, which is the part that matters.
        tab.focus?.();
        return true;
      } catch {
        return false;
      }
    },
    fail(message) {
      if (!tab || tab.closed) return;
      try {
        write(tab, failureDocument(message));
      } catch {
        // A tab we cannot repaint still holds the waiting document, which is
        // wrong but not blank.
      }
    },
    close() {
      if (!tab || tab.closed) return;
      try {
        tab.close();
      } catch {
        // A tab we cannot close keeps its own last message.
      }
    },
  };
}

function write(tab: Window, html: string): void {
  tab.document.open();
  tab.document.write(html);
  tab.document.close();
}
