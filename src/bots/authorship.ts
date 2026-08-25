// Who wrote a human turn in a bot conversation, and how the UI is allowed to
// say so.
//
// WHAT WAS ACTUALLY BROKEN
//   `POST /api/bots/:id/messages` decided authorship from `body.user` — a
//   value the client supplies — and never read the one trusted identity the
//   box receives. On a self-hosted box with a configured roster that is a
//   forgeable author: any caller who can reach the API can post as any roster
//   member, and the resulting `[Message from ...]` line is indistinguishable
//   from a genuine one. On a hosted Computer it fails the other way: the
//   roster is empty by construction, so `resolveSessionUserTag` drops the
//   value and every human turn is attributed to the literal string "user",
//   from everybody. Neither outcome can support "show me who said this".
//
//   bots/access.ts already resolves the trusted caller for the READ routes
//   (`GET /api/bots`, the read-marking POST). The write route simply never
//   asked. This module is where the write route asks.
//
// THE PREFIX IS THE STORE
//   Authorship is persisted in the message itself, as the `[Message from X to
//   bot Y]` line the server has always written onto the delivered prompt. That
//   is deliberate and it is not a shortcut:
//
//     - It is server-authored. The client sends `text`; the server builds the
//       prefix and puts its own value there.
//     - It is anchored to the start of the turn, so a client that types a
//       lookalike line into its own message body cannot outrank the real one:
//       the parser takes the first match at position zero and nothing else.
//     - It is already carried, verbatim, by every path that matters — reload,
//       pagination, websocket replay, and search all read the same
//       `transcript_messages.text`. A side table keyed on message identity
//       would have to be re-correlated at each of those, and the correlation
//       key does not exist: the transcript row is written by the AGENT from
//       its own JSONL, not by the route that accepted the message.
//     - Session rotation carries it for free, because rotation does not
//       rewrite the old transcript (confirmed with the session that owns it).
//
//   So there is one owner for "who wrote this" and it is the turn text. This
//   module owns reading and writing that one representation; nothing else
//   should pattern-match the prefix.
//
// WHY THE CLIENT NEVER SEES THE EMAIL
//   The prefix holds the raw email because the BOT reads it — it is the only
//   way the model can tell three humans apart in a shared thread. The client
//   payload must not carry it: a bot transcript is rendered, quoted, copied
//   and searched, and a member's address is not something the surface needs in
//   order to draw a face. So the box emits `authorId` — an opaque, stable
//   digest of the normalized email — and the surface joins that against the
//   binding-scoped roster it already receives in `GET /api/bootstrap`.
//
//   The digest is not a secrecy claim and must not be described as one: an
//   email is low-entropy and anyone holding a candidate address can confirm a
//   match. It is a scope claim. Confirming a match requires already knowing
//   the address, and on a shared Computer the only people who receive the
//   roster are the members of that exact Computer, which control-plane scopes
//   to the (owner, bindingId) pair. The payload adds no reach beyond the
//   boundary that already exists.

import { createHash } from "node:crypto";
import type { BotViewer } from "./access.ts";

/**
 * The attribution line the server writes onto every delivered human turn.
 *
 * Anchored at position zero on purpose — see the module note. `[^\]]+` cannot
 * cross the closing bracket, so a body containing its own bracketed line is
 * not reachable by this pattern.
 */
const ATTRIBUTION_AT_START = /^\s*\[Message from ([^\]]+) to bot [^\]]+\]/i;

/** Normalize an identity the same way the access boundary does. */
function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * The opaque per-person id the client payload carries.
 *
 * Versioned in the preimage so this can be rotated later without silently
 * colliding with ids already rendered by an older surface.
 */
export function botAuthorId(email: string): string {
  const normalized = normalizeEmail(email);
  if (!normalized) return "";
  return createHash("sha256").update(`omg-bot-author-v1:${normalized}`).digest("hex").slice(0, 16);
}

/**
 * The author the server will stamp onto an accepted human turn.
 *
 * Order is the whole point:
 *
 *   1. A managed caller's trusted email wins, always. It came from an
 *      HMAC-verified grant that control-plane issued only after checking the
 *      share row for this exact machine, and the proxy builds its forwarded
 *      headers from a fixed whitelist, so a browser cannot put it there. When
 *      it is present, `body.user` is not consulted at all — that is what makes
 *      a forged author field inert rather than merely unlikely to be believed.
 *
 *   2. Otherwise the box is not managed and there is no trusted multi-user
 *      identity available. Fall back to exactly the behaviour that shipped
 *      before this change: the roster-validated tag, then the bot's owner,
 *      then OMG_USER, then the literal "user". A self-hosted box with a
 *      roster keeps trusting its own callers because it always has — the
 *      box's `/api/*` has no auth token and this module does not pretend to
 *      add one. What it must not do is claim the result is verified.
 *
 * `trusted` is what tells the read side whether this attribution is worth
 * drawing a face next to.
 */
export function resolveBotMessageAuthor(input: {
  viewer: BotViewer;
  rosterTagUser: string | undefined;
  botOwner: string | undefined;
  envUser: string | undefined;
}): { author: string; trusted: boolean } {
  if (input.viewer.managed) {
    const trusted = normalizeEmail(input.viewer.identity);
    if (trusted) return { author: trusted, trusted: true };
  }
  const fallback =
    input.rosterTagUser?.trim() ||
    input.botOwner?.trim() ||
    input.envUser?.trim() ||
    "user";
  return { author: fallback, trusted: false };
}

/** The attribution line, exactly as it has always been written. */
export function formatBotAttribution(author: string, botName: string): string {
  return `[Message from ${author} to bot ${botName}]`;
}

/**
 * The prefix for a turn that reached a bot because someone tagged it with `@`
 * in an ordinary coding session, rather than by writing in the bot's own chat.
 *
 * The standard attribution line stays FIRST and unchanged. That is load
 * bearing: `ATTRIBUTION_AT_START` is anchored at position zero, so moving it
 * would strip the author off the turn and render it with no face. The mention
 * context is a second line, following the convention of the other non-direct
 * inbound turns (`[Scheduled routine: ...]`, `[Peer message from ...]`) so the
 * bot can tell it was tagged in someone else's session and is not being
 * addressed in its own chat.
 */
export function formatBotMentionAttribution(
  author: string,
  botName: string,
  context: { sessionId: string; title?: string | null },
): string {
  // Short id only. The full uuid is noise in a prompt, and the session routes
  // resolve an 8-char prefix.
  const short = context.sessionId.slice(0, 8);
  const title = context.title?.trim();
  const where = title ? `${title} (${short})` : short;
  return `${formatBotAttribution(author, botName)}\n[Mentioned by ${author} in session ${where}]`;
}

/**
 * Read the author back off a stored turn, as an opaque id.
 *
 * Returns undefined — never a guess — when the turn has no server-authored
 * prefix. That is the honest answer for three real cases that must stay
 * distinguishable from "authored by somebody we can name":
 *
 *   - Every human turn written before this feature existed. Historical
 *     transcripts predate the trusted header entirely, and the emails in their
 *     prefixes were client-supplied, so they are not evidence of authorship.
 *     They render with no avatar rather than a wrong one.
 *   - Machine turns that arrive on the user role: a rotation notice, a fired
 *     routine, a background task report. Nobody wrote them.
 *   - Anything whose prefix does not sit at position zero.
 *
 * An unresolvable author is not an error and must not be filled in.
 */
export function botAuthorEmailFromText(text: string): string | undefined {
  const match = ATTRIBUTION_AT_START.exec(text);
  if (!match) return undefined;
  const email = normalizeEmail(match[1]);
  // The pre-feature placeholder. It names no one, so it must not become an id
  // that three different people would all match.
  if (!email || email === "user") return undefined;
  // Only an address can be a person. The legacy fallbacks put a bot owner or
  // an OMG_USER value here, which may be a bare name, and a bare name is not
  // an identity the roster can resolve.
  if (!email.includes("@")) return undefined;
  return email;
}

/**
 * The author of a stored turn, as the opaque id a client payload may carry.
 *
 * This is the ONLY form the surface is allowed to receive. The email stays on
 * the box; see the module note on why the digest is a scope claim and not a
 * secrecy claim.
 */
export function botAuthorIdFromText(text: string): string | undefined {
  const email = botAuthorEmailFromText(text);
  return email ? botAuthorId(email) : undefined;
}

/**
 * Whether a turn's author is the person reading it.
 *
 * Deliberately takes the SAME normalized identity the access boundary uses
 * (`BotViewer.identity`, which bots/access.ts derives from the trusted header)
 * rather than anything the surface knows about itself. If these two ever
 * disagree, "is this mine" and "may I read this" would be answering questions
 * about different people.
 */
export function isOwnBotMessage(authorId: string | undefined, viewer: BotViewer): boolean {
  if (!authorId) return false;
  const self = botAuthorId(viewer.identity);
  return !!self && self === authorId;
}
