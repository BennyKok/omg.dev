import { describe, expect, test } from "bun:test";
import { validTranscriptView } from "./settings.ts";

describe("global transcript view setting", () => {
  test("accepts only the two persisted view modes", () => {
    expect(validTranscriptView("full")).toBe(true);
    expect(validTranscriptView("user-lfg-output")).toBe(true);
    expect(validTranscriptView("focused")).toBe(false);
    expect(validTranscriptView(true)).toBe(false);
  });
});

describe("persistence", () => {
  // setGlobalSettings writes an explicit key list rather than iterating the
  // object, so a new setting sanitizes into the response and is silently never
  // stored — the POST looks like it worked and the next GET shows the old
  // value. This asserts every field of GlobalSettings is actually written.
  //
  // This guard covers every setting, so it lives here rather than beside any one
  // of them. It arrived with the mDNS toggle and outlived it: when that feature
  // was removed its test file went too, and this came here instead of going with
  // it.
  test("every setting key is persisted, not just returned", async () => {
    const source = await Bun.file(new URL("./settings.ts", import.meta.url)).text();
    const typeBlock = source.slice(
      source.indexOf("export type GlobalSettings = {"),
      source.indexOf("};", source.indexOf("export type GlobalSettings = {")),
    );
    const fields = [...typeBlock.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(0);

    const writer = source.slice(source.indexOf("database.transaction("), source.indexOf("})();"));
    for (const field of fields) {
      expect(writer, `${field} is never written by setGlobalSettings`).toContain(`write.run("${field}"`);
    }
  });

  // The sibling hole, one layer up, and the one that actually shipped:
  // POST /api/settings builds its patch from an explicit per-field whitelist,
  // so a setting with no branch is dropped from the request body before
  // setGlobalSettings ever sees it. The failure is completely silent — the
  // handler answers 200 with the UNCHANGED settings, the client writes those
  // back into state so the control snaps back to its old value, and the success
  // toast still fires because nothing threw.
  //
  // That is exactly how idleAgentArchiveMinutes ("Archive idle agents after")
  // spent its whole life doing nothing: the UI saved, cheerfully confirmed, and
  // reverted, and the sweep read 0 forever. The test above could not catch it,
  // because the value was already correct by the time it reached the writer.
  test("every setting key is accepted by POST /api/settings", async () => {
    const settingsSource = await Bun.file(new URL("./settings.ts", import.meta.url)).text();
    const typeBlock = settingsSource.slice(
      settingsSource.indexOf("export type GlobalSettings = {"),
      settingsSource.indexOf("};", settingsSource.indexOf("export type GlobalSettings = {")),
    );
    const fields = [...typeBlock.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(0);

    const serveSource = await Bun.file(
      new URL("./commands/serve.ts", import.meta.url),
    ).text();
    const routeStart = serveSource.indexOf('if (path === "/api/settings") {');
    expect(routeStart).toBeGreaterThan(-1);
    const handler = serveSource.slice(
      routeStart,
      serveSource.indexOf("const settings = await setGlobalSettings(patch);", routeStart),
    );

    for (const field of fields) {
      expect(
        handler,
        `${field} has no branch in POST /api/settings, so saving it is a silent no-op`,
      ).toContain(`patch.${field} =`);
    }
  });
});
