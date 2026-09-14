import { expect, test } from "bun:test";
import { liveActivityRegistration } from "../mobile/src/omg/live-activity-registration";

function fixture() {
  const calls: string[] = [];
  const errors: unknown[] = [];
  let listener: ((event: { activityId: string; pushToken: string }) => void) | undefined;
  let active = true;
  let foreground = true;
  let fail = false;
  const activity = {
    getId: () => "activity",
    getPushToken: async () => "update-token",
    addPushTokenListener: (fn: typeof listener) => { listener = fn; return { remove: () => calls.push("removed") }; },
  };
  const registration = liveActivityRegistration({
    getInstances: () => active ? [activity] : [],
    isForeground: () => foreground,
    registerDevice: async (token, hasActivity) => { calls.push(`device:${token}:${hasActivity}`); if (fail) throw new Error("offline"); },
    registerActivity: async (id, token) => { calls.push(`${id}:${token}`); },
    onError: (error) => errors.push(error),
  });
  return { registration, calls, errors, setActive: (value: boolean) => { active = value; }, setForeground: (value: boolean) => { foreground = value; }, setFail: (value: boolean) => { fail = value; }, emit: () => listener?.({ activityId: "activity", pushToken: "rotated" }) };
}

test("registers the device before reporting an existing activity", async () => {
  const f = fixture();
  await f.registration.onStartToken("start-token");
  expect(f.calls).toEqual(["device:start-token:true", "activity:update-token"]);
  f.registration.dispose();
});
test("foreground reopening reports no remaining activity with the cached start token", async () => {
  const f = fixture();
  await f.registration.onStartToken("start-token");
  f.setActive(false);
  await f.registration.refresh();
  expect(f.calls.slice(-2)).toEqual(["removed", "device:start-token:false"]);
});
test("background callbacks do not claim an authoritative empty foreground snapshot", async () => {
  const f = fixture(); f.setActive(false); f.setForeground(false);
  await f.registration.onStartToken("start-token");
  expect(f.calls).toEqual(["device:start-token:undefined"]);
});
test("a failed registration does not send an activity token and recovers on foreground", async () => {
  const f = fixture(); f.setFail(true);
  await f.registration.onStartToken("start-token");
  expect(f.calls).toEqual(["device:start-token:true"]);
  expect(f.errors).toHaveLength(1);
  f.setFail(false); await f.registration.refresh();
  expect(f.calls.at(-1)).toBe("activity:update-token");
  f.registration.dispose();
});
test("rotated tokens are registered and disposal stops further work", async () => {
  const f = fixture(); await f.registration.onStartToken("start-token");
  f.emit(); await f.registration.refresh();
  expect(f.calls).toContain("activity:rotated");
  f.registration.dispose(); const count = f.calls.length;
  f.emit(); await f.registration.refresh();
  expect(f.calls).toHaveLength(count);
});
