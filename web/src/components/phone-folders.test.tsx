import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { PhoneFolders } = await import("./phone-folders");
const { NO_PROJECT_FILTER } = await import("../lib/project-filter");
const { getFolderMenuPrefs, setFolderMenuHidden, setFolderMenuOrder } = await import("../lib/folder-menu-prefs");

let ui: Mounted;
beforeEach(() => {
  setFolderMenuOrder([]);
  for (const key of getFolderMenuPrefs().hidden) setFolderMenuHidden(key, false);
  ui = mount();
});
afterEach(() => ui.cleanup());

const labelFor = (value: string) => (value === NO_PROJECT_FILTER ? "No project" : value);
const rows = () => ui.queryAll("section button").map((button) => button.textContent ?? "");

test("lists every chat first, then each folder, with what is running in it", () => {
  ui.render(
    <PhoneFolders
      value="__all"
      projects={[NO_PROJECT_FILTER, "lfg", "vibes"]}
      labelFor={labelFor}
      counts={new Map([["lfg", 3], ["vibes", 2], [NO_PROJECT_FILTER, 4]])}
      running={new Map([["lfg", 2]])}
      onPick={() => {}}
    />,
  );
  expect(rows()).toEqual(["All chats9", "lfg2 running", "vibes2", "No project4"]);
  expect(ui.query('button[aria-current="true"]')?.textContent).toContain("All chats");
});

test("a pick hands the folder back, and All chats leaves it", () => {
  const picked: string[] = [];
  ui.render(
    <PhoneFolders value="lfg" projects={["lfg", "vibes"]} labelFor={labelFor} onPick={(v) => picked.push(v)} />,
  );
  expect(ui.query('button[aria-current="true"]')?.textContent).toBe("lfg");
  const byText = (text: string) => ui.queryAll("button").find((b) => b.textContent?.startsWith(text)) as HTMLElement;
  ui.flush(() => byText("vibes").click());
  ui.flush(() => byText("All chats").click());
  expect(picked).toEqual(["vibes", "__all"]);
});

test("a hidden folder stays out of the list unless it is the one in view", () => {
  setFolderMenuHidden("vibes", true);
  ui.render(<PhoneFolders value="__all" projects={["lfg", "vibes"]} labelFor={labelFor} onPick={() => {}} />);
  expect(rows()).toEqual(["All chats", "lfg"]);
  ui.render(<PhoneFolders value="vibes" projects={["lfg", "vibes"]} labelFor={labelFor} onPick={() => {}} />);
  expect(rows()).toEqual(["All chats", "lfg", "vibes"]);
});

test("adding a folder or cloning one is offered only when the shell can do it", () => {
  let cloned = 0;
  ui.render(
    <PhoneFolders value="__all" projects={["lfg"]} labelFor={labelFor} onPick={() => {}} onCloneGitHub={() => cloned++} />,
  );
  const labels = ui.queryAll("button").map((b) => b.textContent);
  expect(labels).toContain("Clone from GitHub");
  expect(labels).not.toContain("Add a folder on this computer");
  ui.flush(() => (ui.queryAll("button").find((b) => b.textContent === "Clone from GitHub") as HTMLElement).click());
  expect(cloned).toBe(1);
});
