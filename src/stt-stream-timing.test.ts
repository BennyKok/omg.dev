import { expect, test } from "bun:test";
import { SttTakeTimer } from "./stt-stream-timing";

test("reports audio seconds, upload span and stop-to-text latency", () => {
  let t = 1000;
  const timer = new SttTakeTimer(() => t);
  t = 1250;
  timer.audio(3200); // 0.1 s of 16 kHz PCM16
  t = 3250;
  timer.audio(60800); // total 64,000 B = 2.0 s of audio over 2.0 s of wall clock
  timer.partial();
  t = 3300;
  timer.flush();
  t = 4100;
  timer.final();
  t = 4200;
  timer.final(); // a later final does not move the measured latency
  expect(timer.summary()).toEqual({
    audioBytes: 64000,
    audioSec: 2,
    firstAudioAfterOpenMs: 250,
    streamSec: 2,
    flushToFinalMs: 800,
    partials: 1,
    finals: 2,
    totalMs: 3200,
  });
  expect(timer.line()).toContain("flush->final=800ms");
});

test("a take with no audio and no flush reports blanks, not zeros", () => {
  const timer = new SttTakeTimer(() => 0);
  const s = timer.summary();
  expect(s.firstAudioAfterOpenMs).toBeNull();
  expect(s.flushToFinalMs).toBeNull();
  expect(timer.line()).toContain("first-audio=-");
});
