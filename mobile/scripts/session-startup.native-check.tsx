/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
let appListener = (_: string) => {};
const appState = { currentState: "active", addEventListener: (_: string, callback: typeof appListener) => { appListener = callback; return { remove() { appListener = () => {}; } }; } };
mock.module(import.meta.resolve("react-native"), () => ({ AppState: appState }));
mock.module(import.meta.resolve("expo-router"), () => ({ useFocusEffect: (effect: () => void) => React.useEffect(effect, [effect]) }));
const { useSessionStatus } = await import("../src/omg/use-session-status");
const { SessionStatusState } = await import("../src/omg/session-status");

function setup() {
  let opens = 0, closes = 0, loads = 0;
  const live = { state: { status: "connecting" }, subscribeStatus: () => { opens++; return () => { closes++; }; }, subscribeConnection: () => () => {} } as any;
  const state = new SessionStatusState(() => {});
  const load = async () => { loads++; };
  function Screen({ ready, cloud = false, denied = false }: { ready: boolean; cloud?: boolean; denied?: boolean }) {
    useSessionStatus({ live, state, ready, cloud, denied, load, connectionChanged: () => {} });
    return <div>Home</div>;
  }
  return { Screen, counts: () => ({ opens, closes, loads }) };
}

test("Bridge opens during bootstrap and stays open when ready; background closes it", () => {
  const ui = mount(); const { Screen, counts } = setup(); appState.currentState = "active";
  try {
    ui.render(<Screen ready={false} />); expect(counts()).toEqual({ opens: 1, closes: 0, loads: 0 });
    ui.render(<Screen ready />); expect(counts()).toEqual({ opens: 1, closes: 0, loads: 1 });
    ui.flush(() => { appState.currentState = "background"; appListener("background"); });
    expect(counts().closes).toBe(1);
    ui.flush(() => { appState.currentState = "active"; appListener("active"); });
    expect(counts().opens).toBe(2);
    ui.render(<Screen ready denied />); expect(counts().closes).toBe(2);
  } finally { ui.cleanup(); }
});

test("cloud opens only after readiness and denied access never opens", () => {
  const ui = mount(); const { Screen, counts } = setup(); appState.currentState = "active";
  try {
    ui.render(<Screen ready={false} cloud />); expect(counts().opens).toBe(0);
    ui.render(<Screen ready cloud denied />); expect(counts().opens).toBe(0);
    ui.render(<Screen ready cloud />); expect(counts().opens).toBe(1);
  } finally { ui.cleanup(); }
});
