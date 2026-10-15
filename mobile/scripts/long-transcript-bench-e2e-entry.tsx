// Standalone native benchmark: scrolling a long session transcript. Never imported by the product entry.
import { registerRootComponent } from "expo";
import { useEffect, useRef, useState } from "react";
import { FlatList, Platform, Text, View } from "react-native";
import Reanimated, { Easing, scrollTo, useAnimatedReaction, useAnimatedRef, useFrameCallback, useSharedValue, withTiming } from "react-native-reanimated";
import { TranscriptRow, type TranscriptItem } from "../src/omg/transcript";
import { useLucideFont } from "../src/omg/lucide";
import { SafeAreaProvider } from "react-native-safe-area-context";

const REPORT = "http://localhost:8098/result";
type Mode = "base" | "win5" | "win7";
const ORDER: Mode[] = ["base", "win5", "win7", "win7", "win5", "base"];
const COUNT = 300;
const LEG = 7000;
const para = "I checked the current state of the screen and the list. The change keeps the reader's place while older rows load, and it does not touch the composer. **Verified** with `bun test` and on the simulator.";
const reply = (i: number) => {
  const n = 1 + (i * 7) % 5;
  let s = `Step ${i}: ${para}`;
  for (let k = 0; k < n; k++) s += `\n\n- Point ${k} about \`file-${k}.ts\` and what changed\n- Another detail with a [link](https://omg.dev)`;
  if (i % 4 === 0) s += "\n\n```ts\nconst value = compute(" + i + ");\nconsole.log(value);\n```";
  if (i % 9 === 0) s += "\n\n| Check | Result |\n| --- | --- |\n| Types | Pass |\n| Tests | Pass |";
  return s;
};
const fixture: TranscriptItem[] = Array.from({ length: COUNT }, (_, i) => i % 25 === 0
  ? { type: "stamp", key: `s${i}`, ts: 1700000000000 + i * 60000 }
  : { type: "message", key: `m${i}`, message: { id: `m${i}`, role: i % 5 === 1 ? "user" : "assistant", kind: "text", text: i % 5 === 1 ? `Please look at item ${i} and fix it.` : reply(i), ts: 1700000000000 + i * 60000 } } as TranscriptItem);
const quantile = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function Trial({ mode, trial, done }: { mode: Mode; trial: number; done: () => void }) {
  const [status, setStatus] = useState("Warmup");
  const list = useAnimatedRef<FlatList<TranscriptItem>>();
  const offset = useSharedValue(0);
  const extent = useRef(0);
  const viewport = useRef(0);
  const measuring = useSharedValue(false);
  const frames = useSharedValue({ count: 0, total: 0, over25: 0, over50: 0, max: 0, list: [] as number[] });
  useAnimatedReaction(() => offset.value, y => { if (measuring.value) scrollTo(list, 0, y, false); });
  useFrameCallback(({ timeSincePreviousFrame: dt }) => {
    if (!measuring.value || dt == null) return;
    const f = frames.value;
    frames.value = { count: f.count + 1, total: f.total + dt, over25: f.over25 + (dt > 25 ? 1 : 0), over50: f.over50 + (dt > 50 ? 1 : 0), max: Math.max(f.max, dt), list: [...f.list, dt] };
  });
  useEffect(() => {
    let cancelled = false, raf = 0;
    const js: number[] = [];
    void (async () => {
      // Open at the end, like the session screen.
      for (let k = 0; k < 6; k++) { await sleep(400); list.current?.scrollToOffset({ offset: 1e7, animated: false }); }
      await sleep(1500);
      if (cancelled) return;
      setStatus("Scroll");
      const bottom = Math.max(0, extent.current - viewport.current);
      offset.value = bottom;
      measuring.value = true;
      let previous = performance.now();
      const begin = previous;
      const frame = () => { const now = performance.now(); js.push(now - previous); previous = now; raf = requestAnimationFrame(frame); };
      raf = requestAnimationFrame(frame);
      for (let leg = 0; leg < 4; leg++) {
        const end = Math.max(0, extent.current - viewport.current);
        offset.value = withTiming(leg % 2 === 0 ? 0 : end, { duration: LEG, easing: Easing.linear });
        await sleep(LEG + 150);
        if (cancelled) return;
      }
      cancelAnimationFrame(raf);
      measuring.value = false;
      const ui = frames.value;
      const result = { trial, mode, platform: Platform.OS, dev: __DEV__, rows: COUNT, durationMs: performance.now() - begin,
        ui: { count: ui.count, mean: ui.total / ui.count, p95: quantile(ui.list, .95), p99: quantile(ui.list, .99), over25: ui.over25, over50: ui.over50, max: ui.max },
        js: { count: js.length, p50: quantile(js, .5), p95: quantile(js, .95), p99: quantile(js, .99), max: Math.max(...js), over25: js.filter(x => x > 25).length, over50: js.filter(x => x > 50).length } };
      setStatus("Recorded");
      try { await fetch(REPORT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) }); } catch (error) { console.error("BENCH_REPORT_FAILED", error); }
      if (!cancelled) done();
    })();
    return () => { cancelled = true; measuring.value = false; cancelAnimationFrame(raf); };
  }, []);
  return <View style={{ flex: 1, backgroundColor: "#fff", paddingTop: 60 }}>
    <Text style={{ padding: 12, color: "#111" }}>Trial {trial + 1}/{ORDER.length} · {mode} · {status}</Text>
    <Reanimated.FlatList ref={list} data={fixture} initialNumToRender={12} maxToRenderPerBatch={12} removeClippedSubviews={false}
      maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
      windowSize={mode === "win5" ? 5 : mode === "win7" ? 7 : undefined}
      onLayout={e => { viewport.current = e.nativeEvent.layout.height; }}
      onContentSizeChange={(_, h) => { extent.current = h; }}
      keyExtractor={item => item.key}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 120 }}
      renderItem={({ item, index }) => <View style={{ paddingBottom: 8 }}>
        <TranscriptRow item={item} firstOfRun={index === 0} lastOfRun />
      </View>}
    />
  </View>;
}
function App() {
  const ready = useLucideFont();
  const [trial, setTrial] = useState(0);
  if (!ready) return <Text>Loading font</Text>;
  if (trial >= ORDER.length) return <Text style={{ paddingTop: 80, padding: 20 }}>Benchmark complete</Text>;
  return <Trial key={trial} trial={trial} mode={ORDER[trial]} done={() => setTrial(t => t + 1)} />;
}
registerRootComponent(() => <SafeAreaProvider><App /></SafeAreaProvider>);
