import { afterEach, describe, expect, test } from "bun:test";
import {
  addVisibleTranscriptSid,
  nextVisibleTranscripts,
  removeVisibleTranscriptSid,
  resetVisibleTranscriptsForTest,
  visibleTranscriptSids,
} from "./visible-transcripts";

afterEach(() => resetVisibleTranscriptsForTest());

describe("visible transcripts", () => {
  test("a surface is on screen only while it is registered", () => {
    addVisibleTranscriptSid("a");
    addVisibleTranscriptSid("b");
    expect(visibleTranscriptSids()).toEqual(["a", "b"]);

    // Closing a column deregisters it. This is the whole difference with the
    // `lfg-collapsed:` key, which the stage writes and never takes back.
    removeVisibleTranscriptSid("a");
    expect(visibleTranscriptSids()).toEqual(["b"]);
  });

  test("registering twice still leaves one entry to remove", () => {
    addVisibleTranscriptSid("a");
    addVisibleTranscriptSid("a");
    removeVisibleTranscriptSid("a");
    expect(visibleTranscriptSids()).toEqual([]);
  });

  test("an empty id is not a surface", () => {
    addVisibleTranscriptSid("");
    expect(visibleTranscriptSids()).toEqual([]);
  });

  test("the snapshot is sorted, so two equal sets compare equal by order", () => {
    addVisibleTranscriptSid("b");
    addVisibleTranscriptSid("a");
    expect(visibleTranscriptSids()).toEqual(["a", "b"]);
  });

  test("an unchanged set keeps its array identity", () => {
    const previous = ["a", "b"];
    // Same contents, different array: the effect that depends on this must not
    // re-run just because something else re-rendered.
    expect(nextVisibleTranscripts(previous, ["a", "b"])).toBe(previous);
    expect(nextVisibleTranscripts(previous, ["a"])).toEqual(["a"]);
    expect(nextVisibleTranscripts(previous, ["a", "c"])).toEqual(["a", "c"]);
  });

  test("removing something that was never there changes nothing", () => {
    addVisibleTranscriptSid("a");
    removeVisibleTranscriptSid("nope");
    expect(visibleTranscriptSids()).toEqual(["a"]);
  });
});
