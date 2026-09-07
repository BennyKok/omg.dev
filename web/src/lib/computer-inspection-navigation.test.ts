import { describe, expect, test } from "bun:test";
import { navigateComputerToInspectionTarget } from "./computer-inspection-navigation";

describe("Computer inspection page preparation", () => {
  test("navigates the shared browser to the session page before inspection starts", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    await navigateComputerToInspectionTarget(
      "https://x.com/blendibyl/status/2094216957734355275?s=46",
      async (input, init) => {
        calls.push({ input: String(input), init });
        return new Response(JSON.stringify({ url: input, title: "X post" }), { status: 200 });
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/computer/browser/navigate");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      url: "https://x.com/blendibyl/status/2094216957734355275?s=46",
    });
  });

  test("does not mutate the shared browser when the session has no page target", async () => {
    let calls = 0;
    await navigateComputerToInspectionTarget(null, async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    expect(calls).toBe(0);
  });
});
