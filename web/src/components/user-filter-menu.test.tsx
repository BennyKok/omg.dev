import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { UserFilterMenu } = await import("./user-filter-menu");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

describe("UserFilterMenu", () => {
  test("shows the all-users state", () => {
    ui.render(<UserFilterMenu value="__all" users={[]} onChange={() => {}} />);

    const trigger = ui.query('[aria-label="Filter live sessions by user"]');
    expect(trigger?.getAttribute("title")).toBe("All users");
    expect(trigger?.querySelector("img")).toBeNull();
  });

  test("resolves a selected user from the hosted roster", () => {
    ui.render(
      <UserFilterMenu
        value="ada@example.com"
        users={[{ email: "ada@example.com", name: "Ada", avatar: "https://example.com/ada.png" }]}
        onChange={() => {}}
      />,
    );

    const trigger = ui.query('[aria-label="Filter live sessions by user"]');
    expect(trigger?.getAttribute("title")).toBe("Ada");
    expect((trigger?.querySelector("img") as HTMLImageElement | null)?.src).toBe(
      "https://example.com/ada.png",
    );
  });
});
