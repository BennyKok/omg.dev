// The archive's scheduled-run control, rendered rather than grepped.
//
// The point of the control is the round trip it drives: the sheet must open
// WITHOUT scheduled runs, and pressing it must re-ask the server with
// includeScheduled=1. Asserting on the component's source could not tell the
// difference between that and a button wired to nothing.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "../lib/omg-client";

const { default: ResumeSessionSheet } = await import("./resume-session-sheet");

let ui: Mounted;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  ui = mount();
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
  configureOmgTransport(createSameOriginTransport());
});

const session = (id: string, title: string) => ({
  sessionId: id,
  cwd: "/home/dev/repos/lfg",
  project: "lfg",
  title,
  lastActivityAt: 1_000,
  lastUserText: null,
  agent: "claude",
});

/** Serves the picker, recording every resumable URL it is asked for. */
function fakeServer(scheduledTotal = 2) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/sessions/resumable")) {
      urls.push(url);
      const withScheduled = url.includes("includeScheduled=1");
      const sessions = withScheduled
        ? [session("human", "fix onboarding"), session("watch", "You are an autonomous watch agent.")]
        : [session("human", "fix onboarding")];
      return Response.json({
        sessions,
        total: sessions.length,
        scheduledTotal,
        facets: { agents: [], projects: [] },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
  return urls;
}

function render() {
  ui.render(
    <ResumeSessionSheet
      initial={null}
      scopedProject="__all"
      onRestore={() => {}}
      onPick={() => {}}
      onClose={() => {}}
    />,
  );
}

// The sheet is a Drawer, which portals its content to document.body rather
// than into the harness host, so these read the document instead of sheetText()
// and ui.queryAll().
const sheetText = () => document.body.textContent ?? "";

/** The scheduled toggle, found by the state it exposes, not by class. */
function toggle(): HTMLButtonElement | null {
  return document.body.querySelector("button[aria-pressed]") as HTMLButtonElement | null;
}

describe("the archive's scheduled-run control", () => {
  test("opens hidden, and pressing it re-asks the server for the runs", async () => {
    const urls = fakeServer();
    render();
    await ui.flushAsync();

    // Opening the sheet must never ask for scheduled runs.
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain("includeScheduled");
    expect(sheetText()).toContain("fix onboarding");
    expect(sheetText()).not.toContain("You are an autonomous watch agent");

    const button = toggle();
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-pressed")).toBe("false");
    // The count is the whole reason the control is legible.
    expect(button!.textContent).toContain("2");

    await ui.flushAsync(() => {
      button!.click();
    });

    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("includeScheduled=1");
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(sheetText()).toContain("You are an autonomous watch agent");
  });

  test("pressing it again hides them, so the default is reachable", async () => {
    const urls = fakeServer();
    render();
    await ui.flushAsync();

    await ui.flushAsync(() => {
      toggle()!.click();
    });
    await ui.flushAsync(() => {
      toggle()!.click();
    });

    expect(urls).toHaveLength(3);
    expect(urls[2]).not.toContain("includeScheduled");
    expect(sheetText()).not.toContain("You are an autonomous watch agent");
  });

  test("no control at all when the box runs no schedules", async () => {
    fakeServer(0);
    render();
    await ui.flushAsync();

    // A toggle that reveals nothing is noise on an already crowded filter row.
    expect(toggle()).toBeNull();
  });
});
