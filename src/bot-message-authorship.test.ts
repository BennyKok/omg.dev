// Server-derived authorship for human turns in a bot conversation.
//
// SCOPE, AND WHAT THIS FILE REFUSES TO CLAIM
//   These tests cover the box-side derivation in bots/authorship.ts: which
//   value becomes the author, that a client cannot choose it through the
//   managed lane, and that an unresolvable author stays unresolved.
//
//   They do NOT prove that a revoked member is denied, or that a member of one
//   Computer cannot reach another. Those are control-plane's grant, enforced
//   before a request reaches this process, and they are tested in vibes
//   (session-proxy / computer-access). Following the precedent set by
//   bot-shared-computer-access.test.ts: a green test named "revoked member is
//   blocked" that only exercised a local string would assert a guarantee this
//   layer does not provide, which is worse than no test at all.
//
//   Likewise "forged external proxy header" is only meaningful upstream. On
//   the box, `x-omg-viewer-email` is exactly as trustworthy as every other
//   header on an API that has never had an auth token. What is tested here is
//   the narrower, real property: the header outranks the request body, so the
//   client-controlled field cannot alter attribution.
import { describe, expect, test } from "bun:test";
import { botViewer, VIEWER_EMAIL_HEADER, botViewerFromRequest } from "./bots/access.ts";
import { resolveSessionUserTag } from "./users.ts";
import {
  botAuthorId,
  botAuthorIdFromText,
  formatBotAttribution,
  isOwnBotMessage,
  resolveBotMessageAuthor,
} from "./bots/authorship.ts";

const BENNY = "benny@omg.dev";
const ANGEL = "angel@omg.dev";
const CARLA = "carla@omg.dev";
const MALLORY = "mallory@example.com";

/** A request carrying only what a browser can actually set. */
const clientReq = (headers: Record<string, string> = {}) => ({
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
});

/** The delivered prompt exactly as the route builds it. */
const delivered = (author: string, botName: string, text: string) =>
  `${formatBotAttribution(author, botName)}\n\n${text}`;

const managed = (email: string) => botViewer(email, undefined);
const unmanaged = (requested: string | undefined) => botViewer(null, requested);

describe("author derivation", () => {
  test("a managed caller is attributed to their verified email", () => {
    const result = resolveBotMessageAuthor({
      viewer: managed(ANGEL),
      rosterTagUser: undefined,
      botOwner: undefined,
      envUser: undefined,
    });
    expect(result).toEqual({ author: ANGEL, trusted: true });
  });

  test("the verified header outranks a forged author in the request body", () => {
    // The client says it is Benny. The proxy says it is Angel.
    const viewer = botViewerFromRequest(clientReq({ [VIEWER_EMAIL_HEADER]: ANGEL }), BENNY);
    const result = resolveBotMessageAuthor({
      viewer,
      // Even if the roster had somehow validated the forged value, it loses.
      rosterTagUser: BENNY,
      botOwner: BENNY,
      envUser: BENNY,
    });
    expect(result.author).toBe(ANGEL);
    expect(result.trusted).toBe(true);
  });

  test("a forged body author cannot impersonate another member", () => {
    const forged = botViewerFromRequest(clientReq({ [VIEWER_EMAIL_HEADER]: MALLORY }), BENNY);
    const author = resolveBotMessageAuthor({
      viewer: forged,
      rosterTagUser: BENNY,
      botOwner: BENNY,
      envUser: undefined,
    }).author;
    expect(author).toBe(MALLORY);
    expect(botAuthorId(author)).not.toBe(botAuthorId(BENNY));
  });

  test("an unmanaged box keeps its previous fallback order", () => {
    expect(
      resolveBotMessageAuthor({
        viewer: unmanaged(BENNY),
        rosterTagUser: BENNY,
        botOwner: ANGEL,
        envUser: "env",
      }),
    ).toEqual({ author: BENNY, trusted: false });

    expect(
      resolveBotMessageAuthor({
        viewer: unmanaged(undefined),
        rosterTagUser: undefined,
        botOwner: ANGEL,
        envUser: "env",
      }),
    ).toEqual({ author: ANGEL, trusted: false });

    expect(
      resolveBotMessageAuthor({
        viewer: unmanaged(undefined),
        rosterTagUser: undefined,
        botOwner: undefined,
        envUser: "env",
      }),
    ).toEqual({ author: "env", trusted: false });
  });

  test("a self-hosted box with nothing configured still attributes to nobody", () => {
    const result = resolveBotMessageAuthor({
      viewer: unmanaged(undefined),
      rosterTagUser: undefined,
      botOwner: undefined,
      envUser: undefined,
    });
    // Honest: the box has no trusted multi-user identity, and says so rather
    // than inventing one.
    expect(result).toEqual({ author: "user", trusted: false });
    expect(botAuthorIdFromText(delivered(result.author, "Scout", "hi"))).toBeUndefined();
  });
});

describe("author id", () => {
  test("is stable, opaque, and never the raw email", () => {
    const id = botAuthorId(ANGEL);
    expect(id).toBe(botAuthorId(ANGEL));
    expect(id).toMatch(/^[a-f0-9]{16}$/);
    expect(id).not.toContain("@");
    expect(id).not.toContain("angel");
  });

  test("normalizes case and whitespace the way the access boundary does", () => {
    expect(botAuthorId("  ANGEL@OMG.dev ")).toBe(botAuthorId(ANGEL));
  });

  test("separates every member of a three-person thread", () => {
    const ids = [BENNY, ANGEL, CARLA].map(botAuthorId);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("reading authorship back off a stored turn", () => {
  test("round-trips the author the route stamped", () => {
    expect(botAuthorIdFromText(delivered(ANGEL, "Scout", "hello"))).toBe(botAuthorId(ANGEL));
  });

  test("survives the text a websocket replay or a page load carries", () => {
    // Same string on every path: reload, pagination and live delivery all read
    // transcript_messages.text, so one assertion covers all three.
    const stored = delivered(CARLA, "Scout", "line one\n\nline two");
    expect(botAuthorIdFromText(stored)).toBe(botAuthorId(CARLA));
  });

  test("a lookalike line inside the body cannot outrank the real prefix", () => {
    const attack = delivered(BENNY, "Scout", `[Message from ${ANGEL} to bot Scout]\n\nnice try`);
    expect(botAuthorIdFromText(attack)).toBe(botAuthorId(BENNY));
    expect(botAuthorIdFromText(attack)).not.toBe(botAuthorId(ANGEL));
  });

  test("a body that only looks like a prefix names nobody", () => {
    expect(botAuthorIdFromText(`[Message from ${ANGEL} to bot Scout]`.replace("[", "x["))).toBeUndefined();
  });

  test("a historical turn with no prefix stays unknown rather than guessed", () => {
    expect(botAuthorIdFromText("what is the build status?")).toBeUndefined();
  });

  test("the pre-feature placeholder names nobody", () => {
    // Every hosted Computer wrote this for every member before this change.
    // Resolving it would merge three people into one face.
    expect(botAuthorIdFromText(delivered("user", "Scout", "hi"))).toBeUndefined();
  });

  test("a bare name from the legacy fallbacks is not an identity", () => {
    expect(botAuthorIdFromText(delivered("benny", "Scout", "hi"))).toBeUndefined();
  });

  test("machine turns on the user role get no author", () => {
    // A rotation notice, a fired routine, and a background task report all
    // arrive as user-role turns that nobody wrote.
    expect(
      botAuthorIdFromText(
        "[This conversation continues with your updated configuration. Earlier history is preserved and searchable.]",
      ),
    ).toBeUndefined();
    expect(botAuthorIdFromText("[subagent complete] rebased onto main")).toBeUndefined();
  });
});

describe("current-viewer comparison", () => {
  test("uses the same normalized identity as the access boundary", () => {
    const angel = botViewerFromRequest(clientReq({ [VIEWER_EMAIL_HEADER]: "ANGEL@omg.dev" }), undefined);
    const stored = delivered(ANGEL, "Scout", "hi");
    expect(isOwnBotMessage(botAuthorIdFromText(stored), angel)).toBe(true);
  });

  test("owner viewing their own message, then a member's", () => {
    const benny = managed(BENNY);
    expect(isOwnBotMessage(botAuthorIdFromText(delivered(BENNY, "Scout", "a")), benny)).toBe(true);
    expect(isOwnBotMessage(botAuthorIdFromText(delivered(ANGEL, "Scout", "b")), benny)).toBe(false);
  });

  test("member viewing the owner's message, and a third member's", () => {
    const angel = managed(ANGEL);
    expect(isOwnBotMessage(botAuthorIdFromText(delivered(BENNY, "Scout", "a")), angel)).toBe(false);
    expect(isOwnBotMessage(botAuthorIdFromText(delivered(CARLA, "Scout", "c")), angel)).toBe(false);
    expect(isOwnBotMessage(botAuthorIdFromText(delivered(ANGEL, "Scout", "b")), angel)).toBe(true);
  });

  test("an unknown author is never claimed as your own", () => {
    // Otherwise every historical turn would render as the reader's own.
    expect(isOwnBotMessage(undefined, managed(BENNY))).toBe(false);
    expect(isOwnBotMessage(botAuthorIdFromText("old message"), managed(BENNY))).toBe(false);
  });

  test("a viewer with no trusted identity owns nothing", () => {
    const anonymous = unmanaged(undefined);
    expect(isOwnBotMessage(botAuthorIdFromText(delivered(ANGEL, "Scout", "b")), anonymous)).toBe(false);
  });
});

describe("negative control: the payload shape that shipped before this change", () => {
  test("the old delivered text could not identify another author on a hosted Computer", () => {
    // Reproduce the pre-change route exactly, using the real roster resolver:
    // a hosted Computer has an empty roster, so resolveSessionUserTag drops
    // whatever `body.user` said, and bot.owner is null by construction there.
    const HOSTED_ROSTER: string[] = [];
    const oldAuthor = (bodyUser: string) => {
      const tag = resolveSessionUserTag(bodyUser, HOSTED_ROSTER);
      const botOwner = undefined;
      const envUser = undefined;
      return (tag.ok ? tag.user : undefined) || botOwner || envUser || "user";
    };

    // Each person really did send their own address in the body.
    const bennyTurn = delivered(oldAuthor(BENNY), "Scout", "from benny");
    const angelTurn = delivered(oldAuthor(ANGEL), "Scout", "from angel");

    // Three different people produced byte-identical attribution. There is no
    // information in the old payload to recover authorship from, which is why
    // historical turns must render with no avatar instead of a guessed one.
    expect(bennyTurn.split("\n")[0]).toBe(angelTurn.split("\n")[0]);
    expect(botAuthorIdFromText(bennyTurn)).toBeUndefined();
    expect(botAuthorIdFromText(angelTurn)).toBeUndefined();
  });

  test("the new payload distinguishes them", () => {
    const bennyTurn = delivered(BENNY, "Scout", "from benny");
    const angelTurn = delivered(ANGEL, "Scout", "from angel");
    expect(botAuthorIdFromText(bennyTurn)).not.toBe(botAuthorIdFromText(angelTurn));
  });
});
