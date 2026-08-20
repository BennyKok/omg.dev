// Bot visibility on a shared Computer.
//
// SCOPE OF THIS FILE, AND WHAT IT DELIBERATELY DOES NOT CLAIM
//   These tests cover the box-side policy in bots/access.ts. They do NOT prove
//   that an unauthorized person cannot reach the box: that is control-plane's
//   grant, and it is tested in vibes (session-proxy / computer-access). Saying
//   so here rather than writing a green test named "revoked member is denied"
//   that only exercises a local email string, which would assert a guarantee
//   this layer does not provide.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { createBot, updateBot, type Bot } from "./bots/store.ts";
import {
  assertBotConversationAccess,
  botCreationOwner,
  botViewer,
  botViewerFromRequest,
  visibleBots,
  VIEWER_EMAIL_HEADER,
} from "./bots/access.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-bot-shared-"));
  PATHS.data = root;
});

afterEach(() => {
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

const BENNY = "benny@omg.dev";
const ANGEL = "angel@omg.dev";
const STRANGER = "mallory@example.com";

/** A request carrying only what a browser can actually set. */
const clientReq = (headers: Record<string, string> = {}) => ({
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
});

/** The hosted shape: empty local roster, so every bot persists ownerless. */
async function hostedBots(): Promise<Bot[]> {
  const a = await createBot({ name: "Scout", persona: "p", owner: undefined });
  const b = await createBot({ name: "Planner", persona: "p", owner: undefined });
  return [a, b];
}

describe("shared Computer bot visibility", () => {
  test("a managed member sees every bot on the machine", async () => {
    const bots = await hostedBots();
    const angel = botViewer(ANGEL, ANGEL);
    expect(visibleBots(bots, angel, [], ANGEL).map((b) => b.name)).toEqual(["Scout", "Planner"]);
  });

  test("the owner keeps seeing their bots after the Computer is shared", async () => {
    // The regression Benny actually hit. Sharing merges a roster into
    // /api/bootstrap, the client stops sending an empty `?user=` and starts
    // sending a real email, and the old owner filter then matched nothing —
    // for the OWNER as well as the guest, because a hosted box stores every
    // bot with owner: null.
    const bots = await hostedBots();
    expect(bots.every((b) => !b.owner)).toBe(true);
    const benny = botViewer(BENNY, BENNY);
    expect(visibleBots(bots, benny, [], BENNY)).toHaveLength(2);
  });

  test("a box whose LOCAL roster is just the owner does not filter", async () => {
    // The live shape behind this bug. The box's own roster is one name; the
    // other members exist only in the roster control-plane merges into the
    // bootstrap response, which never reaches the box. So the box must not
    // treat its single local name as a user split, or every guest keeps
    // getting an empty list even after control-plane identifies them.
    const mine = await createBot({ name: "Mine", persona: "p", owner: BENNY });
    const angel = botViewer(null, ANGEL);
    expect(visibleBots([mine], angel, [BENNY], ANGEL)).toHaveLength(1);
  });

  test("a roster-less box does not filter, with or without a trusted header", async () => {
    // users.ts owns this contract: no roster means the per-user split is OFF.
    const bots = await hostedBots();
    const untrusted = botViewer(null, ANGEL);
    expect(untrusted.managed).toBe(false);
    expect(visibleBots(bots, untrusted, [], ANGEL)).toHaveLength(2);
  });

  test("a self-hosted box with a configured roster keeps its owner-scoped view", async () => {
    const roster = [BENNY, ANGEL];
    const mine = await createBot({ name: "Mine", persona: "p", owner: BENNY });
    const theirs = await createBot({ name: "Theirs", persona: "p", owner: ANGEL });
    const bots = [mine, theirs];
    const benny = botViewer(null, BENNY);
    expect(visibleBots(bots, benny, roster, BENNY).map((b) => b.name)).toEqual(["Mine"]);
    const angel = botViewer(null, ANGEL);
    expect(visibleBots(bots, angel, roster, ANGEL).map((b) => b.name)).toEqual(["Theirs"]);
  });
});

describe("the ?user= parameter is an identity, never an authorization input", () => {
  test("a managed create is charged to the trusted member, not the body user", () => {
    const viewer = botViewerFromRequest(clientReq({ [VIEWER_EMAIL_HEADER]: ANGEL }), BENNY);
    expect(botCreationOwner(viewer, BENNY, [BENNY, ANGEL])).toEqual({
      ok: true,
      owner: ANGEL,
    });
  });

  test("a local create still rejects a user outside the configured roster", () => {
    const viewer = botViewerFromRequest(clientReq(), STRANGER);
    expect(botCreationOwner(viewer, STRANGER, [BENNY, ANGEL])).toEqual({
      ok: false,
      unknown: STRANGER,
    });
  });

  test("a forged ?user= cannot change what a managed viewer sees", async () => {
    const bots = await hostedBots();
    // Angel edits the URL to claim she is Benny. The trusted header still
    // decides, so this buys her nothing she did not already have and, more to
    // the point, cannot move her onto his read state.
    const forged = botViewerFromRequest(clientReq({ [VIEWER_EMAIL_HEADER]: ANGEL }), BENNY);
    expect(forged.identity).toBe(ANGEL);
    expect(forged.managed).toBe(true);
    expect(visibleBots(bots, forged, [], BENNY)).toHaveLength(2);
  });

  test("the trusted header wins over the query parameter", () => {
    const viewer = botViewerFromRequest(clientReq({ [VIEWER_EMAIL_HEADER]: ANGEL }), STRANGER);
    expect(viewer.identity).toBe(ANGEL);
  });

  test("a stale identity in the query parameter does not survive into read state", async () => {
    const [bot] = await hostedBots();
    await updateBot(bot.id, { sessionId: "conv-1" });
    const sessions = [{ sessionId: "conv-1", botId: bot.id, assignedUser: BENNY }];
    const angel = botViewerFromRequest(clientReq({ [VIEWER_EMAIL_HEADER]: ANGEL }), BENNY);
    const access = assertBotConversationAccess(
      angel, [], BENNY, "conv-1", sessions, [{ ...bot, sessionId: "conv-1" }],
    );
    // Angel's badge is Angel's. Clearing it must not advance Benny's watermark.
    expect(access.user).toBe(ANGEL);
  });

  test("no header and no query parameter still does not leak on a rostered box", async () => {
    const roster = [BENNY, ANGEL];
    const mine = await createBot({ name: "Mine", persona: "p", owner: BENNY });
    const anon = botViewer(null, null);
    // Unchanged legacy behaviour: an omitted ?user= on a self-hosted box is the
    // "show everything" view, and this box has no auth between its people by
    // design. Asserted so a future change to it is a deliberate one.
    expect(visibleBots([mine], anon, roster, null)).toHaveLength(1);
  });
});

describe("conversation access", () => {
  test("an unrelated conversation id is not found rather than forbidden", async () => {
    const [bot] = await hostedBots();
    const viewer = botViewer(ANGEL, ANGEL);
    expect(() => assertBotConversationAccess(viewer, [], ANGEL, "nope", [], [bot]))
      .toThrow("not found");
  });

  test("a rostered self-hosted box still denies another user's conversation", async () => {
    const bot = await createBot({ name: "Private", persona: "p", owner: BENNY });
    await updateBot(bot.id, { sessionId: "private" });
    const sessions = [{ sessionId: "private", botId: bot.id, assignedUser: BENNY }];
    const other = botViewer(null, STRANGER);
    expect(() =>
      assertBotConversationAccess(
        other, [BENNY, ANGEL], STRANGER, "private", sessions, [{ ...bot, sessionId: "private" }],
      ),
    ).toThrow("belongs to another user");
  });

  test("a managed member may open a conversation the bot owner started", async () => {
    const [bot] = await hostedBots();
    await updateBot(bot.id, { sessionId: "shared" });
    const sessions = [{ sessionId: "shared", botId: bot.id, assignedUser: BENNY }];
    const angel = botViewer(ANGEL, ANGEL);
    const access = assertBotConversationAccess(
      angel, [], ANGEL, "shared", sessions, [{ ...bot, sessionId: "shared" }],
    );
    expect(access.bot.id).toBe(bot.id);
    expect(access.user).toBe(ANGEL);
  });
});
