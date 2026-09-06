import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { MachineActionsDialog, INSTALL_COMMAND } = await import("./machine-actions-dialog");

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
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
const choice = (id: string) => document.querySelector(`[data-machine-choice="${id}"]`) as HTMLElement;
const pairingResponse = (expiresAt = Date.now() + 5 * 60_000) =>
  Response.json({ code: "ABC123", connectUrl: "wss://relay.example", expiresAt });
const CONNECT = "omg connect 'ABC123' --relay 'wss://relay.example'";

test("Add machine opens on two choices and nothing else", () => {
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    return Response.json({});
  }) as typeof fetch;
  ui.render(<MachineActionsDialog action="add" name="" onClose={() => {}} onSaved={async () => {}} />);
  expect(choice("own")).not.toBeNull();
  expect(choice("cloud")).not.toBeNull();
  expect(body()).toContain("Your machine");
  expect(body()).toContain("omg.dev cloud");
  expect(body()).not.toContain(INSTALL_COMMAND);
  expect(fetched).toBe(0);
});

test("setup waits for readiness before fetching a code, then shows both commands with copy", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (input) => {
    requested.push(String(input));
    return pairingResponse();
  }) as typeof fetch;
  ui.render(<MachineActionsDialog action="add" name="" onClose={() => {}} onSaved={async () => {}} />);
  await ui.flushAsync(() => choice("own").click());
  expect(requested).toEqual([]);
  expect(body()).not.toContain(CONNECT);
  await ui.flushAsync(() => button("Ready to connect").click());
  expect(requested).toEqual(["/api/cloud/pairing"]);
  expect(body()).toContain(INSTALL_COMMAND);
  expect(body()).toContain(CONNECT);
  expect(body()).not.toContain("LFG_RELAY_URL");
  expect(body()).not.toContain("npm install");
  expect(document.querySelector('[data-pairing-status="waiting"]')?.textContent).toContain("Expires in");

  await ui.flushAsync(() => byLabel("Copy connect command").click());
  expect(await navigator.clipboard.readText()).toBe(CONNECT);
  await ui.flushAsync(() => byLabel("Copy install command").click());
  expect(await navigator.clipboard.readText()).toBe(INSTALL_COMMAND);

  // Back goes to the choices and keeps the code for when the step is reopened.
  await ui.flushAsync(() => button("All options").click());
  expect(choice("own")).not.toBeNull();
  await ui.flushAsync(() => choice("own").click());
  expect(requested).toHaveLength(1);
  expect(body()).toContain(CONNECT);
});

test("a machine that appears on the account while waiting flips the step to Connected", async () => {
  globalThis.fetch = (async () => pairingResponse()) as typeof fetch;
  let closed = false;
  const render = (connectedIds: string[]) =>
    ui.render(
      <MachineActionsDialog
        action="add"
        name=""
        connectedIds={connectedIds}
        onClose={() => {
          closed = true;
        }}
        onSaved={async () => {}}
      />,
    );
  render(["b-1"]);
  await ui.flushAsync(() => choice("own").click());
  await ui.flushAsync(() => button("Ready to connect").click());
  expect(document.querySelector('[data-pairing-status="waiting"]')).not.toBeNull();
  await ui.flushAsync(() => render(["b-1"]));
  expect(document.querySelector('[data-pairing-status="connected"]')).toBeNull();
  await ui.flushAsync(() => render(["b-1", "b-2"]));
  expect(document.querySelector('[data-pairing-status="connected"]')).not.toBeNull();
  expect(body()).not.toContain("Expires in");
  // The code is redeemed; do not offer it for copying again.
  expect(body()).not.toContain(CONNECT);
  await ui.flushAsync(() => button("Done").click());
  expect(closed).toBe(true);
});

test("an expired code says so and offers a new one", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return pairingResponse(calls === 1 ? Date.now() - 1 : Date.now() + 60_000);
  }) as typeof fetch;
  ui.render(<MachineActionsDialog action="add" name="" onClose={() => {}} onSaved={async () => {}} />);
  await ui.flushAsync(() => choice("own").click());
  await ui.flushAsync(() => button("Ready to connect").click());
  expect(document.querySelector('[data-pairing-status="expired"]')).not.toBeNull();
  expect(body()).not.toContain(CONNECT);
  await ui.flushAsync(() => button("Get a new code").click());
  expect(calls).toBe(2);
  expect(document.querySelector('[data-pairing-status="waiting"]')).not.toBeNull();
  expect(body()).toContain(CONNECT);
});

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
  expect(JSON.parse(posted)).toEqual({ name: "Builder" });
  expect(saved).toBe(true);
  expect(closed).toBe(true);
});

test("rename without a cloud machine keeps Save disabled and says why", async () => {
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
      cloudExists={false}
      onClose={() => {
        closed = true;
      }}
      onSaved={async () => {}}
    />,
  );
  expect(button("Save").disabled).toBe(true);
  expect(body()).toContain("do not have a cloud machine yet");
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
  await ui.flushAsync(() => choice("cloud").click());
  expect(body()).toContain("View cloud plans");
  await ui.flushAsync(() => button("Create cloud machine").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("plan");
  expect(closed).toBe(false);
});
