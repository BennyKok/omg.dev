import { describe, expect, test } from "bun:test";
import {
  INITIAL_UPDATE_FLOW_STATE,
  apiErrorStatus,
  updateFlowReducer,
  type UpdateFlowState,
} from "./update-flow.ts";

describe("update flow reducer", () => {
  test("start moves idle to updating", () => {
    expect(updateFlowReducer(INITIAL_UPDATE_FLOW_STATE, { type: "start" })).toEqual({ phase: "updating" });
  });

  test("post-ok with restarting:false confirms immediately (already up to date)", () => {
    const next = updateFlowReducer(
      { phase: "updating" },
      { type: "post-ok", restarting: false, bootId: "boot-1" },
    );
    expect(next).toEqual({ phase: "confirmed" });
  });

  test("post-ok with restarting:true waits for the boot id to change", () => {
    const next = updateFlowReducer(
      { phase: "updating" },
      { type: "post-ok", restarting: true, bootId: "boot-1" },
    );
    expect(next).toEqual({ phase: "restarting", alreadyRunning: false, bootId: "boot-1" });
  });

  describe("409 path", () => {
    test("post-conflict enters the same wait as a real restart, flagged as already running", () => {
      const next = updateFlowReducer({ phase: "updating" }, { type: "post-conflict", bootId: "boot-1" });
      expect(next).toEqual({ phase: "restarting", alreadyRunning: true, bootId: "boot-1" });
    });

    test("boot-id polling still resolves a conflict-triggered wait", () => {
      const restarting: UpdateFlowState = { phase: "restarting", alreadyRunning: true, bootId: "boot-1" };
      const confirmed = updateFlowReducer(restarting, { type: "boot-id", bootId: "boot-2" });
      expect(confirmed).toEqual({ phase: "confirmed" });
    });
  });

  describe("boot-id change detection", () => {
    test("an unchanged boot id keeps waiting", () => {
      const restarting: UpdateFlowState = { phase: "restarting", alreadyRunning: false, bootId: "boot-1" };
      expect(updateFlowReducer(restarting, { type: "boot-id", bootId: "boot-1" })).toBe(restarting);
    });

    test("a changed boot id confirms", () => {
      const restarting: UpdateFlowState = { phase: "restarting", alreadyRunning: false, bootId: "boot-1" };
      expect(updateFlowReducer(restarting, { type: "boot-id", bootId: "boot-2" })).toEqual({ phase: "confirmed" });
    });

    test("a boot-id event outside the restarting phase is a no-op", () => {
      expect(updateFlowReducer({ phase: "idle" }, { type: "boot-id", bootId: "boot-2" })).toEqual({
        phase: "idle",
      });
      expect(updateFlowReducer({ phase: "confirmed" }, { type: "boot-id", bootId: "boot-2" })).toEqual({
        phase: "confirmed",
      });
    });
  });

  test("post-error fails with the server's message", () => {
    const next = updateFlowReducer({ phase: "updating" }, { type: "post-error", message: "disk full" });
    expect(next).toEqual({ phase: "failed", message: "disk full" });
  });

  test("poll-timeout fails only while restarting", () => {
    const restarting: UpdateFlowState = { phase: "restarting", alreadyRunning: false, bootId: "boot-1" };
    const failed = updateFlowReducer(restarting, { type: "poll-timeout" });
    expect(failed.phase).toBe("failed");

    expect(updateFlowReducer({ phase: "idle" }, { type: "poll-timeout" })).toEqual({ phase: "idle" });
  });

  test("retry returns to idle from a failed state", () => {
    const failed: UpdateFlowState = { phase: "failed", message: "boom" };
    expect(updateFlowReducer(failed, { type: "retry" })).toEqual({ phase: "idle" });
  });
});

describe("apiErrorStatus", () => {
  test("reads a structural .status without requiring instanceof", () => {
    expect(apiErrorStatus({ status: 409 })).toBe(409);
    expect(apiErrorStatus(new Error("plain"))).toBeUndefined();
    expect(apiErrorStatus(null)).toBeUndefined();
    expect(apiErrorStatus("nope")).toBeUndefined();
  });

  test("reads .status off a real Error subclass instance (cross-realm safe)", () => {
    class FakeApiError extends Error {
      status: number;
      constructor(status: number) {
        super("failed");
        this.status = status;
      }
    }
    expect(apiErrorStatus(new FakeApiError(409))).toBe(409);
  });
});
