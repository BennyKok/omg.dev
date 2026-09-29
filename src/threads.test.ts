import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { formatSessionMentionToken, threadRefFromHref } from "../packages/protocol/src/session-mention-token.ts";
import { createImageArtifact } from "./artifacts.ts";
import { uploadsDir } from "./uploads.ts";
import { authorAgent, startsMessageGroup, linkMentions, mentionAgents, mentionedAgent, mentionFromHref, threadMentionOptions, plainText, threadPreview, typingIn, typingLabel, typingPinger } from "../packages/protocol/src/threads.ts";
import { attachRuntimeSession, getConversation, listConversations } from "./conversations.ts";
import {
  answerMention,
  appendThreadMessage,
  bridgeTaskCompletion,
  addMentionedPeople,
  keepSessionFile,
  setThreadNotifier,
  threadPeople,
  keepThreadUpload,
  resolveThreadRef,
  listThreads,
  mentionsOmg,
  omgWake,
  parseOmgDecision,
  readThreadMessages,
  setTyping,
  startThread,
  threadAuthor,
  threadTasks,
  threadTyping,
  transcriptForModel,
  turnAnswer,
  threadUpdate,
  type ThreadDeps,
} from "./threads.ts";

const originalData = PATHS.data;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-threads-"));
  PATHS.data = join(root, "data");
});

afterEach(() => {
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

function deps(overrides: Partial<ThreadDeps> = {}): ThreadDeps & { started: string[]; told: { sessionId: string; text: string }[] } {
  const started: string[] = [];
  const told: { sessionId: string; text: string }[] = [];
  return {
    started,
    told,
    complete: async () => null,
    tellTask: async ({ sessionId, text }) => {
      told.push({ sessionId, text });
    },
    startTask: async ({ prompt }) => {
      started.push(prompt);
      return "a1b2c3d4-0000-4000-8000-000000000001";
    },
    ...overrides,
  };
}

describe("a thread is people-first chat", () => {
  test("starting a thread creates no session, only a conversation and its messages", () => {
    const thread = startThread({ identity: "benny@example.com", name: "Benny" });
    const author = threadAuthor(thread.id, "benny@example.com", "Benny");
    appendThreadMessage(thread.id, { author, text: "Should we drop the free tier?" });

    const stored = getConversation(thread.id)!;
    expect(stored.kind).toBe("thread");
    expect(stored.runtimeSessions).toEqual([]);
    expect(stored.participants.map((row) => row.role)).toEqual(["owner"]);

    const [summary] = listThreads();
    expect(summary.title).toBe("Should we drop the free tier?");
    expect(summary.lastMessage?.text).toBe("Should we drop the free tier?");
  });

  test("a second person joins as a member when they write", () => {
    const thread = startThread({ identity: "benny@example.com" });
    threadAuthor(thread.id, "alex@example.com", "Alex");
    expect(getConversation(thread.id)!.participants.map((row) => row.role)).toEqual(["owner", "member"]);
  });

  test("a box with no identities calls its person You, not the placeholder", () => {
    const thread = startThread({ identity: "__local__" });
    expect(getConversation(thread.id)!.participants[0].display.fallback).toBe("You");
    expect(threadAuthor(thread.id, "__local__")).toMatchObject({ kind: "human", name: "You" });
  });

  test("an archived thread is not listed", () => {
    const thread = startThread({ identity: "benny@example.com" });
    threadUpdate(thread.id, { archived: true });
    expect(listThreads()).toEqual([]);
    expect(listConversations()).toHaveLength(1);
  });
});

describe("@omg", () => {
  test("only an explicit mention wakes omg", () => {
    expect(mentionsOmg("@omg what does Linear charge?")).toBe(true);
    expect(mentionsOmg("ok @OMG do it")).toBe(true);
    expect(mentionsOmg("omg that is great")).toBe(false);
    expect(mentionsOmg("mail me at x@omg.dev")).toBe(false);
  });

  test("the model's JSON decides reply or task; anything else is a task", () => {
    expect(parseOmgDecision('{"action":"reply","text":"About $8 a seat."}', "q")).toEqual({
      action: "reply",
      text: "About $8 a seat.",
    });
    expect(parseOmgDecision('```json\n{"action":"task","title":"Update pricing","prompt":"Edit pricing.tsx"}\n```', "q"))
      .toEqual({ action: "task", title: "Update pricing", prompt: "Edit pricing.tsx" });
    expect(parseOmgDecision(null, "update the pricing page")).toEqual({
      action: "task",
      title: "update the pricing page",
      prompt: "update the pricing page",
    });
  });

  test("a quick question gets a reply from omg and starts nothing", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    const d = deps({ complete: async () => '{"action":"reply","text":"Linear is $8 per seat."}' });
    const reply = await answerMention(thread.id, "@omg what does Linear charge?", "benny@example.com", d, "root-1");
    expect(reply).toMatchObject({ author: { kind: "omg" }, text: "Linear is $8 per seat.", replyTo: "root-1" });
    expect(d.started).toEqual([]);
    expect(getConversation(thread.id)!.runtimeSessions).toEqual([]);
  });

  test("real work starts one task in the thread's project, with the thread as context", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    threadUpdate(thread.id, { project: { cwd: "/repos/web", name: "web" } });
    appendThreadMessage(thread.id, {
      author: threadAuthor(thread.id, "alex@example.com", "Alex"),
      text: "Keep the free tier but cap it at 3 tasks a day.",
    });
    let cwd: string | null = "unset";
    const d = deps({
      complete: async () => '{"action":"task","title":"Cap the free tier","prompt":"Update the pricing page."}',
      startTask: async (input) => {
        cwd = input.cwd;
        d.started.push(input.prompt);
        return "a1b2c3d4-0000-4000-8000-000000000001";
      },
    });
    const posted = await answerMention(thread.id, "@omg update the pricing page", "benny@example.com", d, "root-2");

    expect(cwd).toBe("/repos/web");
    expect(d.started[0]).toContain("Update the pricing page.");
    expect(d.started[0]).toContain("Alex: Keep the free tier but cap it at 3 tasks a day.");
    expect(posted).toMatchObject({
      author: { kind: "omg" },
      text: "Started a task in web.",
      task: { sessionId: "a1b2c3d4-0000-4000-8000-000000000001", event: "started", project: "web" },
      replyTo: "root-2",
    });
    expect(getConversation(thread.id)!.runtimeSessions).toMatchObject([
      { sessionId: "a1b2c3d4-0000-4000-8000-000000000001", kind: "execution" },
    ]);
  });

  test("a task that cannot start says why, in the thread", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    const d = deps({ startTask: async () => { throw new Error("24 of 16 agents live"); } });
    const posted = await answerMention(thread.id, "@omg fix the build", "benny@example.com", d, "root-3");
    expect(posted!.text).toBe("I could not start the task: 24 of 16 agents live");
    expect(posted!.task).toBeUndefined();
  });
});

describe("task results come back as omg messages", () => {
  const TASK = "a1b2c3d4-0000-4000-8000-000000000001";

  async function threadWithTask() {
    const thread = startThread({ identity: "benny@example.com" });
    await answerMention(thread.id, "@omg fix it", "benny@example.com", deps(), "root-4");
    return thread;
  }

  test("a finished turn posts the task's own words, whole", async () => {
    const thread = await threadWithTask();
    const posted = bridgeTaskCompletion(TASK, {
      title: "Fix it",
      project: "web",
      status: "ok",
      last: { role: "assistant", kind: "text", text: "Fixed the build.\n\nTests pass.\nNothing else to do.\nExtra line." },
    });
    expect(posted).toMatchObject({
      author: { kind: "omg" },
      // Whole, with its blank lines: clients render it as markdown.
      text: "Fixed the build.\n\nTests pass.\nNothing else to do.\nExtra line.",
      task: { sessionId: TASK, event: "finished", project: "web" },
      // In the same replies the task was started in.
      replyTo: "root-4",
    });
    expect(readThreadMessages(thread.id).at(-1)?.id).toBe(posted!.id);
  });

  test("a blocked task says it needs you", async () => {
    await threadWithTask();
    const posted = bridgeTaskCompletion(TASK, { status: "blocked", statusDetail: "Waiting for approval to deploy." });
    expect(posted).toMatchObject({ text: "Waiting for approval to deploy.", task: { event: "blocked" } });
  });

  test("a session no thread started posts nothing", () => {
    expect(bridgeTaskCompletion("ffffffff-0000-4000-8000-000000000000", null)).toBeNull();
  });

  test("task rows say which tasks are live and which ended", async () => {
    const thread = await threadWithTask();
    const conversation = getConversation(thread.id)!;
    expect(threadTasks(conversation, [{ sessionId: TASK, busy: true, title: "Fix it", project: "web", status: "ok", agent: "codex" }]))
      .toEqual([{ sessionId: TASK, title: "Fix it", project: "web", busy: true, status: "ok", ended: false, agent: "codex" }]);
    expect(threadTasks(conversation, [])[0].ended).toBe(true);
  });
});

describe("push: Slack's rule, never the author", () => {
  const pushes: import("./threads.ts").ThreadPush[] = [];
  beforeEach(async () => {
    pushes.length = 0;
    const { setThreadNotifier } = await import("./threads.ts");
    setThreadNotifier((push) => pushes.push(push));
  });
  afterEach(async () => {
    const { setThreadNotifier } = await import("./threads.ts");
    setThreadNotifier(null);
  });

  test("a top-level message tells everyone else in the thread", () => {
    const thread = startThread({ identity: "benny@example.com", name: "Benny" });
    const benny = threadAuthor(thread.id, "benny@example.com", "Benny");
    threadAuthor(thread.id, "alex@example.com", "Alex");
    pushes.length = 0;
    appendThreadMessage(thread.id, { author: benny, text: "Should we drop the free tier?" });
    expect(pushes).toEqual([
      {
        user: "alex@example.com",
        notification: {
          title: "Should we drop the free tier?",
          body: "Benny: Should we drop the free tier?",
          url: `/threads/${thread.id}`,
          tag: `thread-${thread.id}-main`,
        },
      },
    ]);
  });

  test("omg's reply tells the people in that reply thread, and links to it", async () => {
    const thread = startThread({ identity: "benny@example.com", name: "Benny" });
    const benny = threadAuthor(thread.id, "benny@example.com", "Benny");
    threadAuthor(thread.id, "alex@example.com", "Alex");
    const root = appendThreadMessage(thread.id, { author: benny, text: "@omg what is 418?" });
    pushes.length = 0;
    await answerMention(thread.id, root.text, "benny@example.com", deps({ complete: async () => '{"action":"reply","text":"A teapot."}' }), root.id);
    // Alex is in the thread but not in these replies.
    expect(pushes.map((p) => p.user)).toEqual(["benny@example.com"]);
    expect(pushes[0].notification).toMatchObject({ body: "omg: A teapot.", url: `/threads/${thread.id}?replies=${root.id}` });
  });

  test("a box with no identities pushes to its devices, not to nobody", () => {
    const thread = startThread({ identity: "__local__" });
    const root = appendThreadMessage(thread.id, { author: threadAuthor(thread.id, "__local__"), text: "@omg hi" });
    pushes.length = 0;
    appendThreadMessage(thread.id, { author: { kind: "omg" }, text: "Hello.", replyTo: root.id });
    expect(pushes.map((p) => p.user)).toEqual([null]);
  });

  test("your own message does not notify you", () => {
    const thread = startThread({ identity: "benny@example.com" });
    appendThreadMessage(thread.id, { author: threadAuthor(thread.id, "benny@example.com"), text: "note to self" });
    expect(pushes).toEqual([]);
  });
});

describe("omg reads the whole thread", () => {
  const human = (id: string, text: string, extra: Partial<import("./threads.ts").ThreadMessage> = {}) =>
    ({ id, threadId: "t", ts: 1, author: { kind: "human", participantId: "p", name: "Benny" }, text, ...extra }) as import("./threads.ts").ThreadMessage;

  test("every message, each reply under the message it answers, not just the last few", async () => {
    const { transcriptForModel } = await import("./threads.ts");
    const messages = [
      human("m0", "Name and logo design for a course about vibe coding"),
      ...Array.from({ length: 30 }, (_, i) => human(`f${i}`, `filler ${i}`)),
      human("r0", "go with the second name", { replyTo: "m0" }),
      human("m1", "@omg can you work on this"),
    ];
    const text = transcriptForModel(messages);
    expect(text.startsWith("Benny: Name and logo design")).toBe(true);
    expect(text).toContain("Benny: Name and logo design for a course about vibe coding\n    ↳ Benny (reply): go with the second name");
    expect(text.endsWith("Benny: @omg can you work on this")).toBe(true);
  });

  test("a very long thread drops its oldest lines first", async () => {
    const { transcriptForModel } = await import("./threads.ts");
    const long = "x".repeat(5_000);
    const messages = Array.from({ length: 20 }, (_, i) => human(`m${i}`, `${i} ${long}`));
    const text = transcriptForModel(messages);
    expect(text.startsWith("(earlier messages left out)")).toBe(true);
    expect(text).toContain("Benny: 19 ");
    expect(text).not.toContain("Benny: 0 ");
  });

  test("the rules say a request to do something is a task, design included", async () => {
    const { OMG_THREAD_SYSTEM_PROMPT } = await import("./threads.ts");
    expect(OMG_THREAD_SYSTEM_PROMPT).toContain("work on");
    expect(OMG_THREAD_SYSTEM_PROMPT).toContain("design (names, logos, images, pages)");
    expect(OMG_THREAD_SYSTEM_PROMPT).toContain("Do not ask a clarifying question when the thread already says what is meant");
  });
});

describe("people are drawn as they are now", () => {
  test("a participant carries the roster's current name and photo, in old threads too", async () => {
    const { participantsForView } = await import("./threads.ts");
    const thread = startThread({ identity: "benny@example.com" });
    threadAuthor(thread.id, "alex@example.com");
    const roster = [
      { email: "benny@example.com", name: "Benny", avatar: "/api/avatars/benny.png?v=2" },
      { email: "alex@example.com", name: "Alex", avatar: "https://gravatar.com/avatar/x" },
    ];
    const people = participantsForView(getConversation(thread.id)!, roster);
    expect(people.map((row) => row.display)).toMatchObject([
      { name: "Benny", avatar: "/api/avatars/benny.png?v=2" },
      { name: "Alex", avatar: "https://gravatar.com/avatar/x" },
    ]);
  });
});

describe("typing", () => {
  const alex = { kind: "human" as const, participantId: "p-alex", name: "Alex" };

  test("a person shows as typing to others, not to themselves, and expires", () => {
    const thread = startThread({ identity: "benny@example.com" });
    setTyping(thread.id, alex, true, null, 1_000);
    expect(threadTyping(thread.id, "p-benny", 2_000)).toEqual([{ author: alex, replyTo: null }]);
    expect(threadTyping(thread.id, "p-alex", 2_000)).toEqual([]);
    expect(threadTyping(thread.id, "p-benny", 1_000 + 6_001)).toEqual([]);
  });

  test("sending a message ends its author's typing", () => {
    const thread = startThread({ identity: "benny@example.com" });
    const author = threadAuthor(thread.id, "alex@example.com", "Alex");
    setTyping(thread.id, author, true, "root-1");
    expect(threadTyping(thread.id)).toHaveLength(1);
    appendThreadMessage(thread.id, { author, text: "done", replyTo: "root-1" });
    expect(threadTyping(thread.id)).toEqual([]);
  });

  test("omg types in the replies while it answers, and stops when it posts", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    let seen: unknown = null;
    const d = deps({
      complete: async () => {
        seen = threadTyping(thread.id);
        return '{"action":"reply","text":"About $8."}';
      },
    });
    await answerMention(thread.id, "@omg price?", "benny@example.com", d, "root-1");
    expect(seen).toEqual([{ author: { kind: "omg" }, replyTo: "root-1" }]);
    expect(threadTyping(thread.id)).toEqual([]);
  });

  test("omg stops typing when the model call fails too", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    const d = deps({
      complete: async () => {
        throw new Error("down");
      },
      startTask: async () => {
        throw new Error("no agent");
      },
    });
    await answerMention(thread.id, "@omg fix it", "benny@example.com", d, "root-1");
    expect(threadTyping(thread.id)).toEqual([]);
  });
});

describe("typing, as clients draw it", () => {
  const alex = { author: { kind: "human" as const, participantId: "a", name: "Alex" }, replyTo: null };
  const sam = { author: { kind: "human" as const, participantId: "s", name: "Sam" }, replyTo: "root-1" };
  const omg = { author: { kind: "omg" as const }, replyTo: "root-1" };

  test("each view shows its own writers; the main list also shows omg", () => {
    expect(typingIn([alex, sam, omg], null)).toEqual([alex, omg]);
    expect(typingIn([alex, sam, omg], "root-1")).toEqual([sam, omg]);
  });

  test("the line names one or two, then says several", () => {
    expect(typingLabel([])).toBeNull();
    expect(typingLabel([omg])).toBe("omg is typing");
    expect(typingLabel([alex, sam])).toBe("Alex and Sam are typing");
    expect(typingLabel([alex, sam, omg])).toBe("Several people are typing");
  });

  test("the pinger sends on text, repeats slowly, and stops once", () => {
    const sent: boolean[] = [];
    let t = 0;
    const ping = typingPinger((on) => sent.push(on), () => t);
    ping("h");
    t = 1_000;
    ping("he");
    t = 3_500;
    ping("hel");
    ping("");
    ping("");
    expect(sent).toEqual([true, true, false]);
  });
});

describe("omg reads every reply in a reply thread it is part of", () => {
  const TASK = "a1b2c3d4-0000-4000-8000-0000000000aa";
  function setup() {
    const thread = startThread({ identity: "benny@example.com" });
    const benny = threadAuthor(thread.id, "benny@example.com", "Benny");
    const alex = threadAuthor(thread.id, "alex@example.com", "Alex");
    const ask = appendThreadMessage(thread.id, { author: benny, text: "@omg make the pricing page" });
    appendThreadMessage(thread.id, {
      author: { kind: "omg" },
      text: "Started a task.",
      replyTo: ask.id,
      task: { sessionId: TASK, event: "started", title: "Pricing page", project: null },
    });
    const plain = appendThreadMessage(thread.id, { author: alex, text: "Lunch?" });
    return { thread, benny, alex, ask, plain };
  }

  test("a reply wakes omg only where omg is part of the replies", () => {
    const { thread, alex, ask, plain } = setup();
    const inOmgReplies = appendThreadMessage(thread.id, { author: alex, text: "make it blue", replyTo: ask.id });
    const inPeopleReplies = appendThreadMessage(thread.id, { author: alex, text: "sure", replyTo: plain.id });
    const topLevel = appendThreadMessage(thread.id, { author: alex, text: "hello" });
    const all = readThreadMessages(thread.id);
    expect(omgWake(inOmgReplies, all)).toBe("reply");
    expect(omgWake(inPeopleReplies, all)).toBeNull();
    expect(omgWake(topLevel, all)).toBeNull();
    expect(omgWake({ ...topLevel, text: "@omg hi" }, all)).toBe("mention");
  });

  test("a follow-up goes to the running task, and omg says so", async () => {
    const { thread, ask } = setup();
    let system = "";
    const d = deps({
      complete: async (s) => {
        system = s;
        return '{"action":"tell_task","text":"Make the pricing page blue."}';
      },
    });
    const posted = await answerMention(thread.id, "make it blue", "alex@example.com", d, ask.id, true);
    expect(system).toContain("A task already runs in these replies");
    expect(system).toContain("Nobody mentioned you this time");
    expect(d.told).toEqual([{ sessionId: TASK, text: "Make the pricing page blue." }]);
    expect(d.started).toEqual([]);
    expect(posted).toMatchObject({ author: { kind: "omg" }, text: "Passed that to the task.", replyTo: ask.id });
  });

  test("unasked, omg can stay quiet, and an unreadable answer is silence, not a task", async () => {
    const { thread, ask } = setup();
    const before = readThreadMessages(thread.id).length;
    const quiet = deps({ complete: async () => '{"action":"none"}' });
    expect(await answerMention(thread.id, "thanks!", "alex@example.com", quiet, ask.id, true)).toBeNull();
    const garbled = deps({ complete: async () => "hmm" });
    expect(await answerMention(thread.id, "nice", "alex@example.com", garbled, ask.id, true)).toBeNull();
    expect(garbled.started).toEqual([]);
    expect(readThreadMessages(thread.id)).toHaveLength(before);
  });

  test("unasked, omg shows no typing while it decides", async () => {
    const { thread, ask } = setup();
    let seen: unknown = null;
    const d = deps({
      complete: async () => {
        seen = threadTyping(thread.id);
        return '{"action":"none"}';
      },
    });
    await answerMention(thread.id, "ok", "alex@example.com", d, ask.id, true);
    expect(seen).toEqual([]);
  });

  test("a task that cannot be reached says so", async () => {
    const { thread, ask } = setup();
    const d = deps({
      complete: async () => '{"action":"tell_task","text":"Blue."}',
      tellTask: async () => {
        throw new Error("session not found");
      },
    });
    const posted = await answerMention(thread.id, "@omg make it blue", "alex@example.com", d, ask.id);
    expect(posted!.text).toBe("I could not reach the task: session not found");
  });
});

describe("formatting and media, as in the session chat", () => {
  // A 1x1 PNG.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  test("an upload is kept as the thread's artifact; any other file is refused", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    mkdirSync(uploadsDir(), { recursive: true });
    const uploaded = join(uploadsDir(), `thread-test-${crypto.randomUUID()}.png`);
    writeFileSync(uploaded, PNG);
    try {
      const media = await keepThreadUpload(thread.id, uploaded, "logo.png");
      expect(media).toMatchObject({ kind: "image", name: "logo.png", width: 1, height: 1 });
      expect(media.path).toMatch(/^\/api\/artifacts\/[a-z0-9-]+$/);
    } finally {
      rmSync(uploaded, { force: true });
    }
    const outside = join(root, "secret.png");
    writeFileSync(outside, PNG);
    await expect(keepThreadUpload(thread.id, outside, "x.png")).rejects.toThrow("attachment is not an upload");
  });

  test("a task's result keeps its formatting and brings the pictures it showed", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    const sessionId = "a1b2c3d4-0000-4000-8000-0000000000bb";
    attachRuntimeSession({ conversationId: thread.id, sessionId, kind: "execution" });
    appendThreadMessage(thread.id, {
      author: { kind: "omg" },
      text: "Started a task.",
      task: { sessionId, event: "started", title: "Logo", project: null },
      replyTo: "root-1",
    });
    await Bun.sleep(2);
    const image = join(root, "logo.png");
    writeFileSync(image, PNG);
    const artifact = await createImageArtifact({ sessionId, path: image, caption: "Logo A" });
    const answer = "**Name options**\n\n1. **Vibe to Ship**\n2. **Just Vibe It**\n3. **Ship It**\n4. **Prompt to Product**";
    const posted = bridgeTaskCompletion(sessionId, { title: "Logo", last: { role: "assistant", text: answer } })!;
    expect(posted.text).toBe(answer);
    expect(posted.media).toEqual([
      expect.objectContaining({ kind: "image", path: `/api/artifacts/${artifact.id}`, caption: "Logo A" }),
    ]);
    // The next turn brings only what is new.
    const again = bridgeTaskCompletion(sessionId, { title: "Logo", last: { role: "assistant", text: "Done." } })!;
    expect(again.media).toBeUndefined();
  });

  test("a thread named by its first message is named in words, not markup", () => {
    const thread = startThread({ identity: "benny@example.com" });
    appendThreadMessage(thread.id, { author: threadAuthor(thread.id, "benny@example.com", "Benny"), text: "**Logo** ideas:\n\n- round" });
    expect(listThreads().find((row) => row.id === thread.id)?.title).toBe("Logo ideas: round");
  });

  test("previews and omg's reading drop the markup and name the media", () => {
    expect(plainText("**Name options**\n1. **Vibe to Ship** (`top`)")).toBe("Name options Vibe to Ship (top)");
    const photo = { kind: "image" as const, path: "/api/artifacts/a", name: "logo.png" };
    expect(threadPreview({ lastMessage: { author: { kind: "omg" }, text: "", ts: 1, media: [photo] } })).toBe("omg: Photo");
    expect(
      transcriptForModel([{ id: "m", threadId: "t", ts: 1, author: { kind: "human", participantId: "p", name: "Alex" }, text: "this one", media: [photo] }]),
    ).toBe("Alex: this one [image: logo.png]");
  });
});

describe("mentions are tags", () => {
  const people = [
    { id: "human:a", kind: "human" as const, display: { name: "Alex Chan", fallback: "A" } },
    { id: "human:b", kind: "human" as const, display: { name: "Alex", fallback: "A" } },
  ];

  test("@omg and @people become links to who they name; code and addresses stay as written", () => {
    expect(linkMentions("@omg can you", people)).toBe("[@omg](omg:mention/omg) can you");
    expect(linkMentions("hi @Alex Chan and @alex.", people)).toBe(
      "hi [@Alex Chan](omg:mention/human%3Aa) and [@alex](omg:mention/human%3Ab).",
    );
    expect(linkMentions("mail x@omg.dev", people)).toBe("mail x@omg.dev");
    expect(linkMentions("`@omg` stays code", people)).toBe("`@omg` stays code");
    expect(linkMentions("@omgx is nobody", people)).toBe("@omgx is nobody");
    expect(mentionFromHref("omg:mention/human%3Aa")).toBe("human:a");
    expect(mentionFromHref("https://example.com")).toBeNull();
  });
});

describe("@ a coding agent by name", () => {
  const agents = [
    { key: "aisdk", label: "claude" },
    { key: "codex-aisdk", label: "codex" },
    { key: "omg", label: "omg agent" },
    { key: "grok", label: "grok", visible: false },
  ];

  test("@ offers omg, the machine's shown agents once each, and the other people", () => {
    const people = [
      { id: "me", kind: "human" as const, display: { name: "Benny", fallback: "B" } },
      { id: "a", kind: "human" as const, display: { name: "Alex", fallback: "A" } },
    ];
    expect(threadMentionOptions(agents, people, "me").map((row) => `${row.kind}:${row.name}`)).toEqual([
      "omg:omg",
      "agent:claude",
      "agent:codex",
      "person:Alex",
    ]);
    const handles = mentionAgents(agents);
    expect(mentionedAgent("@omg and @codex, fix it", handles)).toEqual({ key: "codex-aisdk", handle: "codex" });
    expect(mentionedAgent("mail x@codex.dev", handles)).toBeNull();
    expect(linkMentions("@claude do it", [], handles.map((row) => row.handle))).toBe("[@claude](omg:mention/agent%3Aclaude) do it");
  });

  test("the named agent runs the task, even when omg would have answered", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    let system = "";
    const ran: (string | null | undefined)[] = [];
    const d = deps({
      complete: async (s) => {
        system = s;
        return '{"action":"reply","text":"About $8."}';
      },
      startTask: async ({ agent }) => {
        ran.push(agent);
        return "a1b2c3d4-0000-4000-8000-0000000000cc";
      },
    });
    const posted = await answerMention(thread.id, "@codex what does Linear charge?", "benny@example.com", d, "root-9", false, {
      key: "codex-aisdk",
      handle: "codex",
    });
    expect(system).toContain("They asked codex, a coding agent, by name");
    expect(ran).toEqual(["codex-aisdk"]);
    expect(posted).toMatchObject({ text: "Started a codex task.", task: { event: "started" }, replyTo: "root-9" });
  });
});

describe("what reaches the thread when a task finishes a turn", () => {
  // The rows of 2026-09-28 14:10, when the completion arrived before the answer was written.
  const turn = [
    { role: "assistant", kind: "text", text: "Earlier turn's answer." },
    { role: "user", kind: "text", text: "Explore philosophical names." },
    { role: "assistant", kind: "thinking", text: "(thinking)" },
    { role: "assistant", kind: "tool_use", text: "Bash: whois ..." },
    { role: "assistant", kind: "thinking", text: "(thinking)" },
  ];

  test("the turn's written answer, never its thinking, a tool call or the last turn's answer", () => {
    expect(turnAnswer(turn)).toBeNull();
    expect(turnAnswer([...turn, { role: "assistant", kind: "text", text: "Every one-word .com is taken." }])).toBe(
      "Every one-word .com is taken.",
    );
  });
});

describe("unasked, in a task's replies", () => {
  test("omg is told the replies are the work's conversation", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    const benny = threadAuthor(thread.id, "benny@example.com", "Benny");
    const ask = appendThreadMessage(thread.id, { author: benny, text: "@omg name the course" });
    appendThreadMessage(thread.id, {
      author: { kind: "omg" },
      text: "Started a task.",
      replyTo: ask.id,
      task: { sessionId: "a1b2c3d4-0000-4000-8000-0000000000dd", event: "started", title: "Names", project: null },
    });
    let system = "";
    const d = deps({
      complete: async (s) => {
        system = s;
        return '{"action":"tell_task","text":"Names that feel super."}';
      },
    });
    await answerMention(thread.id, "Like super", "benny@example.com", d, ask.id, true);
    expect(system).toContain("These replies are where a task is being worked on");
    expect(system).toContain("When unsure, pass it on");
    expect(d.told).toEqual([{ sessionId: "a1b2c3d4-0000-4000-8000-0000000000dd", text: "Names that feel super." }]);
  });
});

describe("omg and its tasks talk like teammates", () => {
  test("a thread's task starts inside the thread envelope, and a follow-up gets omg's own few words back", async () => {
    const thread = startThread({ identity: "benny@example.com", title: "Name and logo design" });
    const d = deps({ complete: async () => '{"action":"task","title":"Names","prompt":"Brainstorm names."}' });
    const started = await answerMention(thread.id, "@omg names please", "benny@example.com", d, "root-a");
    expect(d.started[0]).toStartWith("=== omg.dev THREAD TASK ===");
    expect(d.started[0]).toContain('a team chat thread called "Name and logo design"');

    const relay = deps({ complete: async () => '{"action":"tell_task","text":"Keep it shorter.","ack":"On it, shorter from here."}' });
    const posted = await answerMention(thread.id, "@omg shorter", "benny@example.com", relay, "root-a");
    expect(started?.task?.event).toBe("started");
    expect(posted?.text).toBe("On it, shorter from here.");
  });
});

describe("a thread can be referenced, and an agent can post to it", () => {
  test("the # reference names the thread by its full id, and the tools take any unambiguous prefix", () => {
    const a = startThread({ identity: "benny@example.com", title: "Superschool" });
    const token = formatSessionMentionToken(a.id, "Superschool", "thread");
    expect(token).toBe(`[#Superschool](omg:thread_${a.id})`);
    expect(threadRefFromHref(`omg:thread_${a.id}`)).toBe(a.id);
    expect(threadRefFromHref(`omg:session_${a.id.slice(0, 8)}`)).toBeNull();
    expect(resolveThreadRef(a.id.slice(0, 8))).toBe(a.id);
    expect(resolveThreadRef(`omg:thread_${a.id}`)).toBe(a.id);
    expect(resolveThreadRef("ffffffff")).toBeNull();
  });

  test("a file an agent shows is kept as its session's artifact", async () => {
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const image = join(root, "logo.png");
    writeFileSync(image, PNG);
    const media = await keepSessionFile("a1b2c3d4-0000-4000-8000-0000000000ee", image);
    expect(media).toMatchObject({ kind: "image", name: "logo.png", width: 1, height: 1 });
    expect(media.path).toMatch(/^\/api\/artifacts\//);
  });
});

describe("@ a person", () => {
  const roster = [
    { email: "benny@example.com", name: "Benny", avatar: "" },
    { email: "angel@example.com", name: "Angel", avatar: "/api/avatars/angel.png" },
    { email: "chris@example.com", name: "Chris", avatar: "" },
  ];

  test("@ offers everyone on the machine, members marked", () => {
    const thread = startThread({ identity: "benny@example.com" });
    appendThreadMessage(thread.id, { author: threadAuthor(thread.id, "angel@example.com", "Angel"), text: "hi" });
    const people = threadPeople(getConversation(thread.id)!, roster);
    expect(people.map((row) => `${row.name}:${row.member}`).sort()).toEqual(["Angel:true", "Benny:true", "Chris:false"]);
    expect(people.find((row) => row.name === "Angel")?.avatar).toBe("/api/avatars/angel.png");
  });

  test("naming someone adds them to the thread and tells them, even in replies they were not in", () => {
    const pushes: (string | null)[] = [];
    setThreadNotifier(({ user }) => pushes.push(user));
    try {
      const thread = startThread({ identity: "benny@example.com" });
      const benny = threadAuthor(thread.id, "benny@example.com", "Benny");
      const root = appendThreadMessage(thread.id, { author: benny, text: "the logo" });
      pushes.length = 0;
      // A reply thread only Benny is in: Chris would hear nothing without the mention.
      const added = addMentionedPeople(thread.id, "@Chris what do you think?", roster, "benny@example.com");
      appendThreadMessage(thread.id, { author: benny, text: "@Chris what do you think?", replyTo: root.id });
      expect(added).toHaveLength(1);
      expect(getConversation(thread.id)!.participants.some((row) => row.display.name === "Chris")).toBe(true);
      expect(pushes).toEqual(["chris@example.com"]);
      // Naming yourself adds nobody.
      expect(addMentionedPeople(thread.id, "@Benny note to self", roster, "benny@example.com")).toEqual([]);
    } finally {
      setThreadNotifier(null);
    }
  });
});

describe("omg wears the mark of the agent whose words it carries", () => {
  const omg = { kind: "omg" as const };
  const base = { threadId: "t", ts: 1, author: omg, replyTo: "r" };
  const started = { ...base, id: "s", text: "Started a codex task.", task: { sessionId: "sess-1", event: "started" as const } };
  const result = { ...base, id: "f", ts: 2, text: "Done.", task: { sessionId: "sess-1", event: "finished" as const, agent: "codex" } };
  const older = { ...base, id: "o", ts: 3, text: "Done again.", task: { sessionId: "sess-2", event: "finished" as const } };
  const posted = { ...base, id: "p", ts: 4, text: "Logo draft.", via: { sessionId: "sess-3", agent: "claude" } };

  test("a result is its task's agent, a post its session's; omg's own words are omg's", () => {
    expect(authorAgent(started)).toBeNull();
    expect(authorAgent(result)).toBe("codex");
    // A result from before the agent was remembered: the live task's.
    expect(authorAgent(older, [{ sessionId: "sess-2", title: null, project: null, busy: false, status: null, ended: false, agent: "aisdk" }])).toBe("aisdk");
    expect(authorAgent(posted)).toBe("claude");
    expect(authorAgent({ ...base, id: "h", text: "hi", author: { kind: "human", participantId: "p", name: "A" } })).toBeNull();
  });

  test("omg's note and the agent's answer are two groups, each with its own mark", () => {
    expect(startsMessageGroup(started, result)).toBe(true);
    expect(startsMessageGroup(result, { ...result, id: "f2", ts: 5 })).toBe(false);
  });
});
