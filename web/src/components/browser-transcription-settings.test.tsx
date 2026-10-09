import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { BrowserTranscriptionSettings } = await import("./browser-transcription-settings");
const { BrowserTranscription } = await import("../lib/browser-transcription");
let ui: Mounted;
afterEach(() => ui?.cleanup());

test("renders download progress, ready state, and a working Cloud override", () => {
  window.localStorage.clear();
  let emit: (data: unknown) => void = () => {};
  const worker = { onmessage: null as any, onerror: null, postMessage() {}, terminate() {} };
  const service = new BrowserTranscription(() => { emit = (data) => worker.onmessage?.({ data }); return worker as unknown as Worker; });
  ui = mount();
  ui.render(<BrowserTranscriptionSettings service={service} />);
  expect(ui.text()).toContain("Downloading");
  ui.flush(() => emit({ type: "progress", progress: 42 }));
  expect(ui.text()).toContain("42%");
  ui.flush(() => emit({ type: "ready" }));
  expect(ui.text()).toContain("On-device ready");
  const select = ui.query("#browser-transcription-mode") as HTMLSelectElement;
  ui.flush(() => { select.value = "cloud"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(ui.text()).toContain("Cloud transcription");
  expect(service.getSnapshot().mode).toBe("cloud");
  expect(JSON.parse(window.localStorage.getItem("omg-browser-transcription-v1")!).mode).toBe("cloud");
});
