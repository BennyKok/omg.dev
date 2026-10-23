import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { createSideNavOpenStore, useSideNavOpen } = await import("./side-nav-open");
type Store = ReturnType<typeof createSideNavOpenStore>;

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

function Drawer({ store, id, onRender }: { store: Store; id?: string; onRender?: () => void }) {
  onRender?.();
  return <span data-testid={id ?? "drawer"}>{useSideNavOpen(store) ? "open" : "closed"}</span>;
}

test("opening the drawer renders only its subscriber, not the shell around it", () => {
  const store = createSideNavOpenStore();
  let shellRenders = 0;
  let drawerRenders = 0;
  function Shell() {
    shellRenders += 1;
    return <Drawer store={store} onRender={() => (drawerRenders += 1)} />;
  }
  ui.render(<Shell />);
  expect(ui.text()).toBe("closed");

  ui.flush(() => store.set(true));
  expect(ui.text()).toBe("open");
  ui.flush(() => store.set(true));
  ui.flush(() => store.set(false));
  expect(ui.text()).toBe("closed");

  expect(shellRenders).toBe(1);
  // Mount, open, close. A repeated open is not a change.
  expect(drawerRenders).toBe(3);
});

// omg.dev mounts the Computer surface and a kept-alive Settings surface from
// this bundle in one page. Both render a phone drawer. Opening the Computer's
// menu must not also open the hidden Settings surface's drawer, which lacks the
// host's rows and lands on top of the real one.
test("two surfaces in one page open their drawers independently", () => {
  const computer = createSideNavOpenStore();
  const settings = createSideNavOpenStore();
  ui.render(
    <>
      <Drawer store={computer} id="computer" />|<Drawer store={settings} id="settings" />
    </>,
  );

  ui.flush(() => computer.set(true));
  expect(ui.text()).toBe("open|closed");
  ui.flush(() => settings.set(true));
  ui.flush(() => computer.set(false));
  expect(ui.text()).toBe("closed|open");
});
