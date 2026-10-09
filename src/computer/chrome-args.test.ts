// The desktop Chrome is where a person signs in to real sites. Google blocks
// sign-in when navigator.webdriver is true or the browser has no WebGL, so the
// launch flags must keep both looking like an ordinary browser.
import { expect, test } from "bun:test";
import { DEFAULT_DESKTOP, chromeLaunchArgs } from "./desktop.ts";

test("Chrome keeps navigator.webdriver false and has software WebGL", () => {
  const args = chromeLaunchArgs({ ...DEFAULT_DESKTOP, profileDir: "/p", cdpPort: 0 });
  expect(args).toContain("--disable-blink-features=AutomationControlled");
  expect(args).toContain("--use-angle=swiftshader");
  expect(args).toContain("--enable-unsafe-swiftshader");
  expect(args).not.toContain("--disable-gpu");
  expect(args).toContain("--remote-debugging-port=0");
  expect(args).toContain("--user-data-dir=/p");
});

test("a configured proxy is passed through", () => {
  const args = chromeLaunchArgs({ ...DEFAULT_DESKTOP, profileDir: "/p", proxy: "socks5://127.0.0.1:1080" });
  expect(args).toContain("--proxy-server=socks5://127.0.0.1:1080");
});
