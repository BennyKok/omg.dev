/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
let props: any;
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  FlatList: (next: any) => {
    props = next;
    return <div>{next.data.map((item: any, index: number) =>
      <div key={next.keyExtractor(item)}>{next.renderItem({ item, index })}</div>)}</div>;
  },
}));
mock.module(resolve(import.meta.dir, "../src/omg/session-activity.tsx"), () => ({
  SessionActivityPane: ({ onScreen, children }: any) => <div data-running={String(onScreen)}>{children}</div>,
}));
const { WindowedSessionList } = await import("../src/omg/windowed-session-list");
test("only reported visible rows animate; reordering preserves row identity", () => {
  const ui = mount();
  const a = { key: "a" }, b = { key: "b" }, c = { key: "c" };
  const render = (data: typeof a[]) => ui.render(<WindowedSessionList data={data} renderItem={({ item }) => <span>{item.key}</span>} />);
  try {
    render([a,b,c]);
    expect(ui.queryAll('[data-running="true"]').length).toBe(0);
    ui.flush(() => props.onViewableItemsChanged({ viewableItems: [{ item: b, isViewable: true }] }));
    expect(ui.query('[data-running="true"]')?.textContent).toBe("b");
    render([c,b,a]);
    expect(ui.query('[data-running="true"]')?.textContent).toBe("b");
    ui.flush(() => props.onViewableItemsChanged({ viewableItems: [{ item: c, isViewable: true }, { item: b, isViewable: false }] }));
    expect(ui.query('[data-running="true"]')?.textContent).toBe("c");
    ui.flush(() => props.onViewableItemsChanged({ viewableItems: [] }));
    expect(ui.queryAll('[data-running="true"]').length).toBe(0);
  } finally { ui.cleanup(); }
});
