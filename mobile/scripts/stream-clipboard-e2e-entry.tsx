/** Isolated clipboard fixture: production viewers and a real loopback Linux desktop. */
import { registerRootComponent } from "expo";
import { SafeAreaView, View, Text, Pressable } from "react-native";
import { useEffect, useState } from "react";
import ComputerControlDom from "../src/omg/computer-control-dom";
import ExpoSigninSheetDom from "../src/omg/expo-signin-sheet-dom";
import { readDeviceClipboard, writeDeviceClipboard } from "../src/omg/computer-clipboard-native";
const origin = "http://localhost:19080";
const value = "Clipboard ✓ 中文 🔑\nsecond line";
async function readRemoteClipboard() { return (await (await fetch(`${origin}/api/computer/clipboard`)).json()).text as string; }
async function setRemoteClipboard(text: string) {
  const response = await fetch(`${origin}/api/computer/clipboard`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!response.ok) throw new Error("Clipboard failed");
}
const frame = { open: true, rect: { x: 0, y: 0, width: 800, height: 600 }, screen: { width: 800, height: 600 }, url: `${origin}/fixture`, inputs: [] };
function App() {
  const [mode, setMode] = useState("Full Computer");
  const [remote, setRemote] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyArmed, setCopyArmed] = useState(false);
  async function prepare(next: string) {
    await fetch(`${origin}/test/prepare`);
    await writeDeviceClipboard(value);
    setRemote(false); setCopied(false); setCopyArmed(false); setMode(next);
  }
  async function select() { await fetch(`${origin}/test/select`); await writeDeviceClipboard("copy sentinel"); setCopied(false); setCopyArmed(true); }
  useEffect(() => { void prepare("Full Computer"); }, []);
  useEffect(() => {
    const remoteTimer = setInterval(() => void fetch(`${origin}/test/state`)
      .then(r => r.json()).then(s => setRemote(s.text === value)).catch(() => {}), 250);
    return () => clearInterval(remoteTimer);
  }, []);
  useEffect(() => {
    if (!copyArmed) return;
    const deviceTimer = setInterval(() => void readDeviceClipboard()
      .then(s => setCopied(s === value)).catch(() => {}), 1000);
    return () => clearInterval(deviceTimer);
  }, [copyArmed]);
  const common = { socketUrl: "ws://localhost:19080/api/computer", protocol: "binary", readClipboard: readDeviceClipboard, writeClipboard: writeDeviceClipboard, readRemoteClipboard, setRemoteClipboard, dom: { style: { flex: 1 } } };
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#141414" }}>
    <Text style={{ color: "white", fontSize: 18, padding: 8 }}>Clipboard fixture · {mode}</Text>
    <View style={{ flexDirection: "row", gap: 8, padding: 8 }}>
      {["Full Computer", "Sign-in dialog"].map(name => <Pressable key={name} onPress={() => void prepare(name)}><Text style={{ color: "#9cf", padding: 6 }}>{name}</Text></Pressable>)}
      <Pressable onPress={() => void select()}><Text style={{ color: "#9cf", padding: 6 }}>Select remote text</Text></Pressable>
    </View>
    <Text style={{ color: "white", padding: 8 }}>{remote ? "Remote paste verified" : "Waiting for paste"} · {copied ? "Device copy verified" : copyArmed ? "Selection ready" : "Clipboard ready"}</Text>
    <View style={{ flex: 1 }}>
      {mode === "Full Computer" ? <ComputerControlDom {...common} /> : <ExpoSigninSheetDom {...common} frame={frame} />}
    </View>
  </SafeAreaView>;
}
registerRootComponent(App);
