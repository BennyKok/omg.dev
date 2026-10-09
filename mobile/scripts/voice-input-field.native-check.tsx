/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const View = ({ children, style }: any) => <div style={style}>{children}</div>;
mock.module(import.meta.resolve("react-native"), () => ({ View, ScrollView: View }));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({ Text: ({ children, style, testID }: any) => <span style={style} data-testid={testID}>{children}</span> }));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: { text: "black", textMuted: "gray" } }) }));
const { VoiceInputField } = await import("../src/omg/voice-input-field");
test("voice words keep the draft mounted, dim pending words, and persist through finalization", () => {
 const ui = mount(); let mounted = 0;
 function Input() { React.useEffect(() => { mounted++; }, []); return <input defaultValue="Existing draft" />; }
 const render = (state: "idle" | "recording" | "transcribing", committed = "", partial = "") => ui.render(
  <VoiceInputField draft="Existing draft" dictation={{ state, committed, partial }}><Input /></VoiceInputField>);
 try {
  render("idle"); const original = ui.query("input");
  render("recording", "hello", "world");
  expect(ui.query('[data-testid="voice-live-transcript"]')!.textContent).toBe("Existing draft hello world");
  expect(ui.query('[data-testid="voice-live-transcript"] span')!.getAttribute("style")).toContain("gray");
  expect((original!.parentElement as HTMLElement).style.opacity).toBe("0");
  render("transcribing", "hello", "world"); expect(ui.text()).toContain("Existing draft hello world");
  render("idle"); expect(ui.query("input")).toBe(original); expect(mounted).toBe(1);
  expect((original!.parentElement as HTMLElement).style.opacity).toBe("1");
 } finally { ui.cleanup(); }
});
