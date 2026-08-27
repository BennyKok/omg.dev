import { describe, expect, test } from "bun:test";
import { deepseekHarnessArgv } from "./deepseek-acp-session.ts";

describe("DeepSeek Harness ACP launch", () => {
  test("boots the dedicated omg profile with its ACP overlay", () => {
    expect(deepseekHarnessArgv("/opt/omg/config/deepseek-acp.patch.yml")).toEqual([
      "--profile",
      "omg",
      "--patch",
      "/opt/omg/config/deepseek-acp.patch.yml",
    ]);
  });
});
