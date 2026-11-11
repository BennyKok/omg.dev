import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { ReceiverState } from "../lib/linked-devices";
const { DeviceReceiverSettings } = await import("./device-receiver-settings");

let ui: Mounted;
const originalFetch = globalThis.fetch;
let state: ReceiverState;
let calls: Array<{ action: string; body: any }>;
let error: string | null;

beforeEach(() => {
  ui = mount();
  calls = [];
  error = null;
  state = { deviceId: "lab", server: "https://controller.example", active: false, endsAt: null, idleMinutes: null, pending: null, error: null, activity: [], actions: [{ name: "inspect", approval: "each" }] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (error) return Response.json({ error }, { status: 403 });
    const action = String(input).split("/_local/")[1];
    if (action) {
      calls.push({ action, body: JSON.parse(String(init?.body)) });
      expect(new Headers(init?.headers).get("x-omg-device-ui")).toBe("1");
      if (action === "decision") state = { ...state, pending: null };
      if (action === "start") state = { ...state, active: true, endsAt: Date.now() + 60_000, idleMinutes: 15 };
      if (action === "stop") state = { ...state, active: false };
      if (action === "connect") state = { ...state, deviceId: "lab" };
    }
    return Response.json(state);
  }) as typeof fetch;
});

afterEach(() => { ui.cleanup(); globalThis.fetch = originalFetch; });

async function render() { ui.render(<DeviceReceiverSettings />); await ui.flushAsync(); }
async function click(label: string) {
  const button = ui.queryAll("button").find((el) => el.textContent === label) as HTMLButtonElement;
  expect(button).toBeDefined();
  await ui.flushAsync(() => button.click());
}
async function fill(label: string, value: string) {
  const input = ui.query(`input[aria-label="${label}"]`) as HTMLInputElement;
  await ui.flushAsync(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

test("connecting uses the controller address and code, without starting access", async () => {
  state.deviceId = null;
  await render();
  await fill("Controller address", "https://controller.example");
  await fill("Pairing code", "ABCDE-FGHJK");
  await click("Connect controller");
  expect(calls).toEqual([{ action: "connect", body: { server: "https://controller.example", code: "ABCDE-FGHJK" } }]);
  expect(ui.text()).toContain("Access is stopped");
});

test("shows permissions before starting access and offers a working Stop control", async () => {
  await render();
  expect(ui.text()).toContain("Ask every time");
  expect(ui.text()).toContain("without another prompt");
  await click("Start access");
  expect(calls[0]).toEqual({ action: "start", body: { minutes: 60, idle: 15 } });
  expect(ui.text()).toContain("Access is active");
  await click("Stop access");
  expect(calls[1].action).toBe("stop");
  expect(ui.text()).toContain("Access is stopped");
});

test("approvals identify the command and bind Allow or Deny to its token", async () => {
  for (const allow of [true, false]) {
    state.pending = { token: `approval-${allow}`, request: { id: "dr_pending", action: "inspect", args: {}, requestedBy: "session-one" }, argv: ["/bin/echo", "<img src=x onerror=alert(1)>"], approval: "each", expiresAt: Date.now() + 60_000 };
    await render();
    expect(ui.text()).toContain("/bin/echo");
    expect(ui.text()).toContain("session-one");
    expect(ui.query("img")).toBeNull();
    await click(allow ? "Allow once" : "Deny");
    expect(calls.at(-1)).toEqual({ action: "decision", body: { token: `approval-${allow}`, allow } });
    expect(ui.query('[aria-label="Action approval"]')).toBeNull();
    ui.remount();
  }
});

test("first-use approval states that it covers all valid arguments until access ends", async () => {
  state.pending = { token: "first-use", request: { id: "dr_first", action: "inspect", args: {} }, argv: ["/bin/echo"], approval: "once-per-grant", expiresAt: Date.now() + 60_000 };
  await render();
  expect(ui.text()).toContain("any valid arguments until access ends");
  await click("Allow until access ends");
  expect(calls[0].body.token).toBe("first-use");
});

test("remote UI gets an explanation and no approval or access controls", async () => {
  error = "Open omg.dev on this computer through localhost to manage incoming access.";
  await render();
  expect(ui.query('[role="alert"]')?.textContent).toContain("localhost");
  expect(ui.queryAll("button")).toHaveLength(0);
});

test("an existing CLI receiver is identified and cannot be started again from the UI", async () => {
  state.otherProcess = true;
  await render();
  expect(ui.text()).toContain("Access is managed by another process");
  const start = ui.queryAll("button").find((el) => el.textContent === "Start access") as HTMLButtonElement;
  expect(start.disabled).toBe(true);
});

test("activity renders returned output as text", async () => {
  state.activity = [{ at: Date.now(), kind: "done", request: { id: "dr_done", action: "inspect", args: {} }, update: { exitCode: 0, logTail: "<script>doBadThings()</script>" } }];
  await render();
  expect(ui.text()).toContain("<script>doBadThings()</script>");
  expect(ui.text()).toContain("Exit code: 0");
  expect(ui.query("script")).toBeNull();
});
