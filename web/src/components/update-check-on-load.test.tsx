import { afterEach, expect, test } from "bun:test";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "@/lib/omg-client";
import { mount, type Mounted } from "../test-support/render";
import { UpdateProvider, UpdateSettingsRow } from "./update-drawer";

// Inside omg.dev the platform updates the Computer and the update button is
// hidden, yet every page load asked /api/install, which asks GitHub. After a
// wake that call waited on the network while the first screen loaded.
// Failures this must catch: a hosted load that still checks; a standalone
// load that stops checking; a Settings row that never learns the status.
const calls: string[] = [];
const fakeFetch = async (input: RequestInfo | URL) => {
  calls.push(new URL(String(input), "http://box.test").pathname);
  return Response.json({ install: { channel: "release" }, update: null });
};

let ui: Mounted;
afterEach(() => {
  ui?.cleanup();
  calls.length = 0;
  configureOmgTransport(createSameOriginTransport());
});

const settings = { skippedUpdateVersion: "", autoUpdateEnabled: false };
const tree = (checkOnLoad: boolean, row = false) => (
  <UpdateProvider settings={settings} onSettingsChange={async () => {}} checkOnLoad={checkOnLoad}>
    {row ? <UpdateSettingsRow /> : null}
  </UpdateProvider>
);
const settle = () => new Promise((r) => setTimeout(r, 20));

test("a standalone load checks for an update", async () => {
  configureOmgTransport(createSameOriginTransport({ fetch: fakeFetch as typeof globalThis.fetch }));
  ui = mount();
  ui.render(tree(true));
  await settle();
  expect(calls).toEqual(["/api/install"]);
});

test("a hosted load does not check until the Settings row is shown", async () => {
  configureOmgTransport(createSameOriginTransport({ fetch: fakeFetch as typeof globalThis.fetch }));
  ui = mount();
  ui.render(tree(false));
  await settle();
  expect(calls).toEqual([]);
  ui.render(tree(false, true));
  await settle();
  expect(calls).toEqual(["/api/install"]);
});
