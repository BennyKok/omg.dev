import { describe, expect, test } from "bun:test";
import {
  AISDK_STREAM_STALL_MS,
  InputChannel,
  isAisdkStreamStalled,
} from "./aisdk-session.ts";

const BASE = 1_000_000;

describe("Claude Agent SDK stream stall detection", () => {
  test("fires only when an active turn reaches the silence bound", () => {
    expect(isAisdkStreamStalled({
      busy: true,
      closing: false,
      restartRequested: false,
      lastSdkEventAt: BASE,
      now: BASE + AISDK_STREAM_STALL_MS,
    })).toBe(true);
  });

  test("stays quiet while SDK events keep arriving", () => {
    expect(isAisdkStreamStalled({
      busy: true,
      closing: false,
      restartRequested: false,
      lastSdkEventAt: BASE + AISDK_STREAM_STALL_MS - 1,
      now: BASE + AISDK_STREAM_STALL_MS,
    })).toBe(false);
  });

  test("never fires while idle, closing, or already restarting", () => {
    const common = {
      lastSdkEventAt: BASE,
      now: BASE + AISDK_STREAM_STALL_MS * 2,
    };
    expect(isAisdkStreamStalled({
      ...common,
      busy: false,
      closing: false,
      restartRequested: false,
    })).toBe(false);
    expect(isAisdkStreamStalled({
      ...common,
      busy: true,
      closing: true,
      restartRequested: false,
    })).toBe(false);
    expect(isAisdkStreamStalled({
      ...common,
      busy: true,
      closing: false,
      restartRequested: true,
    })).toBe(false);
  });

  test("can detect another stall after the replacement runtime starts", () => {
    expect(isAisdkStreamStalled({
      busy: true,
      closing: false,
      restartRequested: false,
      lastSdkEventAt: BASE + AISDK_STREAM_STALL_MS,
      now: BASE + AISDK_STREAM_STALL_MS * 2,
    })).toBe(true);
  });
});

describe("Claude Agent SDK input handoff", () => {
  test("moves buffered follow-ups without replaying the in-flight prompt", async () => {
    const previous = new InputChannel();
    const previousIterator = previous[Symbol.asyncIterator]();
    previous.push("already handed to the old query");
    const inFlight = await previousIterator.next();
    previous.push("still buffered");

    const replacement = new InputChannel();
    previous.handoffTo(replacement);
    replacement.push("sent during restart");

    expect(inFlight.value?.message.content).toBe("already handed to the old query");
    expect((await previousIterator.next()).done).toBe(true);
    const replacementIterator = replacement[Symbol.asyncIterator]();
    expect((await replacementIterator.next()).value?.message.content).toBe("still buffered");
    expect((await replacementIterator.next()).value?.message.content).toBe("sent during restart");
  });
});
