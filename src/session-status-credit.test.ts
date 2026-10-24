import { expect, test } from "bun:test";
import {
  OPENCODE_OUT_OF_CREDIT_MESSAGE,
  OPENCODE_RECOVERY_MESSAGE,
} from "./agents/backends/opencode-turn-recovery.ts";
import { computeStatus, type SessionMsg } from "./sessions.ts";

const errorTurn = (text: string): SessionMsg =>
  ({ id: "1", role: "assistant", kind: "text", text, ts: 1, apiError: true }) as SessionMsg;

// An out-of-credit customer saw a plain retry message and no paused state, so
// nothing told him the session could not continue. The row and banner read
// this status.
test("an out-of-credit OpenCode turn blocks the session as out of credits", () => {
  expect(computeStatus(errorTurn(OPENCODE_OUT_OF_CREDIT_MESSAGE), null)).toMatchObject({
    status: "blocked",
    statusReason: "out_of_credits",
  });
  expect(computeStatus(errorTurn(OPENCODE_RECOVERY_MESSAGE), null).statusReason).not.toBe("out_of_credits");
  // Prose that only quotes the message is not an error turn.
  expect(
    computeStatus({ ...errorTurn(OPENCODE_OUT_OF_CREDIT_MESSAGE), apiError: false } as SessionMsg, null).status,
  ).toBe("ok");
});
