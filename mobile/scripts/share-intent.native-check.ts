/**
 * A share from another app arrives as `omg:///share?id=&url=&text=` from the
 * Share Extension (plugins/with-share-extension.js). This is the rule that
 * reads it and the first message the new session gets.
 */
import { expect, test } from "bun:test";
import { isSharePath, sharedContent, sharePrompt } from "../src/omg/share-intent";
import { systemPathTarget } from "../src/omg/system-path";

const YT = "https://youtu.be/dQw4w9WgXcQ?si=abc";
const shared = (q: Record<string, string>) => `omg:///share?${new URLSearchParams(q)}`;

test("a YouTube share becomes a prompt that asks the agent to watch it", () => {
  const content = sharedContent(shared({ id: "A1", url: YT }));
  expect(content).toEqual({ id: "A1", url: YT, text: undefined });
  const prompt = sharePrompt(content!);
  expect(prompt).toContain(YT);
  expect(prompt).toContain("read it or watch it");
});

test("text that only repeats the link is dropped; other text is kept", () => {
  expect(sharedContent(shared({ id: "A", url: YT, text: YT }))?.text).toBeUndefined();
  const content = sharedContent(shared({ id: "A", url: YT, text: "Never Gonna Give You Up" }))!;
  expect(sharePrompt(content)).toContain("Never Gonna Give You Up");
});

test("text alone is accepted and asks the agent to read it", () => {
  const content = sharedContent(shared({ id: "A", text: "a note" }))!;
  expect(content.url).toBeUndefined();
  expect(sharePrompt(content)).toContain("a note");
});

test("long text is capped", () => {
  const content = sharedContent(shared({ id: "A", text: "x".repeat(10_000) }))!;
  expect(content.text!.length).toBeLessThan(4100);
});

test("a share with no id or no content is ignored", () => {
  expect(sharedContent(shared({ url: YT }))).toBeNull();
  expect(sharedContent(shared({ id: "A" }))).toBeNull();
  expect(sharedContent("omg:///session/abc")).toBeNull();
  expect(sharedContent(null)).toBeNull();
});

test("expo-router never routes a share, and other links are unchanged", () => {
  for (const url of [shared({ id: "A", url: YT }), "omg://share?id=A&url=x", "omg:///share/"]) {
    expect(isSharePath(url)).toBe(true);
    expect(systemPathTarget(url)).toBeNull();
  }
  expect(isSharePath("omg:///session/share")).toBe(false);
  expect(systemPathTarget("omg:///session/abc")).toBe("omg:///session/abc");
});
