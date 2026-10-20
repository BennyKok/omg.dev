import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { useEffect, useState } = await import("react");
const { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider, useSearch } = await import("@tanstack/react-router");
const { embeddedSessionPath, useHostSessionNavigation, usePendingSessionLink } = await import("./session-navigation");
const { validateAppSearch } = await import("./app-search");

let ui: Mounted;
afterEach(() => ui?.cleanup());

function setup(initial?: string) {
  const consumed: string[] = [];
  let mounts = 0;
  function Page() {
    const search = useSearch({ strict: false });
    const pending = usePendingSessionLink(search.session);
    const [revision, refresh] = useState(0);
    useEffect(() => { mounts++; }, []);
    useEffect(() => {
      if (!pending.current) return;
      consumed.push(pending.current);
      pending.current = null;
    }, [search.session, revision]);
    return <><textarea defaultValue="unsent draft" /><button onClick={() => refresh(x => x + 1)}>Refresh</button></>;
  }
  const root = createRootRoute({ component: Page });
  const index = createRoute({ getParentRoute: () => root, path: "/", validateSearch: validateAppSearch });
  const session = createRoute({ getParentRoute: () => root, path: "/sessions/$sid", validateSearch: validateAppSearch });
  const router = createRouter({ routeTree: root.addChildren([index, session]), history: createMemoryHistory({ initialEntries: [embeddedSessionPath(initial)] }) });
  function Surface({ id }: { id?: string | null }) {
    useHostSessionNavigation(router, id);
    return <RouterProvider router={router} />;
  }
  ui = mount();
  async function render(id?: string | null) {
    await ui.flushAsync(async () => { ui.render(<Surface id={id} />); });
    await ui.flushAsync();
  }
  return { router, consumed, render, mounts: () => mounts };
}

test("a host session request after mount is consumed without resetting the surface", async () => {
  const s = setup();
  await s.render();
  const draft = ui.query("textarea") as HTMLTextAreaElement;
  draft.value = "keep my work";
  await s.render("first");
  expect(s.consumed).toEqual(["first"]);
  await s.render("second");
  expect(s.consumed).toEqual(["first", "second"]);
  expect(ui.query("textarea")).toBe(draft);
  expect(draft.value).toBe("keep my work");
  expect(s.mounts()).toBe(1);
  expect(s.router.state.location.search.embed).toBe(true);
});

test("initial links resolve once and data refreshes do not reopen them", async () => {
  const s = setup("first");
  await s.render("first");
  ui.flush(() => (ui.query("button") as HTMLButtonElement).click());
  await s.render("first");
  expect(s.consumed).toEqual(["first"]);
});

test("home clears the old request and permits opening the same session again", async () => {
  const s = setup("first");
  await s.render("first");
  await s.render(null);
  expect(s.router.state.location.pathname).toBe("/");
  expect(s.router.state.location.search.session).toBeUndefined();
  ui.flush(() => (ui.query("button") as HTMLButtonElement).click());
  expect(s.consumed).toEqual(["first"]);
  await s.render("first");
  expect(s.consumed).toEqual(["first", "first"]);
});

test("host echoes do not interrupt internal navigation or add history entries", async () => {
  const s = setup();
  await s.render();
  await ui.flushAsync(async () => {
    await s.router.navigate({ to: "/sessions/$sid", params: { sid: "internal" }, search: { embed: true } });
  });
  const before = s.router.state.location.href;
  const length = s.router.history.length;
  await s.render("internal");
  expect(s.router.state.location.href).toBe(before);
  expect(s.router.history.length).toBe(length);
  expect(s.consumed).toEqual([]);
  await s.render("external");
  expect(s.consumed).toEqual(["external"]);
  expect(s.router.history.length).toBe(length);
});
