import { describe, expect, test } from "bun:test";
import { mergeHistoryPage, type OmgChatMessage } from "./omg-chat-transport";

// Regression test for the bot-chat duplicate-bubble bug: a message rendering
// TWICE, back to back, with identical text.
//
// Root cause (see mergeHistoryPage's own doc comment): useChat's state is
// keyed by session id and survives navigating away and back to the same
// session (e.g. reopening a bot's conversation). If a turn was still
// streaming when the app lost focus — an iPad backgrounding Safari mid-turn
// is the concrete case Benny hit — the live subscription event that would
// normally clear the local streaming-draft bubble never arrives before the
// session's history effect re-fetches `/api/sessions/:sid/messages`. That
// fetch comes back with the SAME turn already finalized under its own real
// id, and the old merge logic had no rule dropping the stale draft, so both
// rendered: the finalized bubble and the untouched streaming duplicate.

function streamingDraft(sid: string, text: string, ts: number): OmgChatMessage {
  return {
    id: `draft-${sid}`,
    role: "assistant",
    metadata: {
      omgMessage: { id: `draft-${sid}`, role: "assistant", kind: "text", text, ts },
    },
    parts: [{ type: "text", text, state: "streaming" }],
  };
}

function finalAssistantText(id: string, text: string, ts: number): OmgChatMessage {
  return {
    id,
    role: "assistant",
    metadata: { omgMessage: { id, role: "assistant", kind: "text", text, ts } },
    parts: [{ type: "text", text, state: "done" }],
  };
}

function userText(id: string, text: string, ts: number): OmgChatMessage {
  return {
    id,
    role: "user",
    metadata: { omgMessage: { id, role: "user", kind: "text", text, ts } },
    parts: [{ type: "text", text, state: "done" }],
  };
}

describe("mergeHistoryPage", () => {
  test("drops a stale streaming draft once the fetched history already has it finalized", () => {
    const TEXT = "Screenshot worked quickly this time, so the Mac/SSH is responsive. Let's pull it down and look.";
    const sid = "bot-session-1";
    const current: OmgChatMessage[] = [
      userText("row-1", "Waiting.", 1000),
      streamingDraft(sid, TEXT, 2000),
    ];
    const history: OmgChatMessage[] = [
      userText("row-1", "Waiting.", 1000),
      finalAssistantText("row-2", TEXT, 2050),
    ];

    const merged = mergeHistoryPage(current, history, [], new Set());

    const copies = merged.filter((message) => message.role === "assistant" && message.id !== `draft-${sid}`);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.parts.find((part) => part.type === "text")?.text).toBe(TEXT);
    // The stale draft bubble must not survive alongside the finalized row.
    expect(merged.some((message) => message.id === `draft-${sid}`)).toBe(false);
    expect(merged.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  test("a live-landed, already-finalized message during the fetch's flight still appears once", () => {
    const history: OmgChatMessage[] = [userText("row-1", "hello", 1000)];
    const liveArrived = finalAssistantText("row-2", "hi there", 1500);
    const current: OmgChatMessage[] = [userText("row-1", "hello", 1000), liveArrived];

    const merged = mergeHistoryPage(current, history, [], new Set());

    expect(merged.filter((message) => message.id === "row-2")).toHaveLength(1);
    expect(merged.map((message) => message.id)).toEqual(["row-1", "row-2"]);
  });

  test("older paged-in history is preserved ahead of the fresh page", () => {
    const older = [userText("row-0", "older turn", 500)];
    const history: OmgChatMessage[] = [userText("row-1", "hello", 1000)];
    const current: OmgChatMessage[] = [...older, ...history];

    const merged = mergeHistoryPage(current, history, older, new Set());

    expect(merged.map((message) => message.id)).toEqual(["row-0", "row-1"]);
  });
});
