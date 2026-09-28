import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../../test-support/render";
import { registerSessionRefHandlers } from "../../lib/session-ref-link";

const { StreamdownResponse } = await import("./streamdown-response");

const FULL = "228efabd-1111-4222-8333-444455556666";
let ui: Mounted;
let opened: string[];

// Rendering loads Streamdown plugins lazily, which reads process.cwd(). In
// the full suite an earlier test can leave the process in a directory it has
// already deleted, so pin a directory that exists.
beforeAll(() => process.chdir(import.meta.dir));

beforeEach(() => {
  ui = mount();
  opened = [];
  registerSessionRefHandlers({
    navigate: (sessionId) => opened.push(sessionId),
    peekSessions: () => [{ sessionId: FULL, title: "Fix the attribution bug", agent: "codex", project: "lfg" }],
  });
});

afterEach(() => {
  registerSessionRefHandlers(null);
  ui.cleanup();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("session references in markdown", () => {
  test("a bare short id in inline code shows the title and opens that session", async () => {
    ui.render(<StreamdownResponse>{"Evidence is in session `228efabd`. Commit `02b282843`."}</StreamdownResponse>);
    await ui.flushAsync();
    const links = ui.queryAll("a[data-session-ref]");
    expect(links.map((a) => a.textContent)).toEqual(["Fix the attribution buglfg"]);
    expect(links[0].querySelector("img")?.getAttribute("alt")).toBe("Codex");
    expect(ui.text()).toContain("02b282843");
    (links[0] as HTMLElement).click();
    await settle();
    expect(opened).toEqual([FULL]);
  });

  test("a #session link opens in the app, not a new tab", async () => {
    ui.render(<StreamdownResponse>{"See [#Fix the attribution bug](omg:session_228efabd)."}</StreamdownResponse>);
    await ui.flushAsync();
    const link = ui.query("a[data-session-ref]") as HTMLAnchorElement | null;
    expect(link?.textContent).toBe("Fix the attribution buglfg");
    expect(link?.querySelector("img")?.getAttribute("alt")).toBe("Codex");
    expect(link?.getAttribute("target")).toBeNull();
    link!.click();
    await settle();
    expect(opened).toEqual([FULL]);
  });

  test("an id that names no known session stays the id", async () => {
    ui.render(<StreamdownResponse>{"See `deadbeef`."}</StreamdownResponse>);
    await ui.flushAsync();
    await settle();
    await ui.flushAsync();
    expect(ui.queryAll("a[data-session-ref]").map((a) => a.textContent)).toEqual(["deadbeef"]);
  });
});
