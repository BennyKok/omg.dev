import { expect, test } from "bun:test";
import { omgMessagesToUIMessages } from "./omg-chat-transport";
import { launchMessageRows, recordLaunchMessage, settleLaunchMessage } from "./launch-message";

test("a session created here draws its first message before the server has it", () => {
  recordLaunchMessage("s1", "  Make a snake game  ");
  const rows = launchMessageRows("s1");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.role).toBe("user");
  expect(rows[0]!.metadata?.omgMessage?.text).toBe("Make a snake game");
  expect(rows[0]!.metadata?.omgMessage?.pending).toBe(true);
  expect(launchMessageRows("other")).toEqual([]);
});

test("the bubble stays while the transcript is empty and goes when the real turn lands", () => {
  recordLaunchMessage("s2", "Hello");
  const launch = launchMessageRows("s2");
  expect(settleLaunchMessage("s2", launch)).toBe(launch);
  const real = omgMessagesToUIMessages([{ id: "u1", role: "user", kind: "text", text: "Hello" }]);
  expect(settleLaunchMessage("s2", [...launch, ...real]).map((m) => m.id)).toEqual(["u1"]);
  // Settled once: a later open does not draw it again.
  expect(launchMessageRows("s2")).toEqual([]);
});

test("another pending bubble does not settle it", () => {
  recordLaunchMessage("s3", "First");
  const launch = launchMessageRows("s3");
  const pending = omgMessagesToUIMessages([{ id: "p1", role: "user", kind: "text", text: "Second", pending: true }]);
  expect(settleLaunchMessage("s3", [...launch, ...pending])).toHaveLength(2);
});
