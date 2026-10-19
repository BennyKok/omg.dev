/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from "../../web/src/test-support/render";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";

let mounts = 0;
let unmounts = 0;
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
mock.module(resolve(import.meta.dir, "../src/omg/markdown.tsx"), () => ({
  Markdown: ({ text, streaming }: { text: string; streaming?: boolean }) => {
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return <span>{text}{streaming ? " streaming" : ""}</span>;
  },
}));
const { TranscriptBody, VirtualBoundary } = await import("../src/omg/transcript-body");
let ui: Mounted;
beforeEach(() => { ui = mount(); mounts = unmounts = 0; });
afterEach(() => ui.cleanup());

test("a reply stays mounted when the boundary flag or parent changes", () => {
  const reply = (enabled: boolean, text: string, streaming = false) =>
    <VirtualBoundary enabled={enabled}><TranscriptBody text={text} streaming={streaming} virtualize={enabled} inHoldMenu /></VirtualBoundary>;
  ui.render(reply(true, "first"));
  ui.render(reply(false, "latest", true));
  ui.render(reply(true, "latest"));
  expect(ui.text()).toBe("latest");
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
});

test("the row owner can still unmount a reply when it leaves the list window", () => {
  ui.render(<TranscriptBody text="reply" />);
  ui.render(null);
  expect(unmounts).toBe(1);
  ui.render(<TranscriptBody text="restored" />);
  expect(ui.text()).toBe("restored");
  expect(mounts).toBe(2);
});
