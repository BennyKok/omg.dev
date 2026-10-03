import { expect, test } from "bun:test";
import { isBrowserLoginCall } from "./browser-login";

test("a login call matches bare, MCP-qualified, and retired names", () => {
  expect(isBrowserLoginCall("mcp__omg__omg_request_browser_login")).toBe(true);
  expect(isBrowserLoginCall("omg_request_browser_login: {\"url\":\"https://a.dev\"}")).toBe(true);
  expect(isBrowserLoginCall("lfg_request_browser_login")).toBe(true);
});

test("other tools do not match", () => {
  expect(isBrowserLoginCall("mcp__omg__omg_browser_login_status")).toBe(false);
  expect(isBrowserLoginCall("Bash: echo omg_request_browser_login")).toBe(false);
  expect(isBrowserLoginCall(undefined)).toBe(false);
});
