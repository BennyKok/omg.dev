import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import type { Session } from "./App";

const { CompactSessionRow, ViewPrefsContext } = await import("./App");
const { SessionReparentProvider } = await import("./components/session-reparent");
const { DEFAULT_VIEW_PREFS } = await import("./lib/global-settings");

let ui: Mounted;
beforeEach(() => { ui = mount(); });
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
  // Every row keeps the slot, so titles line up.
  expect(slots).toHaveLength(2);
  expect(slots[0].querySelector("img")?.getAttribute("src")).toContain("lfg");
  // A chat with no project has no logo to show.
  expect(slots[1].querySelector("img")).toBeNull();
});

test("the compact row has no favicon and no empty slot when the switch is off", () => {
  draw(false);
  expect(ui.queryAll("[data-session-favicon]")).toHaveLength(0);
  expect(ui.queryAll("img")).toHaveLength(0);
});

test("a favicon that fails to load leaves the slot empty, not a broken image", () => {
  draw(true);
  const img = ui.query("[data-session-favicon] img") as HTMLImageElement;
  ui.flush(() => img.dispatchEvent(new window.Event("error")));
  expect(ui.queryAll("[data-session-favicon]")).toHaveLength(2);
  expect(ui.query("[data-session-favicon] img")).toBeNull();
});
