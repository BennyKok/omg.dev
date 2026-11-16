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

test("adding a folder or cloning one sits behind one row at the end of the list, offered only when the shell can do it", () => {
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

test("without a shell that can add folders there is no Add row", () => {
  ui.render(<PhoneFolders value="__all" projects={["lfg"]} labelFor={labelFor} onPick={() => {}} />);
  expect(ui.query('button[aria-label="Add a folder"]')).toBeNull();
});

test("the sort is the reader's choice and survives a reload", () => {
  window.localStorage.removeItem("lfg_phone_folder_sort");
  const lastActivity = new Map([["zeta", Date.now()], ["alpha", Date.now() - 60_000], ["mid", Date.now() - 120_000]]);
  const draw = () =>
    ui.render(<PhoneFolders value="__all" projects={["alpha", "mid", "zeta"]} labelFor={labelFor} lastActivity={lastActivity} onPick={() => {}} />);
  draw();
  // Recent first by default.
  expect(rows()).toEqual(["All chats", "zeta", "alpha", "mid"]);
  // One control picks the sort. It used to be three tabs beside Edit.
  expect(ui.queryAll('[role="radio"]')).toEqual([]);
  const select = ui.query('[data-testid="phone-folders-sort"]') as HTMLSelectElement;
  ui.flush(() => {
    select.value = "name";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
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

test("every page is one row above the folders, Settings included, and a tap opens it", async () => {
  const { sideNavRows } = await import("../lib/side-nav-items");
  const visited: string[] = [];
  ui.render(
    <PhoneFolders
      value="__all"
      projects={["lfg"]}
      labelFor={labelFor}
      onPick={() => {}}
      // The shell passes the rows for the menu's own tab.
      pages={sideNavRows({ tab: "folders" })}
      pagesUnread={new Set(["live"])}
      onNavigate={(tab) => visited.push(tab)}
    />,
  );
  const keys = ["live", "dashboard", "auto", "notifications", "artifacts", "computer", "settings"];
  const pageRows = ui.queryAll('[data-testid="phone-nav-pages"] button');
  expect(pageRows.map((row) => row.getAttribute("data-testid"))).toEqual(keys.map((key) => `side-nav-row-${key}`));
  // No row is marked current, so every row navigates, Chats too.
  expect(ui.query('[data-testid="phone-nav-pages"] [aria-current]')).toBeNull();
  for (const row of pageRows) ui.flush(() => (row as HTMLElement).click());
  expect(visited).toEqual(keys);
  expect(ui.query('[aria-label="Chats has unread"]')).not.toBeNull();
  // The page rows are not folder rows.
  expect(rows()).toEqual(["All chats", "lfg"]);
  // One way to each page: no tile strip, no gear.
  expect(ui.query('[data-testid="phone-nav-strip"]')).toBeNull();
  expect(ui.query('button[aria-label="Settings"]')).toBeNull();
});

test("Recent puts the newest folder first and folds idle folders into All folders", async () => {
  const { resetFolderActivityForTests } = await import("../lib/folder-activity");
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  resetFolderActivityForTests(new Map([["old", now - 30 * day], ["vibes", now - 2 * day]]));
  window.localStorage.removeItem("lfg_phone_folder_sort");
  try {
    ui.render(
      <PhoneFolders
        value="__all"
        projects={["alpha", "lfg", "old", "vibes"]}
        labelFor={labelFor}
        lastActivity={new Map([["lfg", now]])}
        onPick={() => {}}
      />,
    );
    // Live activity (lfg) and history (vibes) both count. Old and never-used
    // folders are folded away.
    expect(rows()).toEqual(["All chats", "lfg", "vibes"]);
    const toggle = ui.query('[data-testid="phone-folders-all"]') as HTMLElement;
    expect(toggle.textContent).toContain("All folders · 4");
    ui.flush(() => toggle.click());
    expect(rows()).toEqual(["All chats", "lfg", "vibes", "old", "alpha"]);
  } finally {
    resetFolderActivityForTests();
  }
});

test("the menu shows five folders, then one row for all of them, and keeps the folder in view", () => {
  window.localStorage.setItem("lfg_phone_folder_sort", "name");
  const projects = ["a", "b", "c", "d", "e", "f", "g"];
  try {
    ui.render(<PhoneFolders value="__all" projects={projects} labelFor={labelFor} onPick={() => {}} />);
    expect(rows()).toEqual(["All chats", "a", "b", "c", "d", "e"]);
    const toggle = ui.query('[data-testid="phone-folders-all"]') as HTMLElement;
    expect(toggle.textContent).toContain("All folders · 7");
    ui.flush(() => toggle.click());
    expect(rows()).toEqual(["All chats", "a", "b", "c", "d", "e", "f", "g"]);
    ui.remount();
    // The folder in view is never behind the row.
    ui.render(<PhoneFolders value="g" projects={projects} labelFor={labelFor} onPick={() => {}} />);
    expect(rows()).toEqual(["All chats", "a", "b", "c", "d", "g"]);
  } finally {
    window.localStorage.removeItem("lfg_phone_folder_sort");
  }
});

test("five folders or fewer show no All folders row", () => {
  ui.render(<PhoneFolders value="__all" projects={["a", "b", "c", "d", "e"]} labelFor={labelFor} onPick={() => {}} />);
  expect(ui.query('[data-testid="phone-folders-all"]')).toBeNull();
});
