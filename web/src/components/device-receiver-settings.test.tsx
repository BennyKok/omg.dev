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
      if (action === "extend" && state.grant) state = { ...state, grant: { ...state.grant, endsAt: state.grant.endsAt + 3_600_000 } };
      if (action === "idle" && state.grant) state = { ...state, grant: { ...state.grant, idleMinutes: null, idleEndsAt: null } };
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
  await fill("Address of the other computer", "https://controller.example");
  await fill("Pairing code", "ABCDE-FGHJK");
  await click("Connect");
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

async function choose(label: string, value: string) {
  const select = ui.query(`select[aria-label="${label}"]`) as HTMLSelectElement;
  expect(select).not.toBeNull();
  await ui.flushAsync(() => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

function button(label: string) {
  return ui.queryAll("button").find((el) => el.textContent === label) as HTMLButtonElement | undefined;
}

test("start takes the session length and idle stop in one decision", async () => {
  state.longestMinutes = 1440; state.standardMinutes = 240;
  await render();
  const lengths = [...(ui.query('select[aria-label="Session length"]') as HTMLSelectElement).options].map((o) => o.textContent);
  expect(lengths).toEqual(["1 h", "4 h", "8 h", "12 h", "24 h"]);
  const idles = [...(ui.query('select[aria-label="Idle stop"]') as HTMLSelectElement).options].map((o) => o.textContent);
  expect(idles).toEqual(["15 min", "1 h", "4 h", "Never while the session lasts"]);
  await choose("Session length", "240");
  await choose("Idle stop", "never");
  await click("Start access");
  expect(calls[0]).toEqual({ action: "start", body: { minutes: 240, idle: "never" } });
});

test("a session over 4 hours needs the explicit long-session choice", async () => {
  state.longestMinutes = 1440; state.standardMinutes = 240;
  await render();
  await choose("Session length", "720");
  expect(ui.text()).toContain("Allow a long session of 12 h");
  expect(button("Start access")!.disabled).toBe(true);
  const box = ui.query('input[aria-label="Allow a long session"]') as HTMLInputElement;
  await ui.flushAsync(() => box.click());
  expect(button("Start access")!.disabled).toBe(false);
  await click("Start access");
  expect(calls[0]).toEqual({ action: "start", body: { minutes: 720, idle: 15, long: true } });
});

test("the last choice is preselected, but a long one is confirmed again", async () => {
  state.longestMinutes = 1440; state.standardMinutes = 240;
  state.lastChoice = { minutes: 480, idle: 60, long: true };
  await render();
  expect((ui.query('select[aria-label="Session length"]') as HTMLSelectElement).value).toBe("480");
  expect((ui.query('select[aria-label="Idle stop"]') as HTMLSelectElement).value).toBe("60");
  expect(button("Start access")!.disabled).toBe(true);
});

test("a device config that forbids long sessions offers only standard lengths", async () => {
  state.longestMinutes = 240; state.standardMinutes = 240;
  await render();
  const lengths = [...(ui.query('select[aria-label="Session length"]') as HTMLSelectElement).options].map((o) => o.textContent);
  expect(lengths).toEqual(["1 h", "4 h"]);
});

test("the active grant shows a countdown, extends in one click and changes the idle stop", async () => {
  const now = Date.now();
  state = { ...state, active: true, endsAt: now + 30 * 60_000, idleMinutes: 15,
    grant: { startedAt: now - 60_000, endsAt: now + 30 * 60_000, idleMinutes: 15, idleEndsAt: now + 10 * 60_000, busy: false, ceilingMinutes: 240 } };
  await render();
  expect(ui.text()).toContain("Ends in 30 min");
  expect(ui.text()).toContain("in 10 min if no request runs");
  expect(button("Extend 4 h")).toBeUndefined();
  await click("Extend 1 h");
  expect(calls[0]).toEqual({ action: "extend", body: { minutes: 60 } });
  expect(ui.text()).toContain("Ends in 1 h 30 min");
  await choose("Change idle stop", "never");
  expect(calls[1]).toEqual({ action: "idle", body: { idle: "never" } });
  expect(ui.text()).toContain("No idle stop while the session lasts");
});

test("a running action pauses the idle stop on screen", async () => {
  const now = Date.now();
  state = { ...state, active: true, endsAt: now + 60 * 60_000, idleMinutes: 15,
    grant: { startedAt: now, endsAt: now + 60 * 60_000, idleMinutes: 15, idleEndsAt: null, busy: true, ceilingMinutes: 1440 } };
  await render();
  expect(ui.text()).toContain("An action is running, so the 15 min idle stop is paused");
  expect(button("Extend 4 h")).toBeDefined();
});

test("an agent's extension request is shown as an approval bound to its token", async () => {
  const now = Date.now();
  state = { ...state, active: true, endsAt: now + 30 * 60_000, idleMinutes: 15,
    grant: { startedAt: now, endsAt: now + 30 * 60_000, idleMinutes: 15, idleEndsAt: now + 15 * 60_000, busy: false, ceilingMinutes: 240 },
    extension: { token: "ext-token", id: "dx_one", minutes: 120, reason: "<b>overnight</b> loop", requestedBy: "session-abcdef123", createdAt: now, expiresAt: now + 20 * 60_000 } };
  await render();
  expect(ui.text()).toContain("Session session- asks to extend access by 2 h");
  expect(ui.text()).toContain("<b>overnight</b> loop");
  expect(ui.query("b")).toBeNull();
  expect(ui.text()).toContain("No answer means no");
  await click("Allow 2 h more");
  expect(calls.at(-1)).toEqual({ action: "extension", body: { token: "ext-token", allow: true } });
  ui.remount();
  await render();
  await click("Deny");
  expect(calls.at(-1)).toEqual({ action: "extension", body: { token: "ext-token", allow: false } });
});

test("requests that expired while access was off are listed and can be dismissed", async () => {
  state.missed = [{ id: "dr_old", action: "inspect", requestedBy: "night-session", reason: "the device did not fetch it in time", createdAt: Date.now() - 3_600_000, updatedAt: Date.now() - 3_000_000 }];
  await render();
  expect(ui.text()).toContain("1 request expired while access was off");
  expect(ui.text()).toContain("the device did not fetch it in time");
  await click("Dismiss");
  expect(calls.at(-1)).toEqual({ action: "dismiss-missed", body: {} });
});
