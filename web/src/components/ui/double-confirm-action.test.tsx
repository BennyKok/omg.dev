import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../../test-support/render";
const { DoubleConfirmAction } = await import("./double-confirm-action");

let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("walks idle -> armed -> pending in the same control and reports each label", async () => {
  let resolveConfirm: () => void = () => {};
  const confirmed = new Promise<void>((r) => { resolveConfirm = r; });
  ui.render(
    <DoubleConfirmAction
      render={<button type="button" />}
      label="Archive session"
      confirmLabel="Confirm archive"
      pendingLabel="Archiving…"
      onConfirm={() => confirmed}
    />,
  );
  const button = ui.query("button") as HTMLButtonElement;
  expect(button.getAttribute("aria-label")).toBe("Archive session");
  expect(ui.text()).toContain("Archive session");

  ui.flush(() => button.click());
  expect(ui.query("button")).toBe(button);
  expect(button.getAttribute("aria-label")).toBe("Confirm archive");
  expect(ui.text()).toContain("Confirm archive");

  ui.flush(() => button.click());
  expect(button.getAttribute("aria-label")).toBe("Archiving…");
  expect(ui.text()).toContain("Archiving…");
  expect(button.disabled).toBe(true);

  resolveConfirm();
  await ui.flushAsync();
  expect(button.getAttribute("aria-label")).toBe("Archive session");
  expect(button.disabled).toBe(false);
});
