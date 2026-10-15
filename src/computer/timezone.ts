// The time zone the desktop's Chrome runs in.
//
// A person signs in to real sites in this browser. Sign-in risk checks compare
// the browser's time zone with the location of the address they see. Computers
// run on UTC, so a browser that reached GoDaddy from a Los Angeles address, or
// from a Helsinki one, read as "a bit unusual" and was refused. The same Chrome
// with the time zone of its exit address was accepted (tested 2026-10-15).
//
// So the time zone follows the exit address, not the person: a user in Hong
// Kong whose Computer leaves from Helsinki gets Europe/Helsinki.

/** Find the IANA time zone of the address that sites see. Null when unknown. */
export type ExitTimeZoneLookup = (proxy?: string) => Promise<string | null>;

/** True for a name that Intl accepts as an IANA time zone. */
export function validTimeZone(name: string): boolean {
  if (!name || name.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const LOOKUP_URL = "https://ipinfo.io/json";
const LOOKUP_TIMEOUT_MS = 3_000;

/**
 * Ask an IP lookup service which time zone the exit address is in.
 *
 * Goes through Chrome's proxy when there is one, because that is the address
 * sites see. Bun's fetch speaks HTTP proxies only; a SOCKS proxy returns null
 * and Chrome keeps the inherited time zone.
 */
export const lookupExitTimeZone: ExitTimeZoneLookup = async proxy => {
  if (proxy && !/^https?:\/\//i.test(proxy)) return null;
  const init: RequestInit & { proxy?: string } = {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  };
  if (proxy) init.proxy = proxy;
  const res = await fetch(LOOKUP_URL, init);
  if (!res.ok) return null;
  const body = (await res.json()) as { timezone?: unknown };
  return typeof body.timezone === "string" && validTimeZone(body.timezone) ? body.timezone : null;
};

/** A found zone is reused for this long, then looked up again at the next launch. */
export const TIME_ZONE_TTL_MS = 60 * 60_000;

let cache: { proxy: string; zone: string; at: number } | null = null;
let warned = false;

/** Forget the cached zone. For tests. */
export function resetBrowserTimeZoneCache(): void {
  cache = null;
  warned = false;
}

/**
 * The TZ to give the desktop's Chrome, or null to keep the inherited one.
 *
 * 1. OMG_COMPUTER_TZ, when set. "off" keeps the inherited zone.
 * 2. The exit address's zone, cached for TIME_ZONE_TTL_MS per proxy.
 * 3. The last zone found, when a later lookup fails.
 * 4. Null. A failed lookup never stops the browser from starting.
 */
export async function browserTimeZone(options: {
  proxy?: string;
  env?: NodeJS.ProcessEnv;
  lookup?: ExitTimeZoneLookup;
  now?: () => number;
} = {}): Promise<string | null> {
  const env = options.env ?? process.env;
  const override = env.OMG_COMPUTER_TZ?.trim();
  if (override) {
    if (override.toLowerCase() === "off") return null;
    if (validTimeZone(override)) return override;
    warnOnce(`[computer] OMG_COMPUTER_TZ=${JSON.stringify(override)} is not a time zone; looking it up instead`);
  }
  const now = (options.now ?? Date.now)();
  const proxy = options.proxy ?? "";
  if (cache && cache.proxy === proxy && now - cache.at < TIME_ZONE_TTL_MS) return cache.zone;
  try {
    const zone = await (options.lookup ?? lookupExitTimeZone)(options.proxy);
    if (zone && validTimeZone(zone)) {
      cache = { proxy, zone, at: now };
      return zone;
    }
  } catch (err) {
    warnOnce(`[computer] could not find the exit time zone: ${err instanceof Error ? err.message : String(err)}`);
  }
  return cache && cache.proxy === proxy ? cache.zone : null;
}

function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(message);
}
