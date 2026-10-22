import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { setSideNavOpen, useSideNavOpen } = await import("./side-nav-open");

let ui: Mounted;
beforeEach(() => {
  setSideNavOpen(false);
  ui = mount();
});
afterEach(() => ui.cleanup());

test("opening the drawer renders only its subscriber, not the shell around it", () => {
  let shellRenders = 0;
  let drawerRenders = 0;
  function Drawer() {
    drawerRenders += 1;
    return <span data-testid="drawer">{useSideNavOpen() ? "open" : "closed"}</span>;
  }
  function Shell() {
    shellRenders += 1;
    return <Drawer />;
  }
  ui.render(<Shell />);
  expect(ui.text()).toBe("closed");

  ui.flush(() => setSideNavOpen(true));
  expect(ui.text()).toBe("open");
  ui.flush(() => setSideNavOpen(true));
  ui.flush(() => setSideNavOpen(false));
  expect(ui.text()).toBe("closed");

  expect(shellRenders).toBe(1);
  // Mount, open, close. A repeated open is not a change.
  expect(drawerRenders).toBe(3);
});
