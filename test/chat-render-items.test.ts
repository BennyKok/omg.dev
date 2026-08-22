import { describe, expect, test } from "bun:test";
import { buildChatRenderItems, toolGroupLabel } from "../web/src/lib/chat-render-items.ts";

describe("chat render items", () => {
  test("renders an LFG display result in place of its generic tool call", () => {
    const items = buildChatRenderItems([
      { id: "tool-1", kind: "tool_use", text: "mcp__lfg__lfg_display_image: {\"path\":\"/tmp/a.png\"}", ts: 10 },
      { id: "artifact-1", kind: "image", text: "Screenshot", ts: 11 },
      { id: "text-1", kind: "text", text: "Done", ts: 12 },
    ]);

    expect(items.map((item) => item.type)).toEqual(["artifact_tool", "msg"]);
    expect(items[0]).toMatchObject({
      type: "artifact_tool",
      tool: { id: "tool-1" },
      message: { id: "artifact-1" },
    });
  });

  test("keeps preceding tools while consuming only the matching display call", () => {
    const items = buildChatRenderItems([
      { id: "tool-1", kind: "tool_use", text: "Bash: pwd", ts: 10 },
      { id: "tool-2", kind: "tool_use", text: "lfg_display_video: {\"path\":\"/tmp/a.mp4\"}", ts: 11 },
      { id: "artifact-1", kind: "video", text: "Recording", ts: 12 },
    ]);

    expect(items.map((item) => item.type)).toEqual(["tools", "artifact_tool"]);
    expect(items[0]).toMatchObject({ type: "tools", items: [{ id: "tool-1" }] });
  });

  test("pairs HTML publishes and leaves unrelated media standalone", () => {
    const paired = buildChatRenderItems([
      { id: "tool-1", kind: "tool_use", text: "mcp__lfg__lfg_publish_artifact: {}", ts: 10 },
      { id: "artifact-1", kind: "html", text: "Dashboard", ts: 11 },
    ]);
    const standalone = buildChatRenderItems([
      { id: "tool-2", kind: "tool_use", text: "Bash: screenshot", ts: 10 },
      { id: "artifact-2", kind: "image", text: "Screenshot", ts: 11 },
    ]);

    expect(paired[0]?.type).toBe("artifact_tool");
    expect(standalone.map((item) => item.type)).toEqual(["tools", "msg"]);
  });

  // The tools were renamed lfg_* -> omg_*, but the matcher was not. Every new
  // session publishes under omg_*, so the pairing silently stopped happening
  // and artifacts rendered as a bare tool pill.
  test("pairs artifacts under both the omg_ and the pre-rename lfg_ tool names", () => {
    const cases = [
      ["omg_publish_artifact", "html"],
      ["mcp__omg__omg_publish_artifact", "html"],
      ["mcp__lfg__lfg_publish_artifact", "html"],
      ["omg_display_image", "image"],
      ["mcp__omg__omg_display_image", "image"],
      ["omg_display_video", "video"],
      ["mcp__omg__omg_display_video", "video"],
    ] as const;

    for (const [tool, kind] of cases) {
      const items = buildChatRenderItems([
        { id: "tool-1", kind: "tool_use", text: `${tool}: {}`, ts: 10 },
        { id: "artifact-1", kind, text: "Artifact", ts: 11 },
      ]);
      expect(items[0]?.type, tool).toBe("artifact_tool");
    }
  });
});

// A turn that used six tools rendered as twelve alternating rows — "Thought",
// "2 Bash", "Thought", "1 Bash" — because a thought between two calls broke
// the run into a separate pill each time.
describe("thinking folds into the run it happened in", () => {
  test("a thought between two calls joins their group", () => {
    const items = buildChatRenderItems([
      { id: "t1", kind: "tool_use", text: "Bash: ls", ts: 1 },
      { id: "th1", kind: "thinking", text: "now check the other one", ts: 2 },
      { id: "t2", kind: "tool_use", text: "Bash: pwd", ts: 3 },
      { id: "txt", kind: "text", text: "Done", ts: 4 },
    ]);
    expect(items.map((item) => item.type)).toEqual(["tools", "msg"]);
    expect(items[0]).toMatchObject({ items: [{ id: "t1" }, { id: "th1" }, { id: "t2" }] });
  });

  // It is the whole answer to "what is it doing" until the first tool appears.
  test("the thought that opens a run stays its own row", () => {
    const items = buildChatRenderItems([
      { id: "th1", kind: "thinking", text: "let me look", ts: 1 },
      { id: "t1", kind: "tool_use", text: "Bash: ls", ts: 2 },
      { id: "txt", kind: "text", text: "Done", ts: 3 },
    ]);
    expect(items.map((item) => item.type)).toEqual(["msg", "tools", "msg"]);
  });

  // The last message is the one still streaming. Folding it would trade a live
  // view of the reasoning for a pill you have to open.
  test("the trailing thought is never folded", () => {
    const items = buildChatRenderItems([
      { id: "t1", kind: "tool_use", text: "Bash: ls", ts: 1 },
      { id: "th1", kind: "thinking", text: "still working", ts: 2 },
    ]);
    expect(items.map((item) => item.type)).toEqual(["tools", "msg"]);
    expect(items[0]).toMatchObject({ items: [{ id: "t1" }] });
  });

  test("the label leads with the thinking, then the tools", () => {
    expect(
      toolGroupLabel([
        { kind: "tool_use", text: "Bash: ls" },
        { kind: "thinking", text: "hm" },
        { kind: "tool_use", text: "Bash: pwd" },
        { kind: "tool_use", text: "Read: a.ts" },
      ]),
    ).toBe("Thought · 2 Bash · 1 Read");
    expect(
      toolGroupLabel([
        { kind: "thinking", text: "a" },
        { kind: "tool_use", text: "Bash: ls" },
        { kind: "thinking", text: "b" },
      ]),
    ).toBe("2 thoughts · 1 Bash");
  });

  // Folding must not swallow the count of real results.
  test("results still count separately from thoughts", () => {
    expect(
      toolGroupLabel([
        { kind: "tool_use", text: "Bash: ls" },
        { kind: "tool_result", text: "ok" },
        { kind: "thinking", text: "hm" },
      ]),
    ).toBe("Thought · 1 Bash · 1 result");
  });
});
