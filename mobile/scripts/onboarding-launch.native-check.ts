/**
 * The join between the two halves of the revamp: a prompt collected before
 * sign-in, run after. The ordering rules here are the ones that decide whether
 * somebody's first task survives.
 */
import { afterEach, expect, mock, test } from "bun:test";
import { plugin } from "bun";

const store = new Map<string, string>();
/** Every file the fake Computer was asked to store, in order. */
const uploaded: { endpoint: string; mimeType: string }[] = [];
let uploadFails = false;
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

/*
 * The real uploader needs a transport and a Computer. What matters here is the
 * ORDER and the endpoint, so it is replaced. `mock.module` and not the plugin
 * above, because a bun virtual module cannot have a relative specifier.
 */
await mock.module("../src/omg/attachment-upload", () => ({
  uploadAttachment: async (_t: unknown, endpoint: string, _b: unknown, mimeType: string) => {
    if (uploadFails) throw new Error("Computer refused the upload");
    uploaded.push({ endpoint, mimeType });
    return `/tmp/lfg-uploads/${decodeURIComponent(endpoint.split("filename=")[1] ?? "x")}`;
  },
}));

const { stashOnboardingChoice } = await import("../src/omg/onboarding-handoff");
const { launchOnboardingTask } = await import("../src/omg/onboarding-launch");

afterEach(() => { store.clear(); uploaded.length = 0; uploadFails = false; });

// The launch reads a local file:// URI into a Blob before uploading it.
globalThis.fetch = (async () => ({ blob: async () => new Blob(["bytes"]) })) as never;

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
  expect(ok).toEqual({ kind: "started", sessionId: "s-1", prompt: "Create 3 ad concepts", interest: "design" });
});

/**
 * The lane rides across sign-in too. Step 05's headline is "Continue your
 * design!" and the component state that held that word is gone by then --
 * signing in re-mounts the tree -- so the stash is the only copy left.
 */
test("the chosen lane survives to the screens after sign-in", async () => {
  await stashOnboardingChoice({ interest: null, taskId: null, prompt: "Something of my own" });
  const out = await launchOnboardingTask(clientThat({ sessionId: "s-9" }), true);
  expect(out.kind === "started" && out.interest).toBe(null);
});

/**
 * NOTHING BEATS NOT-READY when there is nothing stashed.
 *
 * The caller waits out a ceiling of a minute and a half for a Computer before
 * it gives up. Reporting "not ready" to an account that has no prompt to run
 * would park it on a splash for that whole time for no reason, so the cheap
 * non-consuming question is asked first.
 */
test("no stash answers immediately, without waiting for a computer", async () => {
  expect(await launchOnboardingTask(null, false)).toEqual({ kind: "nothing" });
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


/**
 * FILES PICKED BEFORE SIGN-IN, delivered after it.
 *
 * Step 03 lets somebody attach a reference while there is no account, no
 * Computer and nowhere to upload to, so the local URIs cross sign-in in the
 * stash. They go to `/api/uploads`, the pre-session endpoint, because the
 * paths have to be IN the prompt: the prompt is the session's first message
 * and there is no second one to attach to.
 */
const withFile = (name: string, mimeType = "image/jpeg") =>
  stashOnboardingChoice({
    interest: "design",
    taskId: null,
    prompt: "Match this brand",
    files: [{ uri: `file:///cache/${name}`, name, mimeType, kind: "image" }],
  });

test("a picked file is uploaded and named in the prompt that starts the session", async () => {
  await withFile("brand.png");
  let sent = "";
  const client = {
    transport: {
      request: async (_path: string, init: { body: string }) => {
        sent = JSON.parse(init.body).prompt;
        return { sessionId: "s-att" };
      },
    },
  } as never;
  expect((await launchOnboardingTask(client, true)).kind).toBe("started");
  expect(uploaded).toHaveLength(1);
  // The pre-session endpoint, not /api/sessions/:id/upload: there is no
  // session yet, and the path has to be in the message that creates it.
  expect(uploaded[0].endpoint).toStartWith("/api/uploads?filename=");
  expect(sent).toBe("Match this brand\n\nAttached file:\n- brand.png: /tmp/lfg-uploads/brand.png");
});

/**
 * A cache copy can be gone by the time this runs -- the system can reclaim it
 * while somebody is in a browser signing in. Losing a reference is a far
 * smaller loss than refusing to start the task it was attached to.
 */
test("a file that will not upload is dropped, and the task still starts", async () => {
  await withFile("gone.png");
  uploadFails = true;
  let sent = "";
  const client = {
    transport: {
      request: async (_path: string, init: { body: string }) => {
        sent = JSON.parse(init.body).prompt;
        return { sessionId: "s-drop" };
      },
    },
  } as never;
  const out = await launchOnboardingTask(client, true);
  expect(out.kind).toBe("started");
  // No block at all, rather than a line pointing at a path that does not exist.
  expect(sent).toBe("Match this brand");
});

test("no files means no upload traffic at all", async () => {
  await stashOnboardingChoice({ interest: "code", taskId: null, prompt: "Review this" });
  await launchOnboardingTask(clientThat({ sessionId: "s-plain" }), true);
  expect(uploaded).toHaveLength(0);
});
