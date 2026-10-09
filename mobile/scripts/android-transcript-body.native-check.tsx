/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from "../../web/src/test-support/render";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";

const platform = process.env.TRANSCRIPT_TEST_PLATFORM ?? "android";
let nativeReads = 0;
let renders = 0;
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  Platform: { OS: platform },
  UIManager: {
    hasViewManagerConfig: () => { nativeReads++; return true; },
  },
  unstable_VirtualView: ({ children }: { children?: React.ReactNode }) => <div data-virtual-body>{children}</div>,
}));
mock.module(resolve(import.meta.dir, "../src/omg/markdown.tsx"), () => ({
  Markdown: ({ text }: { text: string }) => { renders++; return <span>{text}</span>; },
}));
const { TranscriptBody, VirtualBoundary, virtualTranscriptBodiesSupported } = await import("../src/omg/transcript-body");
let ui: Mounted;
beforeEach(() => { ui = mount(); renders = 0; });
afterEach(() => ui.cleanup());

test("only iOS checks and enables experimental native virtualization", () => {
  expect(virtualTranscriptBodiesSupported).toBe(platform === "ios");
  if (platform !== "ios") expect(nativeReads).toBe(0);
});

test("reply content stays readable through both transcript boundaries", () => {
  ui.render(<VirtualBoundary><TranscriptBody text="Session reply" /></VirtualBoundary>);
  expect(ui.text()).toBe("Session reply");
  expect(ui.queryAll("[data-virtual-body]").length).toBe(platform === "ios" ? 2 : 0);
});

test("unchanged replies remain memoized without native virtualization", () => {
  ui.render(<TranscriptBody text="Session reply" />);
  ui.render(<TranscriptBody text="Session reply" />);
  expect(renders).toBe(1);
  ui.render(<TranscriptBody text="Updated reply" />);
  expect(ui.text()).toBe("Updated reply");
  expect(renders).toBe(2);
});

test("explicitly disabled virtualization renders the ordinary body", () => {
  ui.render(<VirtualBoundary enabled={false}><TranscriptBody text="Session reply" virtualize={false} /></VirtualBoundary>);
  expect(ui.text()).toBe("Session reply");
  expect(ui.query("[data-virtual-body]")).toBeNull();
});
