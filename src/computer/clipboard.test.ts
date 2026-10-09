import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";

let display = 190;
while (existsSync(`/tmp/.X${display}-lock`)) display++;
const env = { ...process.env, DISPLAY: `:${display}` };
const { computerClipboardRequest, readDesktopClipboard, setDesktopClipboard, createClipboardDependency } = await import("./clipboard.ts");
let x: ReturnType<typeof Bun.spawn>;
beforeAll(async () => {
  x = Bun.spawn(["Xvfb", env.DISPLAY, "-screen", "0", "640x480x24", "-nolisten", "tcp"], { stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 30; i++) {
    if (existsSync(`/tmp/.X11-unix/X${display}`)) return;
    await Bun.sleep(50);
  }
  throw new Error("Test X display did not start");
});
afterAll(async () => { x?.kill(); await x?.exited; });

test("the real X clipboard retains multiline Unicode in both directions", async () => {
  const text = "first line\n中文 🔑 café\nlast line";
  await setDesktopClipboard(text, env.DISPLAY);
  expect(await readDesktopClipboard(env.DISPLAY)).toBe(text);
});
test("the stream clipboard route transfers exact text and forbids caching", async () => {
  const text = "clipboard route 日本語 🚀";
  const result = await computerClipboardRequest(new Request("http://localhost/api/computer/clipboard", {
    method: "POST", body: JSON.stringify({ text }),
  }), env.DISPLAY);
  expect(result.ok).toBe(true);
  const response = await computerClipboardRequest(new Request("http://localhost/api/computer/clipboard"), env.DISPLAY);
  expect(await response.json()).toEqual({ text });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
test("an invalid clipboard request cannot replace the existing selection", async () => {
  await setDesktopClipboard("keep this", env.DISPLAY);
  const response = await computerClipboardRequest(new Request("http://localhost/api/computer/clipboard", {
    method: "POST", body: JSON.stringify({ text: 123 }),
  }), env.DISPLAY);
  expect(response.status).toBe(400);
  expect(await readDesktopClipboard(env.DISPLAY)).toBe("keep this");
});

test("concurrent hosted clipboard requests share one dependency install", async () => {
  let installed = false;
  let installs = 0;
  const ready = createClipboardDependency({ installed: () => installed, hosted: () => true, async install() { installs++; await Bun.sleep(10); installed = true; } });
  await Promise.all([ready(), ready(), ready()]);
  await ready();
  expect(installs).toBe(1);
});

test("a local desktop missing xclip reports the dependency without installing packages", async () => {
  let installs = 0;
  const ready = createClipboardDependency({ installed: () => false, hosted: () => false, async install() { installs++; } });
  await expect(ready()).rejects.toThrow("sudo apt-get install -y xclip");
  expect(installs).toBe(0);
});

test("failed helper installation can be retried after the host recovers", async () => {
  let installs = 0;
  let installed = false;
  const ready = createClipboardDependency({ installed: () => installed, hosted: () => true, async install() { if (++installs === 1) throw new Error("offline"); installed = true; } });
  await expect(ready()).rejects.toThrow("offline");
  await ready();
  expect(installs).toBe(2);
});
