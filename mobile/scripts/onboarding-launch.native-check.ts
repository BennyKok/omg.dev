/**
 * The join between the two halves of the revamp: a prompt collected before
 * sign-in, run after. The ordering rules here are the ones that decide whether
 * somebody's first task survives.
 */
import { afterEach, expect, test } from "bun:test";
import { plugin } from "bun";

const store = new Map<string, string>();
plugin({
  name: "async-storage-stub",
  setup(build) {
    build.module("@react-native-async-storage/async-storage", () => ({
      exports: {
        default: {
          getItem: async (k: string) => store.get(k) ?? null,
          setItem: async (k: string, v: string) => void store.set(k, v),
          removeItem: async (k: string) => void store.delete(k),
          clear: async () => void store.clear(),
        },
      },
      loader: "object",
    }));
  },
});

const { stashOnboardingChoice } = await import("../src/omg/onboarding-handoff");
const { launchOnboardingTask } = await import("../src/omg/onboarding-launch");

afterEach(() => { store.clear(); });

const clientThat = (reply: unknown, throws?: string) => ({
  transport: {
    request: async () => {
      if (throws) throw new Error(throws);
      return reply;
    },
  },
}) as never;

const stash = () =>
  stashOnboardingChoice({ interest: "design", taskId: "design-ads", prompt: "Create 3 ad concepts" });

/**
 * THE ORDER MATTERS. Reading consumes, so readiness is checked first --
 * otherwise the very first render after sign-in, when the client is reliably
 * still null, would eat the prompt and report nothing wrong.
 */
test("asking too early does not consume the prompt", async () => {
  await stash();
  expect(await launchOnboardingTask(null, false)).toEqual({ kind: "not-ready" });
  expect(await launchOnboardingTask(null, true)).toEqual({ kind: "not-ready" });
  // Still there for the attempt that can actually act on it.
  const ok = await launchOnboardingTask(clientThat({ sessionId: "s-1" }), true);
  expect(ok).toEqual({ kind: "started", sessionId: "s-1", prompt: "Create 3 ad concepts" });
});

test("a started task is only started once", async () => {
  await stash();
  expect((await launchOnboardingTask(clientThat({ sessionId: "s-1" }), true)).kind).toBe("started");
  expect(await launchOnboardingTask(clientThat({ sessionId: "s-2" }), true)).toEqual({ kind: "nothing" });
});

test("everybody who is not a new arrival gets nothing, quietly", async () => {
  expect(await launchOnboardingTask(clientThat({ sessionId: "s-1" }), true)).toEqual({ kind: "nothing" });
});

/** A failure names the prompt, because the stash is gone and the words would
 *  otherwise vanish with no way to offer them back. */
test("a failed launch reports the prompt rather than dropping it", async () => {
  await stash();
  const out = await launchOnboardingTask(clientThat(null, "Computer unreachable"), true);
  expect(out).toEqual({ kind: "failed", prompt: "Create 3 ad concepts", error: "Computer unreachable" });
});

test("a reply with no session id is a failure, not a success", async () => {
  await stash();
  const out = await launchOnboardingTask(clientThat({}), true);
  expect(out.kind).toBe("failed");
  if (out.kind === "failed") expect(out.prompt).toBe("Create 3 ad concepts");
});
