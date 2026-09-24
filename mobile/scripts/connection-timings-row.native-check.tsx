/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const View = ({ children }: any) => <div>{children}</div>;
mock.module(import.meta.resolve("react-native"), () => ({ View, Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button> }));
mock.module(resolve(import.meta.dir, "../src/components.tsx"), () => ({ Row: View, Separator: () => null }));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({ Text: View }));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: {} }) }));
const { ConnectionTimingsRow } = await import("../src/omg/connection-timings-row");
const { clearConnectionTimings, recordConnectionTiming } = await import("../src/omg/connection-trace");
test("details are opt-in, update while visible, and disappear on blur", () => {
  const ui = mount(); clearConnectionTimings();
  try {
    ui.render(<ConnectionTimingsRow active />);
    expect(ui.text()).not.toContain("Recent timings");
    ui.flush(() => (ui.query("button") as HTMLElement).click());
    expect(ui.text()).toContain("No connection timings yet");
    ui.flush(() => recordConnectionTiming("bootstrap.parse", performance.now(), { size: 100 }));
    expect(ui.text()).toContain("bootstrap.parse"); expect(ui.text()).toContain("100 chars");
    ui.render(<ConnectionTimingsRow active={false} />); expect(ui.text()).not.toContain("bootstrap.parse");
  } finally { ui.cleanup(); }
});
