import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { PhoneFolders, sortFolders } = await import("./phone-folders");
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
const rows = () => ui.queryAll("[data-folder-row]").map((button) => button.textContent ?? "");

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

test("adding a folder or cloning one sits behind the + button, offered only when the shell can do it", () => {
  let cloned = 0;
  ui.render(
    <PhoneFolders value="__all" projects={["lfg"]} labelFor={labelFor} onPick={() => {}} onCloneGitHub={() => cloned++} />,
  );
  const byText = (text: string) => ui.queryAll("button").find((b) => b.textContent === text) as HTMLElement | undefined;
  expect(byText("Clone from GitHub")).toBeUndefined();
  ui.flush(() => (ui.query('button[aria-label="Add a folder"]') as HTMLElement).click());
  expect(byText("Add a folder on this computer")).toBeUndefined();
  ui.flush(() => byText("Clone from GitHub")!.click());
  expect(cloned).toBe(1);
});

test("Settings is the gear in the title row, not a row under the folders", () => {
  let opened = 0;
  ui.render(<PhoneFolders value="__all" projects={["lfg"]} labelFor={labelFor} onPick={() => {}} onOpenSettings={() => opened++} />);
  ui.flush(() => (ui.query('button[aria-label="Settings"]') as HTMLElement).click());
  expect(opened).toBe(1);
  expect(rows().some((row) => row.includes("Settings"))).toBe(false);
});

test("the sort is the reader's choice and survives a reload", () => {
  window.localStorage.removeItem("lfg_phone_folder_sort");
  const lastActivity = new Map([["zeta", 300], ["alpha", 100]]);
  const draw = () =>
    ui.render(<PhoneFolders value="__all" projects={["alpha", "mid", "zeta"]} labelFor={labelFor} lastActivity={lastActivity} onPick={() => {}} />);
  draw();
  // Recent first by default; a folder with no chats goes last.
  expect(rows()).toEqual(["All chats", "zeta", "alpha", "mid"]);
  ui.flush(() => (ui.queryAll('[role="radio"]').find((b) => b.textContent === "A–Z") as HTMLElement).click());
  expect(rows()).toEqual(["All chats", "alpha", "mid", "zeta"]);
  ui.remount();
  draw();
  expect(rows()).toEqual(["All chats", "alpha", "mid", "zeta"]);
  window.localStorage.removeItem("lfg_phone_folder_sort");
});

test("Custom keeps the order set in Edit", () => {
  setFolderMenuOrder(["mid", "zeta", "alpha"]);
  const arranged = [{ value: "mid", hidden: false }, { value: "zeta", hidden: false }, { value: "alpha", hidden: false }];
  expect(sortFolders(arranged, "custom", labelFor).map((f) => f.value)).toEqual(["mid", "zeta", "alpha"]);
  expect(sortFolders(arranged, "name", labelFor).map((f) => f.value)).toEqual(["alpha", "mid", "zeta"]);
});

test("Edit opens folder management in place, and Back returns to the list", () => {
  ui.render(<PhoneFolders value="__all" projects={["lfg"]} labelFor={labelFor} onPick={() => {}} />);
  ui.flush(() => (ui.queryAll("button").find((b) => b.textContent === "Edit") as HTMLElement).click());
  expect(ui.text()).toContain("Manage folders");
  ui.flush(() => (ui.query('button[aria-label="Back to folders"]') as HTMLElement).click());
  expect(rows()).toEqual(["All chats", "lfg"]);
});
