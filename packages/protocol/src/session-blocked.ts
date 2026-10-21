/**
 * What a blocked session's row says instead of a pause badge.
 *
 * A pause glyph read as "this is broken": the row looked dead with no way out.
 * A blocked session is waiting on one specific thing the person can do, so the
 * row names that thing. The banner inside the session carries the detail and
 * the button.
 *
 * Import-free on purpose: the web and the native app both load this file by
 * path (see mobile/metro.config.js), so both clients say the same words.
 */
export function blockedSessionAction(session: {
  status?: string | null;
  statusReason?: string | null;
}): string | null {
  if (session.status !== "blocked") return null;
  switch (session.statusReason) {
    case "provider_auth":
      return "Sign in to continue";
    case "model_unavailable":
      return "Pick a model to continue";
    case "out_of_credits":
      return "Add credits to continue";
    case "provider_error":
      return "Open to retry";
    case "interrupted":
    case "out_of_memory":
    case "restart_recovered":
      return "Open to continue";
    default:
      return "Waiting for you";
  }
}
