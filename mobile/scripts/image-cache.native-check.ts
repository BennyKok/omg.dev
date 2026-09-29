import { describe, expect, test } from "bun:test";
import { imageCacheName } from "../src/omg/image-cache";

describe("imageCacheName", () => {
  test("uses the content type when the path has no extension", () => {
    expect(imageCacheName("/api/artifacts/abc123", "image/jpeg")).toBe("abc123.jpg");
    expect(imageCacheName("/api/artifacts/abc123", "image/png; charset=binary")).toBe("abc123.png");
  });
  test("falls back to the path extension, then png", () => {
    expect(imageCacheName("/uploads/shot.WEBP", null)).toBe("shot.webp");
    expect(imageCacheName("/api/artifacts/abc", "application/octet-stream")).toBe("abc.png");
  });
  test("makes the stem filesystem safe", () => {
    expect(imageCacheName("/uploads/my shot (1).png", "image/png")).toBe("my-shot--1-.png");
    expect(imageCacheName("/", null)).toBe("image.png");
  });
});
