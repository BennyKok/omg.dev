// A Claude turn that ends in an error result (`error_during_execution`,
// `error_max_turns`, …) used to reach only the serve journal. The harness
// logged it, cleared the draft and went idle, so the transcript — the one
// channel the web UI reads — showed a turn that simply stopped, with no reason.
// The Codex, Pi and managed-SDK harnesses already index an `apiError` row for
// a failed turn; this pins the same for Claude.
//
// A turn the user interrupted also ends in `error_during_execution`, with
// terminal_reason `aborted_streaming` or `aborted_tools`. That is not a
// failure and must not add an error row.
import { describe, expect, test } from "bun:test";
import { aisdkTurnFailureRow } from "./aisdk-session.ts";

const base = { id: "row-1", ts: 1, interrupted: false };

describe("aisdkTurnFailureRow", () => {
  test("a failed turn becomes an apiError transcript row with its reason", () => {
    const row = aisdkTurnFailureRow(
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        terminal_reason: "turn_setup_failed",
        errors: ["queryParams builder failed: ENOENT"],
      },
      base,
    );

    expect(row).not.toBeNull();
    expect(row!.role).toBe("assistant");
    expect(row!.kind).toBe("text");
    expect(row!.apiError).toBe(true);
    expect(row!.id).toBe("row-1");
    expect(row!.text).toContain("Claude turn failed");
    expect(row!.text).toContain("queryParams builder failed: ENOENT");
  });

  test("every error subtype is surfaced", () => {
    for (const subtype of [
      "error_during_execution",
      "error_max_turns",
      "error_max_budget_usd",
      "error_max_structured_output_retries",
    ]) {
      const row = aisdkTurnFailureRow({ type: "result", subtype, is_error: true, errors: [] }, base);
      expect(row?.apiError).toBe(true);
      expect(row?.text).toContain(subtype);
    }
  });

  test("a successful turn adds nothing", () => {
    expect(
      aisdkTurnFailureRow({ type: "result", subtype: "success", is_error: false, result: "done" }, base),
    ).toBeNull();
  });

  test("an interrupted turn adds nothing", () => {
    for (const terminal_reason of ["aborted_streaming", "aborted_tools"]) {
      expect(
        aisdkTurnFailureRow(
          { type: "result", subtype: "error_during_execution", is_error: true, terminal_reason, errors: [] },
          base,
        ),
      ).toBeNull();
    }
    // An older CLI may not report terminal_reason; the harness's own record
    // of the interrupt decides.
    expect(
      aisdkTurnFailureRow(
        { type: "result", subtype: "error_during_execution", is_error: true, errors: [] },
        { ...base, interrupted: true },
      ),
    ).toBeNull();
  });
});
