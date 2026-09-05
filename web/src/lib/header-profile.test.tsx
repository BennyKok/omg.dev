import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { useHeaderProfile } = await import("./header-profile");
let ui: Mounted;
beforeEach(() => { ui = mount(); window.sessionStorage.clear(); });
afterEach(() => ui.cleanup());
function Header({ identity = "ada@example.com", scope = "local", user }: { identity?: string; scope?: string; user?: { email: string; name: string; avatar: string } }) {
  const profile = useHeaderProfile(scope, identity, user);
  return <span>{profile?.name ?? "Welcome"}{profile?.avatar ? <img src={profile.avatar} /> : null}</span>;
}

test("keeps display name and avatar after a failed reload, without sharing between machines or identities", async () => {
  ui.render(<Header user={{ email: "ada@example.com", name: "Ada", avatar: "/ada.png" }} />);
  await ui.flushAsync();
  ui.remount();
  ui.render(<Header />);
  await ui.flushAsync();
  expect(ui.text()).toBe("Ada");
  expect(ui.query("img")?.getAttribute("src")).toBe("/ada.png");
  ui.render(<Header scope="cloud" />);
  await ui.flushAsync();
  expect(ui.text()).toBe("Welcome");
  ui.render(<Header identity="other@example.com" />);
  await ui.flushAsync();
  expect(ui.text()).toBe("Welcome");
});
