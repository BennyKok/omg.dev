/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from "../../web/src/test-support/render";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createContext, useContext, useEffect, useState, type ReactNode } from "../../web/node_modules/react";
import { resolve } from "node:path";

const native = !process.env.TRANSCRIPT_FALLBACK;
const Hidden = createContext(false);
let mounts = 0;
let renders = 0;
let unmounts = 0;
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  Platform: { OS: process.env.TRANSCRIPT_FALLBACK === "web" ? "web" : "ios" },
  UIManager: { hasViewManagerConfig: (name: string) => native && name === "VirtualView" },
  unstable_VirtualView: ({ children }: { children?: ReactNode }) =>
    <div data-virtual-body>{useContext(Hidden) ? null : children}</div>,
}));
mock.module(resolve(import.meta.dir, "../src/omg/markdown.tsx"), () => ({
  Markdown: ({ text, streaming }: { text: string; streaming?: boolean }) => {
    renders++;
    useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return <span>{text}{streaming ? " streaming" : ""}</span>;
  },
}));
const { TranscriptBody, virtualTranscriptBodiesSupported } = await import("../src/omg/transcript-body");
let ui: Mounted;
beforeEach(() => { ui = mount(); mounts = renders = unmounts = 0; });
afterEach(() => ui.cleanup());

test("unchanged reply bodies skip network-driven parent renders", () => {
  ui.render(<TranscriptBody text="reply" />);
  ui.render(<TranscriptBody text="reply" />);
  expect(virtualTranscriptBodiesSupported).toBe(native);
  expect(renders).toBe(1);
  ui.render(<TranscriptBody text="new reply" streaming />);
  expect(ui.text()).toBe("new reply streaming");
  expect(renders).toBe(2);
});

test.skipIf(!native)("hidden bodies unmount and restore the latest text", () => {
  ui.render(<Hidden value={false}><TranscriptBody text="first" /></Hidden>);
  ui.render(<Hidden value={true}><TranscriptBody text="latest" streaming /></Hidden>);
  expect(ui.text()).toBe("");
  expect(unmounts).toBe(1);
  ui.render(<Hidden value={false}><TranscriptBody text="latest" streaming /></Hidden>);
  expect(ui.text()).toBe("latest streaming");
  expect(mounts).toBe(2);
});

test.skipIf(!native)("the surrounding row state and entrance lifetime survive a hidden body", () => {
  let rowMounts = 0;
  function Row() {
    const [expanded, setExpanded] = useState(false);
    useEffect(() => { rowMounts++; }, []);
    return <><button onClick={() => setExpanded(x => !x)}>{expanded ? "Expanded" : "Collapsed"}</button><TranscriptBody text="body" /></>;
  }
  ui.render(<Hidden value={false}><Row /></Hidden>);
  ui.flush(() => (ui.query("button") as HTMLElement).click());
  ui.render(<Hidden value={true}><Row /></Hidden>);
  expect(ui.text()).toBe("Expanded");
  ui.render(<Hidden value={false}><Row /></Hidden>);
  expect(ui.text()).toBe("Expandedbody");
  expect(rowMounts).toBe(1);
});

test("baseline path neither virtualizes nor memoizes", () => {
  ui.render(<Hidden value={true}><TranscriptBody text="baseline" virtualize={false} /></Hidden>);
  ui.render(<Hidden value={true}><TranscriptBody text="baseline" virtualize={false} /></Hidden>);
  expect(ui.text()).toBe("baseline");
  expect(ui.query("[data-virtual-body]")).toBeNull();
  expect(renders).toBe(2);
});

test.skipIf(native)("unsupported clients keep readable bodies without a native wrapper", () => {
  ui.render(<Hidden value={true}><TranscriptBody text="fallback" /></Hidden>);
  expect(ui.text()).toBe("fallback");
  expect(ui.query("[data-virtual-body]")).toBeNull();
});
