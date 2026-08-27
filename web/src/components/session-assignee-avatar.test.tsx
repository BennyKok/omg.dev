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

  test("hides a redundant agent-mark badge for a one-person roster", () => {
    ui.render(
      <SessionAssigneeAvatar
        session={{ assignedUser: "ada@example.com" }}
        users={[{ email: "ada@example.com", name: "Ada" }]}
        hideWhenRedundant
      />,
    );

    expect(ui.host.childElementCount).toBe(0);
  });

  test("hides a redundant agent-mark badge when one user is selected", () => {
    ui.render(
      <SessionAssigneeAvatar
        session={{ assignedUser: "ada@example.com" }}
        users={[{ email: "ada@example.com" }, { email: "grace@example.com" }]}
        hideWhenRedundant
        userFilter="ada@example.com"
      />,
    );

    expect(ui.host.childElementCount).toBe(0);
  });

  test("keeps the agent-mark badge in a shared all-users view", () => {
    ui.render(
      <SessionAssigneeAvatar
        session={{ assignedUser: "ada@example.com" }}
        users={[{ email: "ada@example.com" }, { email: "grace@example.com" }]}
        hideWhenRedundant
        userFilter="__all"
      />,
    );

    expect(ui.query('[aria-label="Assigned to ada"]')).not.toBeNull();
  });

  test("falls back to the configured placeholder when the avatar fails to load", () => {
    ui.render(
      <SessionAssigneeAvatar
        session={{ assignedUser: "ada@example.com" }}
        users={[
          { email: "ada@example.com", name: "Ada", avatar: "https://www.gravatar.com/avatar/abc" },
        ]}
      />,
    );

    const img = ui.query("img") as HTMLImageElement | null;
    expect(img).not.toBeNull();

    // An unreachable gravatar.com on a self-hosted box surfaces as an error
    // event, not an empty `avatar`, so this is the only signal to fall back on.
    ui.flush(() => {
      img?.dispatchEvent(new Event("error"));
    });

    expect(ui.query("img")).toBeNull();
    expect(ui.query('[role="img"]')?.getAttribute("aria-label")).toBe("Assigned to Ada");
  });

  test("retries when the roster serves a different avatar URL", () => {
    const render = (avatar: string) =>
      ui.render(
        <SessionAssigneeAvatar
          session={{ assignedUser: "ada@example.com" }}
          users={[{ email: "ada@example.com", name: "Ada", avatar }]}
        />,
      );

    render("/api/avatars/abc.webp?v=1");
    ui.flush(() => {
      ui.query("img")?.dispatchEvent(new Event("error"));
    });
    expect(ui.query("img")).toBeNull();

    // A fresh upload bumps `?v=`, so the failure must not stick to the user.
    render("/api/avatars/abc.webp?v=2");
    expect((ui.query("img") as HTMLImageElement | null)?.getAttribute("src")).toBe(
      "/api/avatars/abc.webp?v=2",
    );
  });
});
