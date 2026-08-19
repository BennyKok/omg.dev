import { describe, expect, test } from "bun:test";
import { fxAcpChildArgs } from "./fx-acp-session.ts";

describe("fx ACP launch arguments", () => {
  test("passes an explicit gateway model through", () => {
    expect(fxAcpChildArgs("anthropic/claude-opus-5")).toEqual([
      "acp",
      "--model",
      "anthropic/claude-opus-5",
    ]);
  });

  /**
   * "auto" is LFG's cross-agent placeholder for "the provider's own default",
   * and every other agent treats it that way. fx has no such id — its catalog
   * is the AI Gateway's `provider/model` strings — so forwarding it would hand
   * fx a model name that does not exist instead of leaving its configured
   * default alone.
   */
  test("keeps LFG's auto placeholder off the command line", () => {
    expect(fxAcpChildArgs("auto")).toEqual(["acp"]);
    expect(fxAcpChildArgs(undefined)).toEqual(["acp"]);
    expect(fxAcpChildArgs("")).toEqual(["acp"]);
  });
});
