import { afterEach, expect, spyOn, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import type { ConnectionState } from "./useLiveSocket";
const { toast } = await import("sonner");
const { ConnectionStatusToasts } = await import("./ConnectionStatus");
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
  expect(loading).toHaveBeenCalledWith("Reconnecting…", { id: "ws-conn" });
  expect(success).toHaveBeenCalledWith("Reconnected", { id: "ws-conn", duration: 2000 });
});
