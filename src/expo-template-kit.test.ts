import { describe, expect, test } from "bun:test";
import { isEphemeralUri, toPersistentImage } from "../agents/templates/expo/src/kit/image";
import { pushOverlay, removeOverlay } from "../agents/templates/expo/src/kit/overlay-core";
import {
  formatClock, idleTimer, isFinished, loadTimer, pauseTimer, remainingMs, resumeTimer, saveTimer, startTimer,
  type KeyValueStore,
} from "../agents/templates/expo/src/kit/timer-core";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}

describe("expo kit timer", () => {
  test("pause keeps the remaining time and resume continues from it", () => {
    let t = startTimer(idleTimer(60_000), 1_000);
    expect(remainingMs(t, 11_000)).toBe(50_000);
    t = pauseTimer(t, 11_000);
    expect(remainingMs(t, 999_999)).toBe(50_000);
    t = resumeTimer(t, 100_000);
    expect(remainingMs(t, 110_000)).toBe(40_000);
    expect(isFinished(t, 150_000)).toBe(true);
  });

  test("a running timer survives a reload and keeps counting real time", async () => {
    const store = memoryStore();
    await saveTimer(store, "k", startTimer(idleTimer(60_000), 1_000));
    const reloaded = await loadTimer(store, "k", 5);
    expect(reloaded.status).toBe("running");
    expect(remainingMs(reloaded, 31_000)).toBe(30_000);
  });

  test("a paused timer survives a reload", async () => {
    const store = memoryStore();
    await saveTimer(store, "k", pauseTimer(startTimer(idleTimer(60_000), 0), 20_000));
    expect(remainingMs(await loadTimer(store, "k", 5), 9e9)).toBe(40_000);
  });

  test("bad or missing storage gives an idle timer", async () => {
    const store = memoryStore();
    expect((await loadTimer(store, "k", 7)).status).toBe("idle");
    store.data.set("k", "{nope");
    expect(await loadTimer(store, "k", 7)).toEqual(idleTimer(7));
    store.data.set("k", JSON.stringify({ status: "running", durationMs: 5 }));
    expect(await loadTimer(store, "k", 7)).toEqual(idleTimer(7));
  });

  test("formatClock rounds up", () => {
    expect(formatClock(1_500)).toBe("0:02");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(25 * 60_000)).toBe("25:00");
  });
});

describe("expo kit image persistence", () => {
  const deps = { readAsDataUrl: async (uri: string) => `data:image/png;base64,READ(${uri})` };

  test("uses picker base64 without reading the uri", async () => {
    const url = await toPersistentImage({ uri: "blob:http://x/1", base64: "AAAA", mimeType: "image/png" }, deps);
    expect(url).toBe("data:image/png;base64,AAAA");
  });

  test("reads a blob uri into a data url", async () => {
    expect(await toPersistentImage("blob:http://x/1", deps)).toBe("data:image/png;base64,READ(blob:http://x/1)");
  });

  test("keeps a data url as is and rejects oversized images", async () => {
    expect(await toPersistentImage("data:image/png;base64,Zm9v", deps)).toBe("data:image/png;base64,Zm9v");
    await expect(toPersistentImage({ uri: "x", base64: "A".repeat(50) }, deps, 10)).rejects.toThrow("too large");
  });

  test("flags blob uris as ephemeral", () => {
    expect(isEphemeralUri("blob:http://x/1")).toBe(true);
    expect(isEphemeralUri("data:image/png;base64,AA")).toBe(false);
  });
});

describe("expo kit overlay stack", () => {
  test("closing the top item reveals the previous one", () => {
    let s = pushOverlay([], { id: 1, content: "a" }, false);
    s = pushOverlay(s, { id: 2, content: "b" }, false);
    expect(s[s.length - 1]?.id).toBe(2);
    s = removeOverlay(s, 2);
    expect(s[s.length - 1]?.id).toBe(1);
  });
  test("replace swaps the top item", () => {
    const s = pushOverlay(pushOverlay([], { id: 1, content: "a" }, false), { id: 2, content: "b" }, true);
    expect(s.map((i) => i.id)).toEqual([2]);
  });
});
