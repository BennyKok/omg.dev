import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { ViewerRoleMenu } = await import("./viewer-role-menu");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const roles = [
  { id: "owner", name: "Owner" },
  { id: "marketing", name: "Marketing" },
];

test("renders nothing when the box has only the owner role", () => {
  ui.render(
    <ViewerRoleMenu
      viewer={{ role: { id: "owner", name: "Owner" }, canSwitchRole: true, hide: [], hiddenPages: [] }}
      roles={[roles[0]!]}
      onPreview={() => {}}
    />,
  );
  expect(ui.text()).toBe("");
});

test("an owner gets a switch, a member gets a label", () => {
  ui.render(
    <ViewerRoleMenu
      viewer={{ role: { id: "owner", name: "Owner" }, canSwitchRole: true, hide: [], hiddenPages: [] }}
      roles={roles}
      onPreview={() => {}}
    />,
  );
  expect(ui.query("button[aria-label='Viewing as Owner']")).not.toBeNull();

  ui.render(
    <ViewerRoleMenu
      viewer={{ role: { id: "marketing", name: "Marketing" }, canSwitchRole: false, hide: [], hiddenPages: [] }}
      roles={roles}
      onPreview={() => {}}
    />,
  );
  expect(ui.query("button[aria-label='Viewing as Marketing']")).toBeNull();
  expect(ui.text()).toContain("Marketing");
});
