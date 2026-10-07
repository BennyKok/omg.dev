/**
 * Meta conversions count once, and only for the right person.
 *
 * A doubled purchase or sign-up makes Meta optimise ad spend against a lie,
 * and a build without the SDK must never try to reach it.
 */
import { beforeEach, expect, mock, test } from "bun:test";

mock.module("react-native", () => ({ Platform: { OS: "ios" }, NativeModules: {} }));
mock.module("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
mock.module("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}));

const meta = await import("../src/omg/meta-events");

type Call = [string, ...unknown[]];
let calls: Call[];
let store: Map<string, string>;

beforeEach(() => {
  calls = [];
  store = new Map();
  meta.setMetaTarget(
    {
      logEvent: (name, params) => void calls.push(["event", name, params]),
      logPurchase: (amount, currency, params) => void calls.push(["purchase", amount, currency, params]),
      requestTracking: async () => void calls.push(["tracking"]),
    },
    { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => void store.set(k, v) },
  );
});

test("a new account is a registration, once, after the tracking prompt", async () => {
  const user = { id: "u1", createdAt: new Date().toISOString() };
  await meta.noteSignedIn(user);
  await meta.noteSignedIn(user);
  expect(calls).toEqual([
    ["tracking"],
    ["event", "fb_mobile_complete_registration", {}],
    ["tracking"],
  ]);
});

test("a returning account is not a registration", async () => {
  await meta.noteSignedIn({ id: "u2", createdAt: "2020-01-01T00:00:00Z" });
  await meta.noteSignedIn({ id: "u3" });
  expect(calls.filter((c) => c[0] === "event")).toEqual([]);
});

test("a purchase is counted once per StoreKit transaction, with Apple's price", async () => {
  const purchase = { productId: "computer_s40", signedTransaction: "jws", raw: { transactionId: "t1" }, price: 19, currency: "USD" };
  await meta.notePurchase(purchase);
  await meta.notePurchase(purchase);
  await meta.notePurchase({ ...purchase, raw: { transactionId: "t2" }, price: undefined, currency: undefined });
  expect(calls).toEqual([
    ["purchase", 19, "USD", { fb_content_id: "computer_s40", fb_content_type: "subscription", fb_order_id: "t1" }],
    ["purchase", 0, "USD", { fb_content_id: "computer_s40", fb_content_type: "subscription", fb_order_id: "t2" }],
  ]);
});

test("the first task is counted once", async () => {
  await meta.noteFirstTaskStarted();
  await meta.noteFirstTaskStarted();
  expect(calls).toEqual([["event", "first_run_task_started", {}]]);
});

test("a build without Meta sends nothing", async () => {
  meta.setMetaTarget(undefined);
  await meta.noteSignedIn({ id: "u4", createdAt: new Date().toISOString() });
  await meta.notePurchase({ productId: "p", signedTransaction: "jws", raw: {} });
  await meta.noteFirstTaskStarted();
  expect(calls).toEqual([]);
  expect(store.size).toBe(0);
});
