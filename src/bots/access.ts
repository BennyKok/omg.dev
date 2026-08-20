// Who may see and open this machine's persistent bots.
//
// THE DISTINCTION THIS MODULE EXISTS TO HOLD
//   Identity and visibility are two different questions, and `GET /api/bots`
//   used to answer both with the same client-supplied `?user=` value. That is
//   the whole bug. The web client sends that parameter as an IDENTITY — see
//   `botUnreadIdentity` in web/src/App.tsx, "the assigned identity for
//   server-owned bot read state" — and the route reused it as an authorization
//   filter. So a value whose only job was "whose unread watermark" silently
//   became "whose bots exist".
//
// WHERE AUTHORIZATION ACTUALLY LIVES
//   Not here, and it never did. A hosted Computer is reached only through
//   control-plane's session proxy, which mints an HMAC-signed grant after
//   checking `computerShares` for the exact (owner, bindingId) pair, re-checks
//   that row every time the cookie slides, and forwards a fixed header
//   whitelist so nothing a browser sends can impersonate anyone. By the time a
//   request arrives here the question "may this person drive this machine" is
//   already answered yes. Re-deriving it from a local email is not a second
//   check; it is a different, weaker question asked of data that cannot answer
//   it.
//
//   That is why the write routes were never owner-filtered: POST
//   /api/bots/:id/messages and PATCH /api/bots/:id accept any caller the box
//   accepted. Read was filtered and write was not, which is the clearest
//   evidence available that the owner filter was a view preference that drifted
//   into standing as access control. This module makes read agree with write.
//
// THE `owner` FIELD IS ATTRIBUTION, NOT A GRANT
//   On a hosted Computer it is structurally incapable of being a grant: the box
//   is provisioned with an intentionally empty local roster (users.ts, "one box
//   per account"), so `resolveSessionUserTag` returns undefined and every bot
//   persists with `owner: null`. Filtering those by a real email matches
//   nothing. Before the Computer is shared the client sends an empty `?user=`,
//   which normalizes to the same `__local__` bucket and happens to match — so
//   the roster that control-plane merges into `/api/bootstrap` at the moment of
//   sharing is what breaks it, for the OWNER as well as the guest.

import type { Bot } from "./store.ts";
import { botReadUser, conversationOwner, type BotConversationOwnerRow } from "./unread.ts";

/**
 * Viewer email stamped by control-plane's session proxy, taken from the
 * HMAC-verified grant rather than from anything the browser said.
 *
 * Unspoofable through the managed lane by construction, not by validation
 * here: the proxy builds its forwarded headers from a fixed whitelist and
 * never copies client headers, so a browser cannot set this. Directly on the
 * box it is exactly as trustworthy as every other header on this API, which is
 * to say the box's `/api/*` has no auth token anywhere and never has. This
 * header does not widen that; see the same admission on `X-Omg-Caller-Session-Id`
 * in serve.ts.
 */
export const VIEWER_EMAIL_HEADER = "x-omg-viewer-email";

export type BotViewer = {
  /**
   * True when control-plane vouched for this caller against a Computer share.
   * Managed callers are authorized for the whole machine: membership is
   * boolean upstream ("on the list means you see every session on that machine
   * and who started it" — control-plane/lib/computer-access.ts).
   */
  managed: boolean;
  /**
   * Identity for per-person state only — which unread watermark to read and
   * write. Never an input to whether a bot is visible.
   */
  identity: string;
};

/**
 * Resolve the caller. The trusted header wins over the query parameter
 * whenever it is present, so a managed caller cannot renumber themselves into
 * someone else's read state by editing a URL.
 */
export function botViewer(
  trustedEmail: string | null | undefined,
  requestedUser: string | null | undefined,
): BotViewer {
  const trusted = trustedEmail?.trim();
  if (trusted) return { managed: true, identity: botReadUser(trusted) };
  return { managed: false, identity: botReadUser(requestedUser) };
}

/** Read the trusted viewer off a request. */
export function botViewerFromRequest(
  req: { headers: { get(name: string): string | null } },
  requestedUser: string | null | undefined,
): BotViewer {
  return botViewer(req.headers.get(VIEWER_EMAIL_HEADER), requestedUser);
}

/**
 * Is the local per-user split switched on at all?
 *
 * users.ts owns this contract and states it plainly: with no LFG_USERS and no
 * onboarding profiles "there is nobody to split the session list between — the
 * feature is OFF, not 'every user is invalid'". Session tagging already honours
 * that. The bot roster did not, and filtered by user on precisely the boxes
 * that have no users to filter by, which is what made a shared hosted Computer
 * show an empty bot list to everyone on it.
 */
export function localUserSplitEnabled(roster: readonly string[]): boolean {
  return roster.length > 0;
}

/**
 * Which of this machine's bots the caller may see.
 *
 * Three cases, in order:
 *   1. A managed caller sees every bot. Control-plane already proved they hold
 *      an active share for this exact machine, and sharing is per machine, so
 *      there is nothing left to scope down to.
 *   2. A box with no local roster has no user split (see above), so it shows
 *      its bots to whoever the box already answered. This is the hosted
 *      Computer case, and it is also the single-user self-hosted case, whose
 *      behaviour is unchanged because there was never more than one person.
 *   3. A self-hosted box WITH a configured roster keeps its existing
 *      owner-scoped view verbatim, including "no `?user=` means show all".
 *      That is a view preference between people who already share the box and
 *      already have no auth between them; this change does not pretend it is
 *      more than that, and does not weaken it either.
 */
export function visibleBots(
  bots: readonly Bot[],
  viewer: BotViewer,
  roster: readonly string[],
  requestedUser: string | null | undefined,
): Bot[] {
  if (viewer.managed) return [...bots];
  if (!localUserSplitEnabled(roster)) return [...bots];
  if (requestedUser == null) return [...bots];
  return bots.filter((bot) => botReadUser(bot.owner) === botReadUser(requestedUser));
}

/** Whether one bot is visible to this viewer, on the same rules as `visibleBots`. */
export function canSeeBot(
  bot: Bot,
  viewer: BotViewer,
  roster: readonly string[],
  requestedUser: string | null | undefined,
): boolean {
  return visibleBots([bot], viewer, roster, requestedUser).length > 0;
}

/**
 * Authorize opening one bot conversation, and say whose read state to move.
 *
 * Returns the VIEWER's identity, not the bot owner's. Marking a shared
 * conversation read used to advance the OWNER's watermark, because the legacy
 * check could only succeed when the two were equal and the route then reused
 * the owner it had matched against. On a shared Computer they are routinely
 * different people, and Angel clearing her badge must not clear Benny's.
 *
 * Throws the same two messages the route already maps to 404 and 403, so an
 * unauthorized id stays indistinguishable from one that does not exist.
 */
export function assertBotConversationAccess(
  viewer: BotViewer,
  roster: readonly string[],
  requestedUser: string | null | undefined,
  sessionId: string,
  sessions: BotConversationOwnerRow[],
  bots: Bot[],
): { bot: Bot; user: string } {
  const owner = conversationOwner(sessionId, sessions, bots);
  if (!owner) throw new Error("bot conversation not found");
  if (viewer.managed || !localUserSplitEnabled(roster)) return { bot: owner.bot, user: viewer.identity };
  if (owner.user !== botReadUser(requestedUser))
    throw new Error("bot conversation belongs to another user");
  return { bot: owner.bot, user: viewer.identity };
}
