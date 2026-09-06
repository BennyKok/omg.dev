import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { useRuntimeLifecycle, parseRuntimeLifecycle } = await import("./runtime-lifecycle");
const { configureOmgTransport } = await import("./omg-client");
const { createSameOriginTransport } = await import("@omg-dev/client");
const originalFetch = globalThis.fetch;
let ui: Mounted;
afterEach(() => { ui?.cleanup(); globalThis.fetch = originalFetch; configureOmgTransport(createSameOriginTransport()); });
function Probe({ enabled = true, generation = 1 }: { enabled?: boolean; generation?: number }) {
  return <span>{useRuntimeLifecycle(enabled, generation) ?? "unknown"}</span>;
}

test("reads cloud startup state and clears it after recovery", async () => {
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return Response.json({ state: "waking" });
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport({ fetch: globalThis.fetch }));
  ui = mount();
  ui.render(<Probe />);
  await ui.flushAsync();
  expect(ui.text()).toBe("waking");
  ui.render(<Probe enabled={false} />);
  expect(ui.text()).toBe("unknown");
  expect(signal?.aborted).toBe(true);
});

test("old servers retain generic connection feedback", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
  configureOmgTransport(createSameOriginTransport({ fetch: globalThis.fetch }));
  ui = mount();
  ui.render(<Probe />);
  await ui.flushAsync();
  expect(ui.text()).toBe("unknown");
  expect(parseRuntimeLifecycle({ state: "unexpected" })).toBeNull();
  expect(parseRuntimeLifecycle(null)).toBeNull();
});

test("a response from the previous transport cannot change the selected computer", async () => {
  let resolveOld!: (response: Response) => void;
  let reads = 0;
  globalThis.fetch = (() => ++reads === 1
    ? new Promise<Response>((resolve) => { resolveOld = resolve; })
    : Promise.resolve(Response.json({ state: "starting" }))) as typeof fetch;
  configureOmgTransport(createSameOriginTransport({ fetch: globalThis.fetch }));
  ui = mount();
  ui.render(<Probe />);
  ui.render(<Probe generation={2} />);
  await ui.flushAsync();
  expect(ui.text()).toBe("starting");
  await ui.flushAsync(() => { resolveOld(Response.json({ state: "failed" })); });
  expect(ui.text()).toBe("starting");
});
