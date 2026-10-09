import { afterEach, expect, spyOn, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import type { ConnectionState } from "./useLiveSocket";
const { toast } = await import("sonner");
const { ConnectionStatusToasts } = await import("./ConnectionStatus");
const { RuntimeAvailabilityContext } = await import("./lib/runtime-availability");
let ui: Mounted;
const spies: ReturnType<typeof spyOn>[] = [];
afterEach(() => { ui?.cleanup(); for (const spy of spies.splice(0)) spy.mockRestore(); });
const connection = (status: ConnectionState["status"]): ConnectionState => ({ status, attempt: 1, lastCloseCode: null, lastCloseReason: null, lastMessageAt: null, latencyMs: null });

test("inline connection feedback suppresses reconnect and recovery toasts", () => {
  const loading = spyOn(toast, "loading");
  const success = spyOn(toast, "success");
  const error = spyOn(toast, "error");
  spies.push(loading, success, error);
  ui = mount();
  for (const status of ["reconnecting", "offline", "live"] as const) {
    ui.render(<ConnectionStatusToasts recoveryVisible connection={connection(status)} onRetry={() => {}} />);
  }
  expect(loading).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
});

test("surfaces without inline feedback retain one shared connection toast", () => {
  const loading = spyOn(toast, "loading");
  const success = spyOn(toast, "success");
  spies.push(loading, success);
  ui = mount();
  ui.render(<ConnectionStatusToasts connection={connection("reconnecting")} onRetry={() => {}} />);
  ui.render(<ConnectionStatusToasts connection={connection("live")} onRetry={() => {}} />);
  expect(loading).toHaveBeenCalledWith("Reconnecting…", { toasterId: "lfg", id: "ws-conn" });
  expect(success).toHaveBeenCalledWith("Reconnected", { toasterId: "lfg", id: "ws-conn", duration: 2000 });
});

test("a waking computer never produces an offline error toast", () => {
  const loading = spyOn(toast, "loading");
  const error = spyOn(toast, "error");
  spies.push(loading, error);
  ui = mount();
  for (const lifecycle of ["paused", "waking"] as const) {
    ui.render(
      <RuntimeAvailabilityContext.Provider value={{ lifecycle, loading: false, ready: false, error: null, status: "offline", retry: () => {} }}>
        <ConnectionStatusToasts connection={connection("offline")} onRetry={() => {}} />
      </RuntimeAvailabilityContext.Provider>,
    );
  }
  expect(error).not.toHaveBeenCalled();
  expect(loading).toHaveBeenCalledWith("Resuming your computer… Please wait.", { toasterId: "lfg", id: "ws-conn" });
});
