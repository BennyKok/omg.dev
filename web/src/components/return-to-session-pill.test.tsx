import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { act } from "react";
import { classifySystemMessage } from "../lib/system-message";
import { registerSessionRefHandlers } from "../lib/session-ref-link";
import { clearJump } from "../lib/session-return";

const { SystemMessageLine } = await import("./system-message-line");
const { ReturnToSessionPill } = await import("./return-to-session-pill");

const PARENT = "aaaa1111-0000-0000-0000-000000000000";
const CHILD = "6171998d-1111-2222-3333-444444444444";

let ui: Mounted;
let opened: string[];
beforeEach(() => {
  ui = mount();
  opened = [];
  window.history.replaceState(null, "", `/sessions/${PARENT}`);
  registerSessionRefHandlers({
    navigate: (id) => opened.push(id),
    peekSessions: () => [
      { sessionId: PARENT, title: "Getsubtract site" },
      { sessionId: CHILD, title: "Redesign the landing site" },
    ],
  });
});
afterEach(() => {
  ui.cleanup();
  clearJump();
  registerSessionRefHandlers(null);
});

const RAW =
  "[Background task i wanted to redesing the landing site. new branding · 6171998d]\n\n" +
  "## Done\n\n- Re-rendered the **app screenshots**";

describe("linked session card", () => {
  test("is one pill with the name, the id and a one-line preview", () => {
    ui.render(<SystemMessageLine system={classifySystemMessage(RAW)!} raw={RAW} />);
    expect(ui.query('[data-slot="linked-session-card"]')).not.toBeNull();
    expect(ui.query('button[aria-label^="Open the session that reported, 6171998d"]')).not.toBeNull();
    expect(ui.text()).toContain("6171998d");
    expect(ui.text()).toContain("i wanted to redesing the landing site. new branding");
    expect(ui.text()).not.toContain("reported in");
    expect(ui.text()).toContain("Done Re-rendered the app screenshots");
    expect(ui.text()).not.toContain("**");
  });

  test("opening the linked session offers the way back, and back returns", async () => {
    ui.render(
      <>
        <SystemMessageLine system={classifySystemMessage(RAW)!} raw={RAW} />
        <ReturnToSessionPill sid={CHILD} />
      </>,
    );
    expect(ui.query('[data-slot="return-to-session"]')).toBeNull();
    const open = ui.query('button[aria-label^="Open the session that reported"]') as HTMLButtonElement;
    await act(async () => {
      open.click();
    });
    await ui.flushAsync();
    expect(opened).toEqual([CHILD]);
    const back = ui.query('button[aria-label^="Back to"]') as HTMLButtonElement;
    expect(back).not.toBeNull();
    expect(ui.text()).toContain("Getsubtract site");
    await act(async () => {
      back.click();
    });
    expect(opened).toEqual([CHILD, PARENT]);
    expect(ui.query('[data-slot="return-to-session"]')).toBeNull();
  });

  test("the pill does not show on an unrelated session", async () => {
    ui.render(
      <>
        <SystemMessageLine system={classifySystemMessage(RAW)!} raw={RAW} />
        <ReturnToSessionPill sid="ffffffff-0000-0000-0000-000000000000" />
      </>,
    );
    const open = ui.query('button[aria-label^="Open the session that reported"]') as HTMLButtonElement;
    await act(async () => {
      open.click();
    });
    await ui.flushAsync();
    expect(ui.query('[data-slot="return-to-session"]')).toBeNull();
  });

  test("shows the linked session's agent logo when known", () => {
    const codex = "c0dec0de-1111-2222-3333-444444444444";
    registerSessionRefHandlers({
      navigate: () => {},
      peekSessions: () => [{ sessionId: codex, title: "Chat polish", agent: "codex" }],
    });
    const raw = "[Background task Chat polish · c0dec0de]\n\n[subagent progress] Started on chat.";
    ui.render(<SystemMessageLine system={classifySystemMessage(raw)!} raw={raw} />);
    const logo = ui.query('[data-slot="linked-session-card"] img') as HTMLImageElement;
    expect(logo?.getAttribute("alt")).toBe("Codex");
    expect(ui.text()).toContain("Started on chat.");
    expect(ui.text()).not.toContain("[subagent progress]");
  });
});
