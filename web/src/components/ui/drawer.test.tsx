import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, window, type Mounted } from "../../test-support/render";
const { useState } = await import("react");
const { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerTrigger, DrawerClose, useDrawerPaged } = await import("./drawer");

let ui: Mounted;
const matchMedia = window.matchMedia;
beforeEach(() => { ui = mount(); window.innerWidth = 390; });
afterEach(() => { ui.cleanup(); window.matchMedia = matchMedia; });

function PageState() { return <span>{useDrawerPaged() ? "Expanded" : "Compact"}</span>; }
function Example({ presentation = "responsive" }: { presentation?: "responsive" | "sheet" }) {
  const [open, setOpen] = useState(false);
  return <Drawer open={open} onOpenChange={setOpen} presentation={presentation}>
    <DrawerTrigger>Open drawer</DrawerTrigger>
    <DrawerContent><DrawerTitle>Agent controls</DrawerTitle><DrawerDescription>Choose an agent.</DrawerDescription>
      <input aria-label="Search agents" /><PageState /><DrawerClose>Done</DrawerClose>
    </DrawerContent>
  </Drawer>;
}
const button = (label: string) => [...document.querySelectorAll("button")].find(el => el.textContent === label)!;

test("a controlled sheet opens, names its dialog, and closes through the same owner", async () => {
  ui.render(<Example presentation="sheet" />);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  ui.flush(() => button("Open drawer").click());
  await ui.flushAsync();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
  expect(title?.textContent).toBe("Agent controls");
  const description = dialog.querySelector('[slot="description"]');
  expect(description?.textContent).toBe("Choose an agent.");
  ui.flush(() => button("Done").click());
  await ui.flushAsync();
  expect(button("Open drawer").getAttribute("aria-expanded")).toBe("false");
});

test("input focus shares expanded page state with the drawer body", async () => {
  ui.render(<Example presentation="sheet" />);
  ui.flush(() => button("Open drawer").click());
  await ui.flushAsync();
  expect(document.body.textContent).toContain("Compact");
  ui.flush(() => (document.querySelector('input[aria-label="Search agents"]') as HTMLElement).focus());
  expect(document.querySelector('[data-slot="drawer-content"]')?.getAttribute("data-paged")).toBe("true");
  expect(document.body.textContent).toContain("Expanded");
});

test("desktop responsive drawers use the centered dialog, while explicit sheets keep swipe geometry", async () => {
  window.innerWidth = 1200;
  ui.render(<Example />);
  ui.flush(() => button("Open drawer").click());
  await ui.flushAsync();
  expect(document.querySelector('[data-sheet-scroll]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Agent controls");
  ui.remount();
  ui.render(<Example presentation="sheet" />);
  ui.flush(() => button("Open drawer").click());
  await ui.flushAsync();
  expect(document.querySelector('[data-sheet-scroll]')).not.toBeNull();
});

test("closed custom sheets leave no portal or content in the document", () => {
  ui.render(<Drawer open={false} presentation="sheet"><DrawerContent unstyled><DrawerTitle>Hidden</DrawerTitle></DrawerContent></Drawer>);
  expect(document.querySelector('[data-sheet-scroll]')).toBeNull();
  expect(document.body.textContent).not.toContain("Hidden");
});
