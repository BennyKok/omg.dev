import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { MentionableSession } from "../lib/session-mention";

const { SessionMentionSuggest } = await import("./session-mention-suggest");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const base = {
  project: "lfg",
  lastUserText: null,
  lastActivityAt: 1,
  agent: "claude",
};
const rows: MentionableSession[] = [
  { ...base, sessionId: "a1", title: "Add picker", cwd: "/r/lfg", live: true, sameFolder: true },
  { ...base, sessionId: "b2", title: "", cwd: null, project: "", live: false, sameFolder: false },
];
const active = { start: 0, end: 1, query: "" };

describe("SessionMentionSuggest", () => {
  test("renders nothing when closed or empty", () => {
    ui.render(
      <SessionMentionSuggest active={null} matches={rows} selected={0} onHover={() => {}} onPick={() => {}} />,
    );
    expect(ui.query("[data-session-mention-suggest]")).toBeNull();
    ui.render(
      <SessionMentionSuggest active={active} matches={[]} selected={0} onHover={() => {}} onPick={() => {}} />,
    );
    expect(ui.query("[data-session-mention-suggest]")).toBeNull();
  });

  test("shows title, folder, and falls back to the short id", () => {
    ui.render(
      <SessionMentionSuggest active={active} matches={rows} selected={1} onHover={() => {}} onPick={() => {}} />,
    );
    const text = ui.text();
    expect(text).toContain("Add picker");
    expect(text).toContain("lfg");
    expect(text).toContain("b2");
    expect(ui.query('[data-session-mention-option="1"]')?.getAttribute("aria-selected")).toBe("true");
    expect(ui.query('[data-session-mention-option="0"]')?.getAttribute("aria-selected")).toBe("false");
  });

  test("clicking a row picks that session", () => {
    const picked: string[] = [];
    ui.render(
      <SessionMentionSuggest
        active={active}
        matches={rows}
        selected={0}
        onHover={() => {}}
        onPick={(s) => picked.push(s.sessionId)}
      />,
    );
    ui.flush(() => (ui.query('[data-session-mention-option="1"]') as HTMLButtonElement).click());
    expect(picked).toEqual(["b2"]);
  });
});
