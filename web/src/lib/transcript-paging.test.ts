import { describe, expect, test } from "bun:test";
import { countTranscriptRows, type ChatRenderMessage } from "./chat-render-items";
import {
  DEFER_TOOL_ARGS_PARAM,
  LIVE_WINDOW_MAX_MESSAGES,
  LIVE_WINDOW_ROWS,
  loadOlderIntent,
  toolArgsPath,
  transcriptOlderPagePath,
  transcriptPagePath,
  windowLiveMessages,
  TRANSCRIPT_PAGE_ROWS,
} from "./transcript-paging";

type Message = ChatRenderMessage & { role?: string };

function toolHeavyBacklog(turns: number): Message[] {
  const messages: Message[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    messages.push({ id: `u-${turn}`, role: "user", kind: "text", text: `ask ${turn}`, ts: turn });
    for (let step = 0; step < 20; step += 1) {
      messages.push({
        id: `tool-${turn}-${step}`,
        role: "assistant",
        kind: "tool_use",
        text: `Bash: step ${step}`,
        ts: turn,
      });
    }
    messages.push({ id: `a-${turn}`, role: "assistant", kind: "text", text: `answer ${turn}`, ts: turn });
  }
  return messages;
}

// The reducer shape the ai_part and optimistic-send paths use in App.tsx and
// useLiveSocket.ts: drop the thinking bubble and the previous draft, append the
// new draft, then apply the window.
function applyDraftDelta(current: Message[], draft: Message): Message[] {
  return windowLiveMessages([
    ...current.filter((item) => item.kind !== "thinking" && item.id !== draft.id),
    draft,
  ]);
}

describe("the transcript page request", () => {
  test("asks for rows, not only raw messages", () => {
    expect(transcriptPagePath("abc")).toContain(`rows=${TRANSCRIPT_PAGE_ROWS}`);
    expect(transcriptOlderPagePath("abc", 512)).toContain(`rows=${TRANSCRIPT_PAGE_ROWS}`);
    expect(transcriptOlderPagePath("abc", 512)).toContain("page=backward&before=512");
  });

  test("declares the deferToolArgs capability on both pages", () => {
    // Opt in, per request. The server sends the old payload without it, which
    // is what keeps a pinned older bundle working.
    expect(transcriptPagePath("abc")).toContain(DEFER_TOOL_ARGS_PARAM);
    expect(transcriptOlderPagePath("abc", 512)).toContain(DEFER_TOOL_ARGS_PARAM);
  });

  test("the capability is a query parameter, not a setting", () => {
    expect(DEFER_TOOL_ARGS_PARAM).toBe("deferToolArgs=1");
  });

  test("the arguments of one call have a session-scoped path", () => {
    expect(toolArgsPath("abc", "u1")).toBe("/api/sessions/abc/messages/u1/tool-args");
  });

  test("both parts of the arguments path are encoded", () => {
    expect(toolArgsPath("a/b", "u 1")).toBe("/api/sessions/a%2Fb/messages/u%201/tool-args");
  });
});

describe("the live message window", () => {
  test("a draft delta does not truncate a paged-back backlog", () => {
    // 10 turns is 220 messages and 30 rows: far past the old 80-message cap,
    // and well inside the row window, which is the point.
    const backlog = toolHeavyBacklog(10);
    expect(backlog).toHaveLength(220);
    expect(countTranscriptRows(backlog)).toBeLessThan(LIVE_WINDOW_ROWS);

    let messages = backlog;
    for (let tick = 0; tick < 5; tick += 1) {
      messages = applyDraftDelta(messages, {
        id: "draft-1",
        role: "assistant",
        kind: "text",
        text: "streaming".repeat(tick + 1),
        ts: 999,
      });
    }
    expect(messages).toHaveLength(221);
    expect(messages[0]!.id).toBe("u-0");
    // Every paged-back message survived, in order.
    expect(messages.slice(0, backlog.length).map((message) => message.id)).toEqual(
      backlog.map((message) => message.id),
    );
  });

  test("an optimistic send does not truncate a paged-back backlog", () => {
    const backlog = toolHeavyBacklog(10);
    const next = windowLiveMessages([
      ...backlog.filter((item) => item.kind !== "thinking"),
      { id: "optimistic-1", role: "user", kind: "text", text: "next please", ts: 1000 },
    ]);
    expect(next).toHaveLength(221);
    expect(next[0]!.id).toBe("u-0");
  });

  test("a short transcript is never touched", () => {
    const messages = toolHeavyBacklog(2);
    expect(windowLiveMessages(messages)).toBe(messages);
  });

  test("the window still bounds a transcript that grows past it", () => {
    const messages: Message[] = Array.from({ length: LIVE_WINDOW_ROWS + 50 }, (_, index) => ({
      id: `t-${index}`,
      role: "assistant",
      kind: "text",
      text: `line ${index}`,
      ts: index,
    }));
    const next = windowLiveMessages(messages);
    expect(countTranscriptRows(next)).toBe(LIVE_WINDOW_ROWS);
    // It keeps the newest end.
    expect(next[next.length - 1]!.id).toBe(`t-${messages.length - 1}`);
  });

  test("the message ceiling bounds a transcript of unbounded tool runs", () => {
    const messages: Message[] = Array.from({ length: LIVE_WINDOW_MAX_MESSAGES + 500 }, (_, index) => ({
      id: `tool-${index}`,
      role: "assistant",
      kind: "tool_use",
      text: "Bash: run",
      ts: index,
    }));
    expect(windowLiveMessages(messages)).toHaveLength(LIVE_WINDOW_MAX_MESSAGES);
  });
});

describe("the load-older guard", () => {
  test("an overflowing transcript loads only from the top", () => {
    expect(loadOlderIntent({ scrollTop: 0, scrollHeight: 4000, clientHeight: 800 })).toBe("anchored");
    expect(loadOlderIntent({ scrollTop: 79, scrollHeight: 4000, clientHeight: 800 })).toBe("anchored");
    expect(loadOlderIntent({ scrollTop: 400, scrollHeight: 4000, clientHeight: 800 })).toBe("none");
  });

  test("a transcript that does not fill the viewport backfills", () => {
    // The reported case: 4234 messages that fold into a handful of rows. The
    // old guard returned early here, so the history was unreachable.
    expect(loadOlderIntent({ scrollTop: 0, scrollHeight: 300, clientHeight: 800 })).toBe("backfill");
    // Exactly at the slack, it still counts as not overflowing.
    expect(loadOlderIntent({ scrollTop: 0, scrollHeight: 880, clientHeight: 800 })).toBe("backfill");
    expect(loadOlderIntent({ scrollTop: 0, scrollHeight: 881, clientHeight: 800 })).toBe("anchored");
  });

  test("a collapsed or unmeasured transcript asks for nothing", () => {
    // A bot board mounts several transcripts. One that is not laid out
    // measures zero and would otherwise look underfilled forever.
    expect(loadOlderIntent({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe("none");
    expect(loadOlderIntent({ scrollTop: 0, scrollHeight: 4000, clientHeight: 0 })).toBe("none");
  });
});
