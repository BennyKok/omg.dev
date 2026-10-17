import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { HostConnectionState } from "./host-connection";
const { HostConnectionProvider, useHostOwnsConnection, useReportHostConnection } = await import("./host-connection");

// The contract a host relies on: with onConnectionChange, the surface reports
// each change of its connection exactly once and says the host owns the
// display; without it, the surface keeps its own connection UI.

let ui: Mounted;
afterEach(() => ui?.cleanup());

const connecting: HostConnectionState = { status: "connecting", loading: true, ready: false, saved: false, error: null, lifecycle: "waking" };
let owns: boolean | null = null;

function Probe({ state }: { state: HostConnectionState }) {
  owns = useHostOwnsConnection();
  useReportHostConnection(state);
  return null;
}

test("a host that passes onConnectionChange hears each change once and owns the display", () => {
  const seen: HostConnectionState[] = [];
  const onChange = (state: HostConnectionState) => seen.push(state);
  const tree = (state: HostConnectionState) => (
    <HostConnectionProvider onChange={onChange}><Probe state={state} /></HostConnectionProvider>
  );
  ui = mount();
  ui.render(tree(connecting));
  // A re-render with an equal state (a new object) is not a change.
  ui.render(tree({ ...connecting }));
  // Showing the saved screen is a change the host must hear: it decides
  // whether the connection page covers the surface.
  ui.render(tree({ ...connecting, saved: true }));
  ui.render(tree({ status: "live", loading: false, ready: true, saved: false, error: null, lifecycle: null }));
  expect(owns).toBe(true);
  expect(seen).toEqual([
    connecting,
    { ...connecting, saved: true },
    { status: "live", loading: false, ready: true, saved: false, error: null, lifecycle: null },
  ]);
});

test("without onConnectionChange the surface keeps its own connection UI", () => {
  ui = mount();
  ui.render(<HostConnectionProvider onChange={undefined}><Probe state={connecting} /></HostConnectionProvider>);
  expect(owns).toBe(false);
  ui.render(<Probe state={connecting} />);
  expect(owns).toBe(false);
});
