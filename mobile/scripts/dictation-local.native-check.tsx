/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from "../../web/src/test-support/render";
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
import { NativeTranscription } from "../src/omg/native-transcription-state";

mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
let permission = true;
let recorderStarts = 0;
let cloudOpens = 0;
let replays = 0;
let replayFails = false;
let outputs: string[] = [];
let service: NativeTranscription;
const recorder = {
  startRecording: async () => { recorderStarts++; },
  stopRecording: async () => ({ fileUri: "file:///take.wav" }),
};
mock.module("@siteed/audio-studio", () => ({ useAudioRecorder: () => recorder,
  AudioStudioModule: { requestPermissionsAsync: async () => ({ granted: permission }) } }));
mock.module("expo-haptics", () => ({ notificationAsync: async () => {}, NotificationFeedbackType: { Warning: "warning" } }));
mock.module(resolve(import.meta.dir, "../src/omg/native-transcription.ts"), () => ({
  nativeTranscription: { captureTake: () => service.captureTake(), transcribe: (uri: string, take: Parameters<NativeTranscription["transcribe"]>[1]) => service.transcribe(uri, take) },
  useNativeTranscription: () => {},
}));
mock.module(resolve(import.meta.dir, "../src/omg/dictation-cloud-replay.ts"), () => ({
  replayDictationAudio: async () => { replays++; if (replayFails) throw Error("stream unavailable"); return "cloud replay"; },
}));
const { useDictation } = await import("../src/omg/dictation");
let driver: ReturnType<typeof useDictation>;
const transport = {
  openSocket: async () => { cloudOpens++; throw Error("cloud unavailable"); },
  fetch: async () => new Response(JSON.stringify({ text: "cloud batch" })),
};
function Harness() {
  driver = useDictation(transport as never, text => outputs.push(text));
  return <div>{driver.state} {driver.error}</div>;
}
let ui: Mounted;
beforeEach(async () => {
  permission = true; recorderStarts = 0; cloudOpens = 0; replays = 0; replayFails = false; outputs = [];
  service = new NativeTranscription({ prepare: async () => {}, transcribe: async () => "native text" }, {
    getItem: async () => null, setItem: async () => {},
  });
  await service.initialize(); await service.ensureLoaded();
  ui = mount(); ui.render(<Harness />);
});
afterEach(() => ui.cleanup());
test("local recording sends its native result without opening cloud", async () => {
  React.act(() => driver.toggle()); await ui.flushAsync();
  expect(driver.state).toBe("recording");
  React.act(() => driver.toggle()); await ui.flushAsync();
  expect(outputs).toEqual(["native text"]);
  expect(cloudOpens).toBe(0); expect(replays).toBe(0);
});
test("a forced Local inference error does not upload the take", async () => {
  await service.setPreferences("local");
  service.transcribe = async () => { throw Error("native failed"); };
  React.act(() => driver.toggle()); await ui.flushAsync(); React.act(() => driver.toggle()); await ui.flushAsync();
  expect(outputs).toEqual([]); expect(cloudOpens).toBe(0); expect(replays).toBe(0);
  expect(driver.error).toBe("native failed");
});
test("Auto recovers a failed native take through cloud replay", async () => {
  service.transcribe = async () => { throw Error("native failed"); };
  React.act(() => driver.toggle()); await ui.flushAsync(); React.act(() => driver.toggle()); await ui.flushAsync();
  expect(outputs).toEqual(["cloud replay"]); expect(replays).toBe(1);
});
test("Auto keeps the existing batch fallback when realtime replay is unavailable", async () => {
  service.transcribe = async () => { throw Error("native failed"); };
  replayFails = true;
  const fileFetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([0, 0])));
  try {
    React.act(() => driver.toggle()); await ui.flushAsync(); React.act(() => driver.toggle()); await ui.flushAsync();
    expect(outputs).toEqual(["cloud batch"]); expect(replays).toBe(1);
    expect(fileFetch).toHaveBeenCalledWith("file:///take.wav");
  } finally { fileFetch.mockRestore(); }
});
test("cancelling a local recording keeps the draft and does not upload", async () => {
  React.act(() => driver.toggle()); await ui.flushAsync(); React.act(() => driver.cancel()); await ui.flushAsync();
  expect(outputs).toEqual([]); expect(replays).toBe(0); expect(driver.state).toBe("idle");
});
test("rapid taps start only one recorder", async () => {
  React.act(() => driver.toggle()); React.act(() => driver.toggle()); await ui.flushAsync();
  expect(recorderStarts).toBe(1); expect(driver.state).toBe("recording");
});
