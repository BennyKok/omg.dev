import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../../test-support/render";

const { AppDialogProvider, useAppDialog } = await import("./app-dialog");

function OpenConfirm({ title }: { title: string }) {
  const dialog = useAppDialog();
  return (
    <button
      type="button"
      onClick={() => {
        void dialog.confirm({
          title,
          description: "The session will leave the live view and can be resumed later from Recent sessions.",
          confirmLabel: "Archive session",
          destructive: true,
        });
      }}
    >
      Open
    </button>
  );
}

let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("keeps long confirm titles and footer actions inside the dialog", async () => {
  ui.render(
    <AppDialogProvider>
      <OpenConfirm title="Archive | get report like this https://x.com/inurinternet/status/209947127416685?" />
    </AppDialogProvider>,
  );
  await ui.flushAsync(() => (ui.query("button") as HTMLButtonElement).click());

  // Portalled out of the mount host, so query the document.
  const content = document.querySelector('[data-slot="alert-dialog-content"]') as HTMLElement | null;
  const title = document.querySelector('[data-slot="alert-dialog-title"]') as HTMLElement | null;
  const footer = document.querySelector('[data-slot="alert-dialog-footer"]') as HTMLElement | null;
  expect(content).toBeTruthy();
  expect(title).toBeTruthy();
  expect(footer).toBeTruthy();
  expect(content!.className).toContain("overflow-hidden");
  expect(content!.className).toContain("min-w-0");
  expect(content!.className).toContain("calc(100%-2rem)");
  expect(title!.className).toContain("break-words");
  expect(footer!.className).toContain("flex-wrap");
  expect(document.body.textContent).toContain("Cancel");
  expect(document.body.textContent).toContain("Archive session");
});
