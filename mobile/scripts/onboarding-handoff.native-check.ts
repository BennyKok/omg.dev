/**
 * The answer has to outlive sign-in. Apple and Google hand off to a system
 * sheet or a browser and the process can be killed while the person is over
 * there, so this is storage, not a module variable.
 */
import { afterEach, expect, test } from "bun:test";
import { plugin } from "bun";

/**
 * An in-memory AsyncStorage. The real one reaches for `window` and this
 * harness has no DOM -- the same reason village-widget.native-check.ts stubs
 * PNG imports rather than loading them.
 */
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

const {
  HANDOFF_MAX_AGE_MS,
  stashOnboardingChoice,
  takeOnboardingChoice,
} = await import("../src/omg/onboarding-handoff");

afterEach(() => { store.clear(); });

test("a written prompt survives to be read once", async () => {
  await stashOnboardingChoice({ interest: "design", taskId: "design-ads", prompt: "Create 3 ad concepts" });
  const first = await takeOnboardingChoice();
  expect(first?.prompt).toBe("Create 3 ad concepts");
  expect(first?.interest).toBe("design");
  // Read ONCE. A prompt that survived a second launch would re-run somebody's
  // first task later, which is worse than losing it.
  expect(await takeOnboardingChoice()).toBeNull();
});

test("an empty prompt is not an answer and is never stashed", async () => {
  await stashOnboardingChoice({ interest: "design", taskId: null, prompt: "   " });
  expect(await takeOnboardingChoice()).toBeNull();
});

test("a stale handoff is thrown away rather than run", async () => {
  await stashOnboardingChoice({ interest: "code", taskId: "code-review", prompt: "Review this" });
  const later = Date.now() + HANDOFF_MAX_AGE_MS + 1000;
  expect(await takeOnboardingChoice(later)).toBeNull();
});

test("a handoff inside the window still runs", async () => {
  await stashOnboardingChoice({ interest: "code", taskId: "code-review", prompt: "Review this" });
  expect((await takeOnboardingChoice(Date.now() + 60_000))?.prompt).toBe("Review this");
});

test("corrupt storage clears itself instead of throwing on launch", async () => {
  store.set("omg.onboarding.handoff.v1", "{not json");
  expect(await takeOnboardingChoice()).toBeNull();
  expect(await takeOnboardingChoice()).toBeNull();
});
