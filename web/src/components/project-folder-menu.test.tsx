import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { ProjectFolderMenu } = await import("./project-folder-menu");
const { arrangeFolders, getFolderMenuPrefs, setFolderMenuHidden, setFolderMenuOrder } = await import(
  "../lib/folder-menu-prefs"
);
const { NO_PROJECT_FILTER } = await import("../lib/project-filter");

let ui: Mounted;
beforeEach(() => {
  setFolderMenuOrder([]);
  for (const key of getFolderMenuPrefs().hidden) setFolderMenuHidden(key, false);
  ui = mount();
});
afterEach(() => ui.cleanup());

const projects = [NO_PROJECT_FILTER, "alpha", "beta", "gamma"];
const labelFor = (value: string) => (value === NO_PROJECT_FILTER ? "No project" : value);
// The global document, not the harness module's window: another file in the
// same run may have installed its own, and the popover portals into this one.
const body = () => document.body;
const byLabel = (label: string) =>
  body().querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const menuRows = () =>
  Array.from(body().querySelectorAll('[data-testid="project-folder-menu"] button[aria-pressed]')).map(
    (row) => row.textContent,
  );

test("arrangeFolders keeps saved order, appends new folders, drops gone ones", () => {
  expect(
    arrangeFolders(["a", "b", "c", "d"], { order: ["c", "gone", "a"], hidden: ["b"] }),
  ).toEqual([
    { value: "c", hidden: false },
    { value: "a", hidden: false },
    { value: "b", hidden: true },
    { value: "d", hidden: false },
  ]);
});

test("picks a folder from the dropdown", async () => {
  const picked: string[] = [];
  ui.render(<ProjectFolderMenu value="alpha" projects={projects} labelFor={labelFor} onChange={(v) => picked.push(v)} />);
  expect(byLabel("Folder: alpha")).not.toBeNull();
  ui.flush(() => byLabel("Folder: alpha")!.click());
  await ui.flushAsync();
  expect(menuRows()).toEqual(["No project", "alpha", "beta", "gamma"]);
  ui.flush(() => (body().querySelector('button[title="beta"][aria-pressed]') as HTMLButtonElement).click());
  expect(picked).toEqual(["beta"]);
});

test("manage hides a folder from the menu and removes one from the list", async () => {
  const removed: string[] = [];
  ui.render(
    <ProjectFolderMenu
      value="alpha"
      projects={projects}
      labelFor={labelFor}
      onChange={() => {}}
      canRemove={(project) => project !== "gamma"}
      onRemove={async (project) => {
        removed.push(project);
      }}
    />,
  );
  ui.flush(() => byLabel("Folder: alpha")!.click());
  await ui.flushAsync();
  const manage = Array.from(body().querySelectorAll("button")).find((b) => b.textContent?.includes("Manage folders"))!;
  ui.flush(() => manage.click());
  ui.flush(() => byLabel("Hide beta from the menu")!.click());
  expect(getFolderMenuPrefs().hidden).toEqual(["beta"]);
  // A session-only folder has no list entry to remove.
  expect(byLabel("Remove gamma from the folder list")).toBeNull();
  ui.flush(() => byLabel("Remove alpha from the folder list")!.click());
  await ui.flushAsync();
  expect(removed).toEqual(["alpha"]);
  ui.flush(() => byLabel("Back to folders")!.click());
  // Hidden folders leave the menu. The current one stays so it keeps its tick.
  expect(menuRows()).toEqual(["No project", "alpha", "gamma"]);
});

test("the reorder handle moves a folder with the arrow keys", async () => {
  ui.render(<ProjectFolderMenu value="alpha" projects={projects} labelFor={labelFor} onChange={() => {}} />);
  ui.flush(() => byLabel("Folder: alpha")!.click());
  await ui.flushAsync();
  const manage = Array.from(body().querySelectorAll("button")).find((b) => b.textContent?.includes("Manage folders"))!;
  ui.flush(() => manage.click());
  const handle = byLabel("Reorder gamma")!;
  ui.flush(() => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
  expect(getFolderMenuPrefs().order).toEqual(["alpha", "gamma", "beta"]);
});
