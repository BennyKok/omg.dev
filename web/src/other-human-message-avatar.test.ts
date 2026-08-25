// Message-level sender avatars for a shared persistent-bot conversation, and
// the header fix that goes with them.
//
// The feature: in a bot conversation shared by more than one human, another
// person's turn shows their avatar + name beside the bubble (a group chat
// inside a bot conversation). The viewer's own turns stay exactly as they
// were. The bot's own reply keeps its existing treatment. And — the bug this
// was actually filed to fix — the conversation HEADER never shows a human
// chip at all: it is the bot's identity and settings, full stop.
//
// App.tsx mounts the app on import in a browser context (see the note in
// message-copy-button-layout.test.ts), so — following that file's and
// mobile-copy-button.test.ts's precedent — this asserts against source text
// for the JSX wiring. Pure logic (own-vs-other resolution, participant
// lookup) has real behavioral coverage in lib/conversation-ui.test.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");
const APP = readFileSync(join(WEB, "src/App.tsx"), "utf8");
const CSS = readFileSync(join(WEB, "src/index.css"), "utf8");

function slice(start: string, end: string, from = 0): string {
  const s = APP.indexOf(start, from);
  expect(s, `could not find "${start}"`).toBeGreaterThanOrEqual(0);
  const e = APP.indexOf(end, s + start.length);
  expect(e, `could not find "${end}" after "${start}"`).toBeGreaterThan(s);
  return APP.slice(s, e);
}

describe("no human creator/owner chip in a persistent-bot conversation header", () => {
  test("the mobile full-screen bot chat header has no ConversationParticipantRow", () => {
    const header = slice(
      'aria-label="Back to bots"',
      "<BotConversationMenu",
      APP.indexOf("This chat is a full-screen portal above the app shell"),
    );
    expect(header).not.toContain("ConversationParticipantRow");
    expect(header).toContain("<BotAvatar");
  });

  test("the desktop/tablet bot chat header has no ConversationParticipantRow", () => {
    const header = slice(
      'aria-label="Back to bots"',
      "<BotConversationMenu",
      APP.indexOf("mx-auto flex h-[calc(100dvh-6rem)]"),
    );
    expect(header).not.toContain("ConversationParticipantRow");
    expect(header).toContain("<BotAvatar");
  });

  test("a bot-backed session card's header drops the participant row entirely", () => {
    // Every OTHER (non-bot) session card keeps ConversationParticipantRow —
    // this only gates it off specifically when the card is the authoritative
    // bot conversation surface (headerBot truthy), which is the exact case
    // the screenshot bug was filed against.
    expect(APP).toContain("{headerBot ? null : <ConversationParticipantRow session={session} compact={isMobile} />}");
  });

  test("the bot chat header keeps its identity + settings — an avatar and a menu, nothing human", () => {
    const mobileHeader = slice(
      'aria-label="Back to bots"',
      "</header>",
      APP.indexOf("This chat is a full-screen portal above the app shell"),
    );
    expect(mobileHeader).toContain("<BotAvatar");
    expect(mobileHeader).toContain("<BotConversationMenu");
  });
});

describe("MessageBubble routes a verified other-human author to its own component", () => {
  const bubble = APP.slice(APP.indexOf("function MessageBubble("), APP.indexOf("function botVisibleUserText("));

  test("computes otherHumanSender from the server-verified author, never from bot/creator/display data", () => {
    expect(bubble).toContain("isOtherHumanMessageAuthor(message.author, viewerParticipantId)");
    // Negative check: the branch must not reach for anything that names the
    // bot, its owner, or a client-suppliable display field as an identity
    // source — the spec's explicit "never infer" list.
    const otherHumanConst = bubble.slice(
      bubble.indexOf("const otherHumanSender ="),
      bubble.indexOf(": null;") + ": null;".length,
    );
    expect(otherHumanConst).not.toMatch(/bot\.owner|bot\.name|currentBot|displayName/);
  });

  test("renders OtherHumanMessageBubble before the viewer's own-turn branch, so it can't fall through", () => {
    const otherBranch = bubble.indexOf("if (otherHumanSender)");
    const ownBranch = bubble.indexOf('const isUser = message.role === "user";');
    expect(otherBranch).toBeGreaterThan(-1);
    expect(ownBranch).toBeGreaterThan(-1);
    expect(otherBranch).toBeLessThan(ownBranch);
  });

  test("an unresolved/legacy author falls through unchanged instead of guessing", () => {
    const comment = bubble.slice(bubble.indexOf("// A group-chat-style human turn"), bubble.indexOf("const otherHumanSender ="));
    expect(comment).toMatch(/falls through to the unchanged "own" rendering/);
  });
});

describe("the viewer's own messages stay visually unchanged", () => {
  const bubble = APP.slice(APP.indexOf("function MessageBubble("), APP.indexOf("function botVisibleUserText("));
  // Everything from the existing `isUser` branch onward, unmodified by this
  // feature: no avatar, no name label, no new wrapper around the own-turn
  // AiMessage.
  const ownBranch = bubble.slice(
    bubble.indexOf('const isUser = message.role === "user";'),
    bubble.indexOf("// A bot's turn reads as somebody talking"),
  );

  test("draws no avatar and no sender name on the viewer's own turn", () => {
    expect(ownBranch).not.toContain("HumanParticipantAvatar");
    expect(ownBranch).not.toContain("conversationParticipantDisplayName");
  });

  test("still renders from=\"user\" (right-aligned), same as before the feature", () => {
    expect(ownBranch).toContain('from="user"');
  });
});

describe("OtherHumanMessageBubble: avatar, accessible name, and bot-reply separation", () => {
  const component = APP.slice(APP.indexOf("function OtherHumanMessageBubble("), APP.indexOf("function botVisibleUserText("));

  test("is left-aligned like an assistant turn, never the bot's own bubble style", () => {
    expect(component).toContain('from="assistant"');
    // Must not reuse the bot bubble's card/border treatment — that stays the
    // bot's alone (spec: "Bot replies retain clear bot identity and existing
    // treatment").
    expect(component).not.toContain("rounded-[18px] border border-border bg-card");
  });

  test("carries an accessible sender name on every bubble, even when the visible caption is hidden", () => {
    expect(component).toContain("aria-label={`Message from ${name}`}");
    // Visible name is first-of-run only; the aria-label is unconditional.
    expect(component).toContain("firstOfRun ? (");
    expect(component).toContain("{name}");
  });

  test("draws the sender's avatar with an honest image-failure fallback", () => {
    expect(component).toContain("<HumanParticipantAvatar");
    const avatar = APP.slice(APP.indexOf("function HumanParticipantAvatar("), APP.indexOf("function OtherHumanMessageBubble("));
    // The initial-letter fallback renders underneath the <img>, and a failed
    // load removes the <img> rather than leaving a broken-image icon or a
    // blank circle.
    expect(avatar).toContain("onError={(event) => event.currentTarget.remove()}");
    expect(avatar).toMatch(/initial/);
  });

  test("reuses UserBubble (same copy/native-selection/clamp affordances) with a distinguishing tint, not the viewer's own tint", () => {
    expect(component).toContain("<UserBubble html={html} otherAuthor />");
  });

  test("passes isUser={false} to MessageActions so the copy button stays on the correct side", () => {
    expect(component).toContain('<MessageActions text={message.text || ""} isUser={false}>');
  });
});

describe("grouping: consecutive turns from different humans still get the speaker-changed gap", () => {
  const fn = APP.slice(APP.indexOf("function chatRenderItemSpeaker("), APP.indexOf("function chatRenderItemSpeaker(") + 900);

  test("splits the 'user' bucket by verified participant id", () => {
    expect(fn).toContain('author?.kind === "human" && author.verified ? `user:${author.participantId}` : "user"');
  });

  test("every non-user-authored row still collapses to one 'assistant' bucket", () => {
    expect(fn).toContain('if (item.type !== "msg" || item.message.role !== "user") return "assistant";');
  });
});

describe("grouping: consecutive other-human beats hide repeated name+face", () => {
  // The transcript is virtualized, so the loop walks the virtual window
  // rather than `items` directly. The run-edge derivation inside it is
  // unchanged, which is what this block is about.
  const loop = APP.slice(
    APP.indexOf("{virtualRows.map((virtualRow) =>"),
    APP.indexOf("<TypingIndicator"),
  );
  const bubble = APP.slice(APP.indexOf("function MessageBubble("), APP.indexOf("function botVisibleUserText("));
  const component = APP.slice(APP.indexOf("function OtherHumanMessageBubble("), APP.indexOf("function botVisibleUserText("));

  test("ChatStream derives run edges from chatRenderItemSpeaker, then speakerRunEdges", () => {
    expect(APP).toContain("const speakers = useMemo(() => items.map(chatRenderItemSpeaker), [items]);");
    expect(loop).toContain("const { firstOfRun, lastOfRun } = speakerRunEdges(speakers, index);");
    expect(loop).toContain("const speakerChanged = index > 0 && firstOfRun;");
    expect(loop).toContain('cn("pb-2", speakerChanged && "pt-2.5")');
    expect(loop).toContain("firstOfRun={firstOfRun}");
    expect(loop).toContain("lastOfRun={lastOfRun}");
    expect(loop).not.toMatch(/bot\.owner|currentBot|displayName/);
  });

  test("MessageBubble forwards the edges only to OtherHumanMessageBubble", () => {
    const otherBranch = bubble.slice(
      bubble.indexOf("if (otherHumanSender)"),
      bubble.indexOf('const isUser = message.role === "user";'),
    );
    expect(otherBranch).toContain("firstOfRun={firstOfRun}");
    expect(otherBranch).toContain("lastOfRun={lastOfRun}");
    const ownBranch = bubble.slice(
      bubble.indexOf('const isUser = message.role === "user";'),
      bubble.indexOf("// A bot's turn reads as somebody talking"),
    );
    expect(ownBranch).not.toContain("firstOfRun");
    expect(ownBranch).not.toContain("lastOfRun");
    expect(ownBranch).not.toContain("HumanParticipantAvatar");
  });

  test("name is first-of-run only; avatar is last-of-run only; a spacer keeps the column", () => {
    expect(component).toContain("firstOfRun = true");
    expect(component).toContain("lastOfRun = true");
    expect(component).toContain("firstOfRun ? (");
    expect(component).toContain("lastOfRun ? (");
    expect(component).toContain("<HumanParticipantAvatar");
    expect(component).toContain('className="mb-0.5 size-[22px] shrink-0"');
    expect(component).toContain("items-end");
  });

  test("queued rows omit the edges so the defaults still show both name and face", () => {
    const queued = APP.slice(APP.indexOf("{queuedItems.map"), APP.indexOf("</ConversationContent>"));
    expect(queued).toContain("<MessageBubble");
    expect(queued).not.toContain("firstOfRun");
    expect(queued).not.toContain("lastOfRun");
  });
});

describe("no horizontal overflow at 390px: the other-human bubble reuses the existing width caps", () => {
  test("MessageActions already caps non-user content at 92%-of-row minus the copy-button gutter — reused as-is", () => {
    const actions = slice("function MessageActions(", '<div ref={contentRef}');
    expect(actions).toContain("max-w-[min(92%,calc(100%-2.25rem))]");
  });

  test("the avatar + name column subtracts its own width before handing off to MessageActions' cap", () => {
    const component = APP.slice(APP.indexOf("function OtherHumanMessageBubble("), APP.indexOf("function botVisibleUserText("));
    expect(component).toContain("max-w-[calc(100%-1.75rem)]");
    expect(component).toContain("min-w-0");
  });
});

describe("CSS: the other-human bubble is visually distinct from the viewer's own bubble", () => {
  test("is-other overrides the fill in both light and dark mode", () => {
    expect(CSS).toContain(".user-bubble.markdown.is-other {");
    expect(CSS).toContain(".dark .user-bubble.markdown.is-other {");
  });

  test("does not touch the base .user-bubble rule the viewer's own turns still use", () => {
    const base = CSS.slice(CSS.indexOf(".user-bubble.markdown {"), CSS.indexOf(".dark .user-bubble.markdown {"));
    expect(base).not.toContain("is-other");
  });
});
