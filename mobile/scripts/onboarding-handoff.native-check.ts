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
  hasOnboardingChoice,
  stashOnboardingChoice,
  takeOnboardingChoice,
} = await import("../src/omg/onboarding-handoff");

afterEach(() => { store.clear(); });

test("a written prompt survives to be read once", async () => {
  await stashOnboardingChoice({ interest: "slides", taskId: "slides", prompt: "Create 3 ad concepts" });
  const first = await takeOnboardingChoice();
  expect(first?.prompt).toBe("Create 3 ad concepts");
  expect(first?.interest).toBe("slides");
  // Read ONCE. A prompt that survived a second launch would re-run somebody's
  // first task later, which is worse than losing it.
  expect(await takeOnboardingChoice()).toBeNull();
});

test("an empty prompt is not an answer and is never stashed", async () => {
  await stashOnboardingChoice({ interest: "slides", taskId: null, prompt: "   " });
  expect(await takeOnboardingChoice()).toBeNull();
});

test("a stale handoff is thrown away rather than run", async () => {
  await stashOnboardingChoice({ interest: "app", taskId: "app", prompt: "Review this" });
  const later = Date.now() + HANDOFF_MAX_AGE_MS + 1000;
  expect(await takeOnboardingChoice(later)).toBeNull();
});

test("a handoff inside the window still runs", async () => {
  await stashOnboardingChoice({ interest: "app", taskId: "app", prompt: "Review this" });
  expect((await takeOnboardingChoice(Date.now() + 60_000))?.prompt).toBe("Review this");
});

test("corrupt storage clears itself instead of throwing on launch", async () => {
  store.set("omg.onboarding.handoff.v1", "{not json");
  expect(await takeOnboardingChoice()).toBeNull();
  expect(await takeOnboardingChoice()).toBeNull();
});

/**
 * The peek exists so an account with nothing to run is not parked on a splash
 * while the caller waits out its ceiling for a Computer. It must answer the
 * same question `take` does, and it must NOT consume.
 */
test("asking whether there is a handoff does not consume it", async () => {
  await stashOnboardingChoice({ interest: "sales", taskId: null, prompt: "Draft a follow-up" });
  expect(await hasOnboardingChoice()).toBe(true);
  expect(await hasOnboardingChoice()).toBe(true);
  expect((await takeOnboardingChoice())?.prompt).toBe("Draft a follow-up");
  expect(await hasOnboardingChoice()).toBe(false);
});

test("the peek agrees with the read about stale and corrupt entries", async () => {
  await stashOnboardingChoice({ interest: "data", taskId: null, prompt: "Chart this" });
  expect(await hasOnboardingChoice(Date.now() + HANDOFF_MAX_AGE_MS + 1000)).toBe(false);
  store.set("omg.onboarding.handoff.v1", "{not json");
  expect(await hasOnboardingChoice()).toBe(false);
});
