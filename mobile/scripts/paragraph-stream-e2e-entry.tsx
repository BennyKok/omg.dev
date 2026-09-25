/**
 * Simulator-only proof that a live reply streams by paragraph, not by token.
 *
 * A fake client feeds the real OnboardingTranscript a draft that grows a few
 * characters at a time, the same `draft` events the SDK emits. The stream
 * pauses mid-paragraph so the screen can be read while a block is incomplete,
 * then finishes and lands the final message.
 */
import { registerRootComponent } from "expo";
import { useEffect, useState } from "react";
import { SafeAreaView, Text, View } from "react-native";
import type { OmgClient } from "@omg-dev/client";
import { OnboardingTranscript } from "../src/omg/onboarding-transcript";

const FIRST = "First paragraph is complete now.\n\n";
const PARTIAL = "Second paragraph is still being typed";
const REST = " and ends here.\n\n- One list item\n- Two list item";
const PAUSE_MS = 25_000;
const STEP_MS = 60;

let status: (text: string) => void = () => {};

type Listener = Parameters<OmgClient["live"]["subscribeTranscript"]>[1];

function streamInto(emit: Listener) {
  let text = "";
  let stopped = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const grow = async (chunk: string) => {
    for (let i = 0; i < chunk.length && !stopped; i += 3) {
      text += chunk.slice(i, i + 3);
      emit({ type: "draft", draft: { id: "draft-1", kind: "text", text } } as never);
      await sleep(STEP_MS);
    }
  };
  void (async () => {
    emit({ type: "snapshot", messages: [{ id: "u1", role: "user", kind: "text", text: "Write two paragraphs" }] } as never);
    emit({ type: "busy", busy: true } as never);
    status("Streaming");
    await grow(FIRST + PARTIAL);
    status(`Stream paused mid-paragraph, received ${text.length} characters`);
    await sleep(PAUSE_MS);
    status("Streaming");
    await grow(REST);
    emit({ type: "message", message: { id: "a1", role: "assistant", kind: "text", text } } as never);
    emit({ type: "busy", busy: false } as never);
    status("Stream finished");
  })();
  return () => { stopped = true; };
}

const client = {
  live: { subscribeTranscript: (_sid: string, listener: Listener) => streamInto(listener) },
} as unknown as OmgClient;

function App() {
  const [label, setLabel] = useState("Starting");
  useEffect(() => { status = setLabel; }, []);
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#111" }}>
    <Text style={{ fontSize: 22, color: "white", margin: 20 }}>Paragraph streaming test</Text>
    <Text style={{ fontSize: 15, color: "#aaa", marginHorizontal: 20 }}>{label}</Text>
    <View style={{ flex: 1 }}><OnboardingTranscript client={client} sessionId="paragraph-test" /></View>
  </SafeAreaView>;
}

registerRootComponent(App);
