import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import type { Session } from "./App";

const { CompactSessionRow, ViewPrefsContext } = await import("./App");
const { SessionReparentProvider } = await import("./components/session-reparent");
const { DEFAULT_VIEW_PREFS } = await import("./lib/global-settings");

const { resetProjectFaviconRecords } = await import("./lib/session-ui");

let ui: Mounted;
beforeEach(() => {
  resetProjectFaviconRecords();
  ui = mount();
});
afterEach(() => ui.cleanup());

const inProject: Session = { sessionId: "one", title: "In a project", managed: true, tmuxName: "one", project: "lfg" };
const noProject: Session = { sessionId: "two", title: "No project", managed: true, tmuxName: "two" };

function draw(showSidebarFavicons: boolean) {
  ui.render(
    <ViewPrefsContext.Provider value={{ ...DEFAULT_VIEW_PREFS, showSidebarFavicons }}>
      <SessionReparentProvider sessions={[inProject, noProject]} onRefresh={async () => {}}>
        {[inProject, noProject].map((session) => (
          <CompactSessionRow key={session.sessionId} session={session} users={[]} userFilter="__all" busy={false} onOpen={() => {}} />
        ))}
      </SessionReparentProvider>
    </ViewPrefsContext.Provider>,
  );
}

test("the compact row shows the project favicon when the View switch is on", () => {
  draw(true);
  const slots = ui.queryAll("[data-session-favicon]");
  // Only the row with a project gets a slot. A chat with no project has no
  // logo, and an empty slot was a gap before its title.
  expect(slots).toHaveLength(1);
  expect(slots[0].querySelector("img")?.getAttribute("src")).toContain("lfg");
});

test("the compact row has no favicon and no empty slot when the switch is off", () => {
  draw(false);
  expect(ui.queryAll("[data-session-favicon]")).toHaveLength(0);
  expect(ui.queryAll("img")).toHaveLength(0);
});

test("a favicon that fails to load drops the slot, not a broken image or a gap", () => {
  draw(true);
  const img = ui.query("[data-session-favicon] img") as HTMLImageElement;
  ui.flush(() => img.dispatchEvent(new window.Event("error")));
  expect(ui.queryAll("[data-session-favicon]")).toHaveLength(0);
  expect(ui.query("img")).toBeNull();
});
