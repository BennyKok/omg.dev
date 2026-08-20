// Umami analytics — optional, env-configured, fire-and-forget.
//
// No site ID or script URL is hardcoded here on purpose: this repo does not
// own a Umami account. Both are read from Vite env vars at build time —
//   VITE_UMAMI_SRC         the umami script URL (e.g. https://umami.example/script.js)
//   VITE_UMAMI_WEBSITE_ID  the website ID Umami issues for this site
// Leave either unset and every call below is a no-op: no script tag, no
// network request, no throw. That is what keeps local dev and tests
// unaffected without a separate "is this a test" branch.
//
// A blocked or failing analytics call must never break onboarding, so
// trackEvent swallows everything — a browser extension blocking the script,
// the CDN being down, `window.umami` not existing yet, whatever.

let scriptRequested = false;

type UmamiConfig = { src: string; websiteId: string };

function umamiConfig(): UmamiConfig | null {
  const src = import.meta.env.VITE_UMAMI_SRC;
  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID;
  if (!src || !websiteId) return null;
  return { src, websiteId };
}

export function isUmamiConfigured(): boolean {
  return umamiConfig() != null;
}

function ensureScriptLoaded(config: UmamiConfig): void {
  if (scriptRequested || typeof document === "undefined") return;
  scriptRequested = true;
  const el = document.createElement("script");
  el.defer = true;
  el.src = config.src;
  el.setAttribute("data-website-id", config.websiteId);
  document.head.appendChild(el);
}

type UmamiGlobal = { track: (name: string, data?: Record<string, unknown>) => void };

function umamiGlobal(): UmamiGlobal | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { umami?: UmamiGlobal }).umami;
  return candidate && typeof candidate.track === "function" ? candidate : null;
}

/** Fire-and-forget event send. Never throws, never awaited, never queued. */
export function trackEvent(name: string, data?: Record<string, unknown>): void {
  try {
    const config = umamiConfig();
    if (!config) return;
    ensureScriptLoaded(config);
    // The script loads async; if `window.umami` isn't there yet the event is
    // dropped rather than queued — a first-run survey click firing before a
    // deferred script parses is an acceptable miss, not worth the complexity
    // of a retry queue for.
    umamiGlobal()?.track(name, data);
  } catch {
    // Analytics must never block or break the onboarding flow.
  }
}

// Test-only: reset the module-level "have we injected the script" latch.
export function _resetUmamiForTest(): void {
  scriptRequested = false;
}
