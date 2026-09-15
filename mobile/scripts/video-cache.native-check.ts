/**
 * Naming the downloaded copy of a video.
 *
 * The rule that matters is STABILITY: the same artifact seen twice has to hit
 * the same file, or every scroll past it re-downloads a video over a cellular
 * link.
 */
import { expect, test } from "bun:test";
import { videoCacheName } from "../src/omg/video-cache";

test("the same path always gives the same name", () => {
  const a = videoCacheName("/api/artifacts/abc/clip.mp4");
  expect(videoCacheName("/api/artifacts/abc/clip.mp4")).toBe(a);
});

test("different paths do not collide", () => {
  expect(videoCacheName("/api/artifacts/abc/clip.mp4")).not.toBe(
    videoCacheName("/api/artifacts/def/clip.mp4"),
  );
});

/**
 * AVPlayer picks a demuxer from the extension. A file called `x.bin` can fail
 * to open a video it would otherwise play.
 */
test("the real extension is kept", () => {
  expect(videoCacheName("/a/b/demo.mov")).toEndWith(".mov");
  expect(videoCacheName("/a/b/demo.webm")).toEndWith(".webm");
});

test("a path with no extension still gets a playable one", () => {
  expect(videoCacheName("/api/artifacts/abc/raw")).toEndWith(".mp4");
});

/** A name is going straight into a path, so nothing exotic may survive. */
test("nothing that could escape the cache directory survives", () => {
  const name = videoCacheName("/a/../../etc/pa th?q=1&x=/y.mp4");
  expect(name).not.toContain("/");
  expect(name).not.toContain("..");
  expect(name).not.toContain(" ");
  expect(name).not.toContain("?");
});

test("a very long name is bounded", () => {
  expect(videoCacheName(`/a/${"x".repeat(500)}.mp4`).length).toBeLessThan(80);
});
