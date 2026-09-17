import { afterEach, expect, mock, test } from "bun:test";
import type { PresenceRpc } from "../src/omg/presence";

const storage = new Map<string, string>();
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
  },
}));
const { startCloudPresence } = await import("../src/omg/presence");
const { wakeAfterPresence } = await import("../src/omg/cloud-startup");

const leases: ReturnType<typeof startCloudPresence>[] = [];
afterEach(() => { for (const lease of leases.splice(0)) lease.stop(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function start(handler: (name: string, body: any) => Promise<unknown>) {
  const lease = startCloudPresence(handler as PresenceRpc);
  leases.push(lease);
  return lease;
}

test("wake waits for the server to accept the same initial heartbeat", async () => {
  const received = deferred<void>();
  const reply = deferred<{ stale: boolean }>();
  let renewals = 0;
  let serverHasPresence = false;
  const lease = start(async (name) => {
    if (name !== "renewCloudComputerPresence") return {};
    renewals++;
    received.resolve();
    const result = await reply.promise;
    serverHasPresence = true;
    return result;
  });
  const wake = mock(async () => {
    expect(serverHasPresence).toBe(true);
    return { status: "live" };
  });
  const startup = wakeAfterPresence(lease, wake, () => true);
  await received.promise;
  expect(renewals).toBe(1);
  expect(wake).not.toHaveBeenCalled();
  reply.resolve({ stale: false });
  expect(await startup).toEqual({ status: "live" });
  expect(wake).toHaveBeenCalledTimes(1);
});

test("backgrounding releases the lease and prevents a pending wake", async () => {
  const received = deferred<void>();
  const reply = deferred<{ stale: boolean }>();
  const calls: { name: string; body: any }[] = [];
  const lease = start(async (name, body) => {
    calls.push({ name, body });
    if (name === "renewCloudComputerPresence") {
      received.resolve();
      return reply.promise;
    }
    return {};
  });
  let active = true;
  const wake = mock(async () => ({}));
  const startup = wakeAfterPresence(lease, wake, () => active);
  await received.promise;
  active = false;
  lease.stop();
  reply.resolve({ stale: false });
  expect(await startup).toBeUndefined();
  expect(wake).not.toHaveBeenCalled();
  expect(calls[1].name).toBe("releaseCloudComputerPresence");
  expect(calls[1].body.eventSeq).toBeGreaterThan(calls[0].body.eventSeq);
});

test("switching accounts while presence is pending prevents the old wake", async () => {
  const reply = deferred<boolean>();
  let current = true;
  const wake = mock(async () => ({}));
  const startup = wakeAfterPresence({ renew: () => reply.promise }, wake, () => current);
  current = false;
  reply.resolve(true);
  expect(await startup).toBeUndefined();
  expect(wake).not.toHaveBeenCalled();
});

test("a stale heartbeat cannot authorize wake; retry uses the new lease", async () => {
  const ids: string[] = [];
  const lease = start(async (name, body) => {
    if (name !== "renewCloudComputerPresence") return {};
    ids.push(body.leaseId);
    return { stale: ids.length === 1 };
  });
  const wake = mock(async () => ({ status: "live" }));
  await expect(wakeAfterPresence(lease, wake, () => true)).rejects.toThrow("Could not connect");
  expect(wake).not.toHaveBeenCalled();
  expect(await wakeAfterPresence(lease, wake, () => true)).toEqual({ status: "live" });
  expect(ids[0]).not.toBe(ids[1]);
});

test("failed presence does not enter wake or bootstrap polling and can be retried", async () => {
  let fail = true;
  const lease = start(async (name) => {
    if (name === "renewCloudComputerPresence" && fail) throw new Error("offline");
    return { stale: false };
  });
  const wake = mock(async () => ({ status: "live" }));
  await expect(wakeAfterPresence(lease, wake, () => true)).rejects.toThrow("Could not connect");
  expect(wake).not.toHaveBeenCalled();
  fail = false;
  expect(await wakeAfterPresence(lease, wake, () => true)).toEqual({ status: "live" });
});



test("first provisioning creates the Computer before attaching its presence lease", async () => {
  let exists = false;
  const events: string[] = [];
  const lease = start(async (name) => {
    if (name !== "renewCloudComputerPresence") return {};
    events.push(exists ? "presence accepted" : "missing Computer");
    if (!exists) throw new Error("cloud Computer has not been provisioned");
    return { stale: false };
  });
  const wake = mock(async () => {
    events.push("provision");
    exists = true;
    return { status: "live" };
  });
  expect(await wakeAfterPresence(lease, wake, () => true)).toEqual({ status: "live" });
  expect(events).toEqual(["missing Computer", "provision", "presence accepted"]);
  expect(wake).toHaveBeenCalledTimes(1);
});
