import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { MobileProjectFolders } = await import("./mobile-project-folders");
const { getFolderMenuPrefs, setFolderMenuOrder, setFolderMenuHidden } = await import("../lib/folder-menu-prefs");
const { NO_PROJECT_FILTER } = await import("../lib/project-filter");
let ui: Mounted;
beforeEach(() => {
  setFolderMenuOrder([]);
  for (const key of getFolderMenuPrefs().hidden) setFolderMenuHidden(key, false);
  ui = mount();
});
afterEach(() => ui.cleanup());

test("mobile folder settings use saved order and visibility and offer folder actions", async () => {
  const picked: string[] = [];
  const removed: string[] = [];
  let added = 0;
  ui.render(<MobileProjectFolders projects={[NO_PROJECT_FILTER, "alpha", "beta"]} shortProject={(p) => p} value="__all" onChange={(v) => picked.push(v)} canRemove={() => true} onRemove={async (v) => { removed.push(v); }} onAddFolder={() => added++} onNewFolder={() => {}} />);
  const open = async () => {
    ui.flush(() => ui.query('button[title="alpha"]')!.dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true })));
    await ui.flushAsync();
  };
  const byLabel = (label: string) => document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
  await open();
  expect(document.body.textContent).toContain("Manage folders");
  ui.flush(() => byLabel("Move beta up").click());
  expect(getFolderMenuPrefs().order).toEqual(["beta", "alpha"]);
  ui.flush(() => byLabel("Hide beta from the menu").click());
  expect(getFolderMenuPrefs().hidden).toEqual(["beta"]);
  expect(ui.query('button[title="beta"]')).toBeNull();
  ui.flush(() => byLabel("Show beta in the menu").click());
  expect(ui.query('button[title="beta"]')).not.toBeNull();
  ui.flush(() => byLabel("Remove beta from the folder list").click());
  await ui.flushAsync();
  expect(removed).toEqual(["beta"]);
  ui.flush(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Add folder"))!.click());
  await ui.flushAsync();
  expect(added).toBe(1);
  expect(picked).toEqual([]);
});
