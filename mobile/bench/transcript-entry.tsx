// Standalone native benchmark. Never imported by the product entry point.
import { registerRootComponent } from "expo";
import { Profiler, startTransition, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, Text, View } from "react-native";
import Reanimated, { Easing, scrollTo, useAnimatedReaction, useAnimatedRef, useFrameCallback, useSharedValue, withTiming } from "react-native-reanimated";
import { TranscriptRow, type TranscriptItem } from "../src/omg/transcript";
import { virtualTranscriptBodiesSupported } from "../src/omg/transcript-body";
import { useLucideFont } from "../src/omg/lucide";

const RUN_ID = process.env.EXPO_PUBLIC_OMG_TRANSCRIPT_RUN_ID;
const REPORT = "http://localhost:8098/result";
const COUNT = 40;
const DURATION = 16000;
const ORDER = [false, true, true, false, false, true];
const paragraph = "This fixed transcript measures **native rendering**, with links, lists, and `inline code`. The same data and scroll path run in both modes. Reading an older reply must remain smooth while a new answer arrives.";
const markdown = (i: number) => `## Reply ${i}\n\n${paragraph}\n\n- Inspect the current state\n- Preserve the reader's position\n- Measure the completed change\n\n| Metric | Meaning |\n| --- | --- |\n| UI frame | Native display callback |\n| JS frame | JavaScript callback |\n\n\`\`\`ts\nconst reply = ${i};\nconsole.log(reply);\n\`\`\`\n\n${paragraph}`;
const fixture: TranscriptItem[] = Array.from({ length: COUNT }, (_, i) => ({
  type: "message", key: `row-${i}`,
  message: { id: `row-${i}`, role: i % 10 === 0 ? "user" : "assistant", kind: "text", text: i % 10 === 0 ? (`Expanded message ${i}. ` + paragraph + "\n").repeat(12) : markdown(i), ts: 1700000000000 + i * 1000 },
}));
const quantile = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function Trial({ optimized, trial, done }: { optimized: boolean; trial: number; done: (r: unknown) => void }) {
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState("Warmup");
  const list = useAnimatedRef<FlatList<TranscriptItem>>();
  const offset = useSharedValue(0);
  const extent = useRef(0);
  const viewport = useRef(0);
  const measuring = useSharedValue(false);
  const frames = useSharedValue({ count: 0, total: 0, over25: 0, over50: 0, max: 0 });
  const render = useRef({ count: 0, ms: 0 });
  const active = useRef(false);
  const started = useRef(performance.now());
  useAnimatedReaction(() => offset.value, y => { scrollTo(list, 0, y, false); });
  useFrameCallback(({ timeSincePreviousFrame: dt }) => {
    if (!measuring.value || dt == null) return;
    const f = frames.value;
    frames.value = { count: f.count + 1, total: f.total + dt, over25: f.over25 + (dt > 25 ? 1 : 0), over50: f.over50 + (dt > 50 ? 1 : 0), max: Math.max(f.max, dt) };
  });
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let received = 0;
    const js: number[] = [];
    void (async () => {
      await sleep(5000);
      if (cancelled) return;
      const mountAndWarmupMs = performance.now() - started.current;
      setStatus("Scroll + stream");
      await sleep(500);
      if (cancelled) return;
      render.current = { count: 0, ms: 0 };
      active.current = true;
      measuring.value = true;
      let previous = performance.now();
      const begin = previous;
      const frame = () => { const now = performance.now(); js.push(now - previous); previous = now; raf = requestAnimationFrame(frame); };
      raf = requestAnimationFrame(frame);
      timer = setInterval(() => {
        received++;
        const update = () => setTick(received);
        startTransition(update);
      }, 50);
      const distance = Math.max(0, extent.current - viewport.current);
      for (let leg = 0; leg < 4; leg++) {
        offset.value = withTiming(leg % 2 === 0 ? distance : 0, { duration: DURATION / 4, easing: Easing.linear });
        await sleep(DURATION / 4);
        if (cancelled) return;
      }
      clearInterval(timer);
      cancelAnimationFrame(raf);
      measuring.value = false;
      active.current = false;
      const result = { runId: RUN_ID, trial, optimized, nativeVirtualView: virtualTranscriptBodiesSupported, platform: Platform.OS, dev: __DEV__, rows: COUNT, durationMs: performance.now() - begin, updatesReceived: received, mountAndWarmupMs, react: render.current, ui: frames.value, js: { count: js.length, p50: quantile(js, .5), p95: quantile(js, .95), max: Math.max(...js), over25: js.filter(x => x > 25).length, over50: js.filter(x => x > 50).length }, distance };
      setStatus("Recorded");
      try { await fetch(REPORT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) }); }
      catch (error) { console.error("BENCH_REPORT_FAILED", error); }
      console.log("TRANSCRIPT_PERF", JSON.stringify(result));
      if (!cancelled) done(result);
    })();
    return () => { cancelled = true; active.current = false; measuring.value = false; clearInterval(timer); cancelAnimationFrame(raf); };
  }, []);
  // Isolate stable row identity. Both modes use the same body renderer,
  // transition priority, mounted count, and scroll path.
  const data = fixture.map((item, i) => item.type === "message"
    ? i === COUNT - 1 ? { ...item, message: { ...item.message, streaming: true, text: markdown(i) + `\n\nDelta ${tick}` } }
      : optimized ? item : { ...item }
    : item);
  return <View style={{ flex: 1, backgroundColor: "#fff", paddingTop: 60 }}>
    <Text style={{ padding: 12, color: "#111" }}>Trial {trial + 1}/{ORDER.length} · {optimized ? "Optimized" : "Baseline"} · {status}</Text>
    <Profiler id="transcript" onRender={(_, __, ms) => { if (active.current) { render.current.count++; render.current.ms += ms; } }}>
      <Reanimated.FlatList ref={list} data={data} initialNumToRender={COUNT} maxToRenderPerBatch={COUNT} removeClippedSubviews={false}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        onLayout={e => { viewport.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_, h) => { extent.current = h; }}
        keyExtractor={item => item.key}
        contentContainerStyle={{ padding: 20 }}
        renderItem={({ item }) => <View style={{ paddingBottom: 12 }}><TranscriptRow item={item} virtualize={false} /></View>}
      />
    </Profiler>
  </View>;
}
function Inspect() {
  const list = useRef<FlatList<TranscriptItem>>(null);
  const [narrow, setNarrow] = useState(false);
  const tool: TranscriptItem = { type: "message", key: "inspect-tool", message: { id: "inspect-tool", role: "assistant", kind: "tool_use", text: 'Bash: {"command":"bun test","description":"Run tests"}', ts: 1700000000000 } };
  return <View style={{ flex: 1, paddingTop: 65, backgroundColor: "#fff" }}>
    <Text style={{ padding: 8, color: "#111" }}>Benchmark complete · Inspect optimized rows</Text>
    <View style={{ flexDirection: "row" }}>
      <Pressable onPress={() => list.current?.scrollToOffset({ offset: 0, animated: false })}><Text style={{ padding: 14, color: "#00f" }}>Top</Text></Pressable>
      <Pressable onPress={() => list.current?.scrollToEnd({ animated: false })}><Text style={{ padding: 14, color: "#00f" }}>Bottom</Text></Pressable>
      <Pressable onPress={() => setNarrow(x => !x)}><Text style={{ padding: 14, color: "#00f" }}>Resize</Text></Pressable>
    </View>
    <FlatList ref={list} style={{ width: narrow ? "75%" : "100%" }} data={[tool, ...fixture]} initialNumToRender={COUNT + 1} maxToRenderPerBatch={COUNT + 1} removeClippedSubviews={false}
      contentContainerStyle={{ padding: 20 }} keyExtractor={x => x.key}
      renderItem={({ item }) => <View style={{ paddingBottom: 12 }}><TranscriptRow item={item} virtualize /></View>} />
  </View>;
}
function App() {
  const ready = useLucideFont();
  const [trial, setTrial] = useState(0);
  if (!ready) return <Text>Loading font</Text>;
  if (trial >= ORDER.length) return <Inspect />;
  return <Trial key={trial} trial={trial} optimized={ORDER[trial]} done={() => setTrial(t => t + 1)} />;
}
registerRootComponent(App);
