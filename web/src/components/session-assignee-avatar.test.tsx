import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { SessionAssigneeAvatar } = await import("./session-assignee-avatar");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

describe("SessionAssigneeAvatar", () => {
  test("shows the assigned roster user's avatar", () => {
    ui.render(
      <SessionAssigneeAvatar
        session={{ assignedUser: "ada@example.com" }}
        users={[{ email: "ada@example.com", name: "Ada", avatar: "https://example.com/ada.png" }]}
      />,
    );

    const avatar = ui.query('img[alt="Assigned to Ada"]') as HTMLImageElement | null;
    expect(avatar).not.toBeNull();
    expect(avatar?.src).toBe("https://example.com/ada.png");
  });

  test("uses an accessible fallback when the roster has no avatar", () => {
    ui.render(
      <SessionAssigneeAvatar
        session={{ assignedUser: "grace@example.com" }}
        users={[{ email: "grace@example.com" }]}
      />,
    );

    expect(ui.query('[role="img"]')?.getAttribute("aria-label")).toBe("Assigned to grace");
  });

  test("renders nothing for an unassigned session", () => {
    ui.render(<SessionAssigneeAvatar session={{ assignedUser: null }} users={[]} />);
    expect(ui.host.childElementCount).toBe(0);
  });
});
