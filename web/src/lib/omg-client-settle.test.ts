import { afterEach, expect, test } from "bun:test";
import { createSameOriginTransport, type OmgTransport } from "@omg-dev/client";
import { api, configureOmgTransport, settlePendingOmgReads } from "./omg-client";

afterEach(() => configureOmgTransport(createSameOriginTransport()));

const within = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => "settled"), new Promise((resolve) => setTimeout(() => resolve("waiting"), ms))]);

test("a list refresh waits for a read in flight on this Computer", async () => {
  let answer!: () => void;
  configureOmgTransport({ request: () => new Promise((resolve) => (answer = () => resolve({}))) } as unknown as OmgTransport);
  const read = api("/api/threads");
  expect(await within(settlePendingOmgReads(), 50)).toBe("waiting");
  answer();
  await read;
  expect(await within(settlePendingOmgReads(), 50)).toBe("settled");
});

test("a swap to another Computer stops waiting for the old one's reads", async () => {
  // The old box never answers.
  configureOmgTransport({ request: () => new Promise(() => {}) } as unknown as OmgTransport);
  void api("/api/threads").catch(() => {});
  configureOmgTransport({ request: async () => ({}) } as unknown as OmgTransport);
  expect(await within(settlePendingOmgReads(), 50)).toBe("settled");
});
