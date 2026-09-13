import { describe, expect, test } from "bun:test";
import {
  createPromptStash,
  stashScope,
} from "../mobile/src/omg/prompt-stash-store";
const a = { context: "session:a", sessionId: "a", title: "A" };
const b = { context: "session:b", sessionId: "b", title: "B" };
function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      data.set(k, v);
    },
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
describe("native prompt stash", () => {
  test("keeps independent drafts when switching sessions and restarting", async () => {
    const disk = storage(),
      stash = createPromptStash(disk, "scope");
    await stash.ready;
    stash.set(a, "alpha");
    stash.set(b, "beta");
    await stash.flush();
    const reopened = createPromptStash(disk, "scope");
    await reopened.ready;
    expect(reopened.text("session:a")).toBe("alpha");
    expect(reopened.text("session:b")).toBe("beta");
  });
  test("isolates the same session ID across accounts and Computers", async () => {
    const disk = storage();
    const first = createPromptStash(disk, stashScope("one", "mac"));
    first.set(a, "secret");
    await first.flush();
    for (const scope of [
      stashScope("two", "mac"),
      stashScope("one", "linux"),
    ]) {
      const other = createPromptStash(disk, scope);
      await other.ready;
      expect(other.text(a.context)).toBe("");
    }
  });
  test("a late disk read cannot replace new typing or resurrect a cleared draft", async () => {
    const read = deferred<string | null>();
    const disk = storage();
    const stash = createPromptStash(
      { ...disk, getItem: () => read.promise },
      "scope",
    );
    stash.set(a, "new");
    stash.set(b, "");
    read.resolve(
      JSON.stringify([
        { ...a, id: "a", text: "old", status: "draft", updatedAt: 1 },
        { ...b, id: "b", text: "old", status: "draft", updatedAt: 1 },
      ]),
    );
    await stash.flush();
    expect(stash.text(a.context)).toBe("new");
    expect(stash.text(b.context)).toBe("");
  });
  test("persists removal and retains successful sends only in history", async () => {
    const disk = storage(),
      stash = createPromptStash(disk, "scope");
    await stash.ready;
    stash.set(a, "send me");
    const id = stash.stage(a, "send me");
    expect(stash.text(a.context)).toBe("");
    stash.finish(id, "sent");
    await stash.flush();
    const reopened = createPromptStash(disk, "scope");
    await reopened.ready;
    expect(reopened.text(a.context)).toBe("");
    expect(reopened.snapshot()[0].text).toBe("send me");
    reopened.remove(id);
    await reopened.flush();
    const empty = createPromptStash(disk, "scope");
    await empty.ready;
    expect(empty.snapshot()).toEqual([]);
  });
  test("failed send restores its text without replacing a newer draft", async () => {
    const stash = createPromptStash(storage(), "scope");
    await stash.ready;
    const id = stash.stage(a, "failed");
    stash.finish(id, "failed");
    expect(stash.text(a.context)).toBe("failed");
    const again = stash.stage(a, "failed");
    stash.set(a, "next thought");
    stash.finish(again, "failed");
    expect(stash.text(a.context)).toBe("next thought");
    expect(stash.snapshot().some((e) => e.text === "failed")).toBe(true);
  });
  test("an interrupted send is recovered after restart and never resent automatically", async () => {
    const disk = storage(),
      stash = createPromptStash(disk, "scope");
    await stash.ready;
    stash.stage(a, "interrupted");
    await stash.flush();
    const reopened = createPromptStash(disk, "scope");
    await reopened.ready;
    expect(reopened.text(a.context)).toBe("interrupted");
    expect(reopened.snapshot()[0].status).toBe("failed");
  });
  test("sending a quick answer preserves an unrelated composer draft", async () => {
    const stash = createPromptStash(storage(), "scope");
    await stash.ready;
    stash.set(a, "my next task");
    const id = stash.stage(a, "Yes");
    stash.finish(id, "sent");
    expect(stash.text(a.context)).toBe("my next task");
  });
  test("serializes disk writes so a slow older write cannot win", async () => {
    const gate = deferred<void>();
    const disk = storage();
    let calls = 0;
    const stash = createPromptStash(
      {
        ...disk,
        setItem: async (k, v) => {
          if (++calls === 1) await gate.promise;
          await disk.setItem(k, v);
        },
      },
      "scope",
    );
    await stash.ready;
    stash.set(a, "old");
    await Promise.resolve();
    stash.set(a, "latest");
    gate.resolve();
    await stash.flush();
    const reopened = createPromptStash(disk, "scope");
    await reopened.ready;
    expect(reopened.text(a.context)).toBe("latest");
  });
  test("corrupt or unavailable storage does not stop typing", async () => {
    for (const getItem of [
      async () => "{bad",
      async () => {
        throw Error("offline");
      },
    ]) {
      const stash = createPromptStash(
        {
          getItem,
          setItem: async () => {
            throw Error("full");
          },
        },
        "scope",
      );
      await stash.ready;
      stash.set(a, "still here");
      await stash.flush();
      expect(stash.text(a.context)).toBe("still here");
    }
  });
  test("bounds retained history", async () => {
    const stash = createPromptStash(storage(), "scope");
    await stash.ready;
    for (let i = 0; i < 100; i++) {
      const id = stash.stage(a, "message " + i);
      stash.finish(id, "sent");
    }
    expect(stash.snapshot()).toHaveLength(80);
  });
});
