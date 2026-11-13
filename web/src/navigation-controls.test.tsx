import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";

const { PagesMenu, SurfaceToggle, BotRosterRow, BotsView, BotUnreadContext } = await import("./App");
const { PhoneFolders } = await import("./components/phone-folders");
const { SideNavPanel } = await import("./components/side-nav");
const { sideNavRows } = await import("./lib/side-nav-items");

let ui: Mounted;
const originalWidth = window.innerWidth;
beforeEach(() => { ui = mount(); });
afterEach(() => {
  ui.cleanup();
  window.innerWidth = originalWidth;
});

const bot = { id: "test-bot", name: "Helper", persona: "A helper", enabled: false } as import("./App").PersistentBot;
const click = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await ui.flushAsync(() => (element as HTMLElement).click());
};

test("the pages menu navigates to each page and to extension pages", async () => {
  const opened: string[] = [];
  ui.render(<PagesMenu tab="live" onOpenTab={(tab) => opened.push(tab)} extraTabs={[{ id: "extra", label: "Extension", render: () => null }]} />);
  for (const [label, tab] of [["Notifications", "notifications"], ["Artifacts", "artifacts"], ["Computer", "computer"], ["Settings", "settings"], ["Extension", "extra"]]) {
    await click(ui.query('[aria-label="Pages"]'));
    const item = [...document.querySelectorAll('[role="menuitemradio"]')].find((node) => node.textContent?.trim() === label);
    await click(item ?? null);
    expect(opened.at(-1)).toBe(tab);
  }
});

test("the pages menu respects hidden pages and host-owned settings", async () => {
  ui.render(<PagesMenu tab="live" onOpenTab={() => {}} extraTabs={[]} hiddenPages={["artifacts"]} showSettings={false} />);
  await click(ui.query('[aria-label="Pages"]'));
  const labels = [...document.querySelectorAll('[role="menuitemradio"]')].map((node) => node.textContent?.trim());
  expect(labels).toContain("Notifications");
  expect(labels).not.toContain("Artifacts");
  expect(labels).not.toContain("Settings");
});

test("the desktop navigation reaches the inbox and goes back after selection", async () => {
  const opened: string[] = [];
  let backs = 0;
  ui.render(<SideNavPanel open rows={sideNavRows({ tab: "live" })} onNavigate={(tab) => opened.push(tab)} onBack={() => backs++} />);
  await click(ui.query('[data-testid="side-nav-row-notifications"]'));
  expect(opened).toEqual(["notifications"]);
  expect(backs).toBe(1);
});

test("the desktop menu still reaches Chat while a bot conversation is selected", async () => {
  const opened: string[] = [];
  ui.render(<SideNavPanel open rows={sideNavRows({ tab: "bots" })} onNavigate={(tab) => opened.push(tab)} onBack={() => {}} />);
  // Bots belongs to Chat in the navigation model. Selecting Chat closes the
  // menu without navigating to a duplicate route.
  expect(ui.query('[data-testid="side-nav-row-live"]')).not.toBeNull();
  await click(ui.query('[data-testid="side-nav-row-auto"]'));
  expect(opened).toEqual(["auto"]);
});

test("the phone's Folders page separates folder selection from Settings", async () => {
  const picked: string[] = [];
  let settings = 0;
  ui.render(<PhoneFolders value="__all" projects={["project"]} labelFor={(value) => value} onPick={(value) => picked.push(value)} onOpenSettings={() => settings++} />);
  await click(ui.queryAll("button").find((node) => node.textContent === "project") ?? null);
  expect(picked).toEqual(["project"]);
  await click(ui.query('[aria-label="Settings"]'));
  expect(settings).toBe(1);
  expect(picked).toEqual(["project"]);
});

test("the shared surface switch exposes unread bots and navigates on both sizes", async () => {
  const opened: string[] = [];
  for (const compact of [false, true]) {
    ui.render(
      <BotUnreadContext.Provider value={{ conversations: [], any: true, selectedConversationId: null, markRead: () => {} }}>
        <SurfaceToggle active="sessions" compact={compact} onOpenSessions={() => opened.push("live")} onOpenBots={() => opened.push("bots")} onOpenAuto={() => opened.push("auto")} />
      </BotUnreadContext.Provider>,
    );
    expect(ui.query('[aria-label="Bots have unread conversations"]')).not.toBeNull();
    await click(ui.queryAll('[role="tab"]').find((node) => node.textContent === "Bots") ?? null);
    expect(opened.at(-1)).toBe("bots");
    await click(ui.queryAll('[role="tab"]').find((node) => node.textContent === "Schedules") ?? null);
    expect(opened.at(-1)).toBe("auto");
  }
});

test("a bot row exposes its unread state and marks it read without opening", async () => {
  let opened = 0;
  let read = 0;
  ui.render(<BotRosterRow bot={bot} busy={false} active={false} collapsed={false} avatarSize={32} preview="Last reply" unread onOpen={() => opened++} onMarkRead={() => read++} />);
  expect(ui.query('[aria-label="Unread conversation with Helper"]')).not.toBeNull();
  await click(ui.query('[aria-label="Mark conversation with Helper as read"]'));
  expect(read).toBe(1);
  expect(opened).toBe(0);
});

for (const width of [390, 1024]) {
  test(`an open bot conversation has its own exit and no surface switch at ${width}px`, async () => {
    window.innerWidth = width;
    let backs = 0;
    ui.render(<BotsView bots={[bot]} sessions={[]} selectedBotId={bot.id} selectedConversationId={null} busyBySid={{}} onOpen={() => {}} onBack={() => backs++} onOpenSessions={() => {}} onOpenAuto={() => {}} onNew={() => {}} onEdit={() => {}} onRefreshBots={async () => {}} onRefreshSessions={async () => {}} />);
    expect(document.querySelector('[aria-label="Switch surface"]')).toBeNull();
    await click(document.querySelector('[aria-label="Back to bots"]'));
    expect(backs).toBe(1);
  });
}
