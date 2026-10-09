import { expect, test } from "bun:test";
import { NativeTranscription, finishLocalTake } from "../src/omg/native-transcription-state";

function storage(initial: string | null = null) {
  let value = initial;
  return { getItem: async () => value, setItem: async (_key: string, next: string) => { value = next; } };
}
test("Auto starts on cloud and switches only for the next take", async () => {
  let ready!: () => void;
  let loads = 0;
  const service = new NativeTranscription({ prepare: () => { loads++; return new Promise<void>(resolve => { ready = resolve; }); }, transcribe: async () => "local" }, storage());
  const first = await service.captureTake();
  expect(first.provider).toBe("cloud");
  const loading = service.ensureLoaded();
  ready(); await loading;
  expect(loads).toBe(1);
  expect(first.provider).toBe("cloud");
  expect((await service.captureTake()).provider).toBe("local");
});
test("Cloud persists across a new service and does not download the model", async () => {
  const saved = storage(); let loads = 0;
  const engine = { prepare: async () => { loads++; }, transcribe: async () => "" };
  const service = new NativeTranscription(engine, saved);
  await service.setPreferences("cloud", "en");
  const restored = new NativeTranscription(engine, saved);
  await restored.initialize();
  const count = loads;
  expect(await restored.captureTake()).toEqual({ provider: "cloud", mode: "cloud", language: "en" });
  expect(loads).toBe(count);
});
test("unsupported languages and missing modules keep Auto on cloud", async () => {
  const service = new NativeTranscription(null, storage());
  expect((await service.captureTake()).provider).toBe("cloud");
  await service.setPreferences("local", "zh");
  await expect(service.captureTake()).rejects.toThrow("This language needs cloud");
});
test("Auto replays failures, while Local and cancelled takes never upload", async () => {
  const service = new NativeTranscription({ prepare: async () => {}, transcribe: async () => { throw Error("engine failed"); } }, storage());
  await service.initialize(); await service.ensureLoaded();
  const take = await service.captureTake();
  let uploads = 0;
  const replay = async () => { uploads++; return "cloud text"; };
  expect(await finishLocalTake(service, "file:///take.wav", take, replay, () => false)).toBe("cloud text");
  expect(uploads).toBe(1);
  await expect(finishLocalTake(service, "file:///take.wav", { ...take, mode: "local" }, replay, () => false)).rejects.toThrow("engine failed");
  expect(await finishLocalTake(service, "file:///take.wav", take, replay, () => true)).toBe("");
  expect(uploads).toBe(1);
});
test("cancelling during local inference prevents cloud replay and results", async () => {
  let fail!: (error: Error) => void; let cancelled = false; let uploads = 0;
  const service = new NativeTranscription({ prepare: async () => {}, transcribe: () => new Promise<string>((_resolve, reject) => { fail = reject; }) }, storage());
  await service.initialize(); await service.ensureLoaded();
  const promise = finishLocalTake(service, "file:///take.wav", await service.captureTake(), async () => { uploads++; return "cloud"; }, () => cancelled);
  cancelled = true; fail(Error("failed"));
  expect(await promise).toBe(""); expect(uploads).toBe(0);
});
test("silence does not trigger a cloud upload", async () => {
  const service = new NativeTranscription({ prepare: async () => {}, transcribe: async () => "" }, storage());
  await service.initialize(); await service.ensureLoaded();
  let uploads = 0;
  expect(await finishLocalTake(service, "file:///take.wav", await service.captureTake(), async () => { uploads++; return "cloud"; }, () => false)).toBe("");
  expect(uploads).toBe(0);
});
