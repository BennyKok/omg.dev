import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { MachineActionsDialog } = await import("./machine-actions-dialog");

let ui: Mounted;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  ui = mount();
});
afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
});

const body = () => document.body.textContent ?? "";
const button = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((el) => el.textContent?.trim() === text) as HTMLButtonElement;
test("rename: Save waits for a real change, Cancel closes, Save posts the trimmed name", async () => {
  let saved = false, closed = false, posted = "";
  globalThis.fetch = (async (_, init) => {
    posted = String(init?.body);
    return Response.json({ name: "Builder" });
  }) as typeof fetch;
  ui.render(
    <MachineActionsDialog
      action="rename"
      name="omg cloud"
      onClose={() => {
        closed = true;
      }}
      onSaved={async () => {
        saved = true;
      }}
    />,
  );
  const input = document.querySelector<HTMLInputElement>("#machine-name")!;
  expect(input.value).toBe("omg cloud");
  expect(button("Save").disabled).toBe(true);
  // React tracks the value it last set; write through the prototype setter so
  // the change is seen as the user's.
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await ui.flushAsync(() => {
    setValue.call(input, "  Builder ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button("Save").disabled).toBe(false);
  await ui.flushAsync(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(JSON.parse(posted)).toEqual({ name: "Builder", bindingId: "cloud" });
  expect(saved).toBe(true);
  expect(closed).toBe(true);
});

test("rename without a machine keeps Save disabled and says why", async () => {
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    return Response.json({});
  }) as typeof fetch;
  let closed = false;
  ui.render(
    <MachineActionsDialog
      action="rename"
      name=""
      machineExists={false}
      onClose={() => {
        closed = true;
      }}
      onSaved={async () => {}}
    />,
  );
  expect(button("Save").disabled).toBe(true);
  expect(body()).toContain("This machine is no longer available");
  await ui.flushAsync(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(fetched).toBe(0);
  await ui.flushAsync(() => button("Cancel").click());
  expect(closed).toBe(true);
});

test("a plan failure stays visible and does not claim a machine was created", async () => {
  let closed = false;
  globalThis.fetch = (async () => Response.json({ status: "upgrade_required" })) as typeof fetch;
  ui.render(
    <MachineActionsDialog
      action="add"
      name=""
      onClose={() => {
        closed = true;
      }}
      onSaved={async () => {}}
    />,
  );
  expect(body()).toContain("View cloud plans");
  await ui.flushAsync(() => button("Create cloud machine").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("plan");
  expect(closed).toBe(false);
});
