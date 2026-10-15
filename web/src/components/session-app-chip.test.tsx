import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { SessionAppChip, sessionAppRepo, consoleAppUrl } = await import("./session-app-chip");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const link = { slug: "tilt-charades-aplqq", url: "https://tilt-charades-aplqq.omgs.app", name: "Tilt! Charades" };
const body = () => document.body;
const items = () => Array.from(body().querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim());

test("shows the live host and opens the app actions", async () => {
  let unlinked = 0;
  ui.render(<SessionAppChip link={link} onUnlink={() => { unlinked++; }} />);
  const chip = body().querySelector('button[aria-label="Linked app tilt-charades-aplqq.omgs.app"]') as HTMLButtonElement;
  expect(chip.textContent).toContain("tilt-charades-aplqq.omgs.app");
  ui.flush(() => chip.click());
  await ui.flushAsync();
  expect(body().textContent).toContain("Tilt! Charades");
  expect(items()).toEqual(["Open app", "Open in console", "Copy link", "Unlink"]);
  const unlink = Array.from(body().querySelectorAll('[role="menuitem"]')).find((item) => item.textContent?.includes("Unlink")) as HTMLElement;
  ui.flush(() => unlink.click());
  expect(unlinked).toBe(1);
});

test("offers no Unlink when the caller cannot unlink", async () => {
  ui.render(<SessionAppChip link={link} />);
  ui.flush(() => (body().querySelector('button[aria-label^="Linked app"]') as HTMLButtonElement).click());
  await ui.flushAsync();
  expect(items()).toEqual(["Open app", "Open in console", "Copy link"]);
});

test("finds the repo for a session folder, a subfolder, and a worktree", () => {
  const repos = [
    { cwd: "/home/u/repos/shop", project: "shop", deploy: link },
    { cwd: "/home/u/repos/shop/admin", project: "admin" },
  ];
  expect(sessionAppRepo({ cwd: "/home/u/repos/shop" }, repos)?.project).toBe("shop");
  expect(sessionAppRepo({ cwd: "/home/u/repos/shop/src" }, repos)?.project).toBe("shop");
  expect(sessionAppRepo({ cwd: "/home/u/repos/shop/admin/x" }, repos)?.project).toBe("admin");
  expect(sessionAppRepo({ cwd: "/home/u/worktrees/shop-1a2b", project: "shop" }, repos)?.project).toBe("shop");
  expect(sessionAppRepo({ cwd: "/home/u/.local/share/omg/chats/x", project: "" }, repos)).toBeUndefined();
  expect(consoleAppUrl("tilt-charades-aplqq")).toBe("https://console.omg.dev/apps/tilt-charades-aplqq");
});
