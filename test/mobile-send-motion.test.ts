import { expect, test } from "bun:test";
import { remainingReplySpace, sendOriginTransform, sendTargetOffset } from "../mobile/src/omg/send-motion-layout";

test("reply fills the reserved space before extending the transcript", () => {
  expect(remainingReplySpace(320, [])).toBe(320);
  expect(remainingReplySpace(320, [24, 80, 120])).toBe(96);
  expect(remainingReplySpace(320, [24, 80, 240])).toBe(0);
  // A streaming work row can become a shorter completed row.
  expect(remainingReplySpace(320, [24, 40])).toBe(256);
});

test("morph starts at the measured input rectangle for short and multiline text", () => {
  const source = { x: 12, y: 480, width: 378, height: 66 };
  for (const target of [
    { x: 270, y: 550, width: 116, height: 34 },
    { x: 72, y: 550, width: 314, height: 140 },
  ]) {
    const transform = sendOriginTransform(source, target);
    expect(target.width * transform.scaleX).toBeCloseTo(source.width);
    expect(target.height * transform.scaleY).toBeCloseTo(source.height);
    expect(target.x + target.width / 2 + transform.translateX).toBe(source.x + source.width / 2);
    expect(target.y + target.height / 2 + transform.translateY).toBe(source.y + source.height / 2);
  }
});

test("reply growth preserves the send target until the reserved space is full", () => {
  const base = { naturalHeight: 3000, rowTotal: 2800, bottomPadding: 120 };
  const target = (replyHeight: number) => sendTargetOffset(base, 2860 + replyHeight, 30,
    remainingReplySpace(340, [30, replyHeight]), 874);
  expect(target(0)).toBe(target(100));
  expect(target(100)).toBe(target(310));
  expect(target(410) - target(310)).toBe(100);
  expect(sendTargetOffset({ naturalHeight: 80, rowTotal: 0, bottomPadding: 100 }, 40, 0, 340, 874)).toBe(0);
});
