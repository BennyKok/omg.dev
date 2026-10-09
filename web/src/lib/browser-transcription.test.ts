import { beforeEach, expect, test } from "bun:test";
import { BrowserTranscription, selectTranscriptionTake } from "./browser-transcription";

class FakeWorker {
  onmessage: ((event: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: any[] = [];
  terminated = false;
  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(data: unknown) { this.onmessage?.({ data }); }
}
let worker: FakeWorker;
let service: BrowserTranscription;
beforeEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
  worker = new FakeWorker();
  service = new BrowserTranscription(() => worker as unknown as Worker);
});

test("Auto uses cloud until the runtime is ready and preserves the selected take", () => {
  service.prepare();
  const first = selectTranscriptionTake(service.getSnapshot());
  expect(first.provider).toBe("cloud");
  worker.emit({ type: "progress", progress: 100 });
  expect(selectTranscriptionTake(service.getSnapshot()).provider).toBe("cloud");
  worker.emit({ type: "loading" });
  expect(selectTranscriptionTake(service.getSnapshot()).provider).toBe("cloud");
  worker.emit({ type: "ready" });
  expect(selectTranscriptionTake(service.getSnapshot()).provider).toBe("local");
  expect(first.provider).toBe("cloud");
  const localTake = selectTranscriptionTake(service.getSnapshot());
  service.configure({ mode: "cloud", language: "zh" });
  expect(localTake.provider).toBe("local");
  expect(localTake.language).toBe("auto");
  expect(selectTranscriptionTake(service.getSnapshot()).provider).toBe("cloud");
});

test("preparation is shared and Cloud does not start a download", () => {
  service.configure({ mode: "cloud" });
  service.prepare();
  expect(worker.messages).toHaveLength(0);
  service.configure({ mode: "auto" });
  service.prepare(); service.prepare();
  expect(worker.messages).toEqual([{ type: "load" }]);
  worker.emit({ type: "ready" });
});

test("unsupported languages stay on cloud and Local refuses audio upload", () => {
  service.prepare(); worker.emit({ type: "ready" });
  service.configure({ language: "yue" });
  expect(selectTranscriptionTake(service.getSnapshot()).provider).toBe("cloud");
  service.configure({ mode: "local" });
  expect(() => selectTranscriptionTake(service.getSnapshot())).toThrow("needs cloud");
});

test("a worker error fails local requests and Auto selects cloud for the next take", async () => {
  service.prepare(); worker.emit({ type: "ready" });
  const take = selectTranscriptionTake(service.getSnapshot());
  const result = service.transcribe(new Float32Array([0.1]), take);
  worker.emit({ type: "error", id: 1, error: "decoder failed" });
  await expect(result).rejects.toThrow("decoder failed");
  expect(worker.terminated).toBe(true);
  expect(selectTranscriptionTake(service.getSnapshot()).provider).toBe("cloud");
});

test("Local is blocked until ready; successful transcripts resolve without changing mode", async () => {
  service.configure({ mode: "local" });
  expect(() => selectTranscriptionTake(service.getSnapshot())).toThrow("not ready");
  worker.emit({ type: "ready" });
  const result = service.transcribe(new Float32Array([0.1]), selectTranscriptionTake(service.getSnapshot()));
  worker.emit({ type: "result", id: 1, text: "Hello" });
  expect(await result).toBe("Hello");
  expect(service.getSnapshot().mode).toBe("local");
});
