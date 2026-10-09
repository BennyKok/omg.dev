import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { attachComputerClipboard } from "./computer-clipboard";

const w = new Window();
class Stream extends w.EventTarget {
  viewOnly = true;
  pasted: string[] = [];
  keys: { key: number; down?: boolean }[] = [];
  clipboardPasteFrom(text: string) { this.pasted.push(text); }
  sendKey(key: number, _code: string | null, down?: boolean) { this.keys.push({ key, down }); }
  received(text: string) { this.dispatchEvent(new w.CustomEvent("clipboard", { detail: { text } })); }
}
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });
function setup(overrides: Record<string, unknown> = {}) {
  const root = w.document.createElement("div");
  const field = w.document.createElement("textarea");
  root.append(field);
  w.document.body.append(root);
  const stream = new Stream();
  const notices: string[] = [];
  const writes: string[] = [];
  let focus = 0;
  const clipboard = attachComputerClipboard(stream as unknown as Parameters<typeof attachComputerClipboard>[0], root as unknown as HTMLElement, {
    notice: text => notices.push(text),
    focusKeyboard: () => { focus++; field.focus(); },
    readText: async () => "two lines\n中文 🔑",
    writeText: async text => { writes.push(await text); },
    copyTimeoutMs: 5,
    ...overrides,
  });
  cleanups.push(() => { clipboard.dispose(); root.remove(); });
  return { root, field, stream, notices, writes, clipboard, focused: () => focus };
}

test("touch Paste transfers multiline Unicode before Ctrl+V and takes control", async () => {
  const t = setup();
  await t.clipboard.pasteFromDevice();
  expect(t.stream.viewOnly).toBe(false);
  expect(t.stream.pasted).toEqual(["two lines\n中文 🔑"]);
  expect(t.stream.keys.filter(k => k.down).map(k => k.key)).toEqual([0xffe3, 0x76]);
  expect(t.notices).toEqual(["Pasted"]);
});

test("Copy waits for the selected remote text and writes only after a user action", async () => {
  const t = setup();
  t.stream.received("old clipboard");
  expect(t.writes).toEqual([]);
  const copy = t.clipboard.copy();
  t.stream.received("new selection 中文");
  await copy;
  expect(t.writes).toEqual(["new selection 中文"]);
});

test("copying an unchanged selection uses the connection's clipboard", async () => {
  const t = setup(); t.stream.received("same selection");
  await t.clipboard.copy();
  expect(t.writes).toEqual(["same selection"]);
});

test("Mac paste focuses the editable fallback and sends no premature remote key", () => {
  const t = setup({ readText: undefined });
  const key = new w.KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true, cancelable: true });
  t.field.dispatchEvent(key);
  expect(t.focused()).toBe(1);
  expect(t.stream.keys).toHaveLength(0);
  expect(key.defaultPrevented).toBe(false);
});

test("OS paste is consumed once without changing the keyboard pad", () => {
  const t = setup(); t.field.value = "\n".repeat(64);
  const event = new w.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => "paste once" } });
  let duplicate = false;
  t.field.addEventListener("paste", () => { duplicate = true; });
  t.field.dispatchEvent(event);
  expect(t.stream.pasted).toEqual(["paste once"]);
  expect(t.field.value).toHaveLength(64);
  expect(duplicate).toBe(false);
  expect(event.defaultPrevented).toBe(true);
});

test("native clipboard shortcuts use native actions instead of WebView permissions", async () => {
  const t = setup();
  const event = new w.KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true });
  t.field.dispatchEvent(event);
  await Promise.resolve();
  expect(t.stream.pasted).toEqual(["two lines\n中文 🔑"]);
  expect(event.defaultPrevented).toBe(true);
});

test("denied paste offers the keyboard menu and does not send keys", async () => {
  const t = setup({ readText: async () => { throw new Error("Permission denied"); } });
  await t.clipboard.pasteFromDevice();
  expect(t.focused()).toBe(1);
  expect(t.notices).toEqual(["Use the keyboard's Paste menu"]);
  expect(t.stream.keys).toHaveLength(0);
});

test("disconnect removes listeners and cancels a pending copy without leaking text", async () => {
  const t = setup();
  const copy = t.clipboard.copy();
  t.clipboard.dispose();
  t.stream.received("after disconnect");
  await copy;
  expect(t.writes).toEqual([]);
  const other = setup();
  await other.clipboard.copy();
  expect(other.notices).toEqual(["Select text on the Computer first"]);
});

test("UTF-8 copy reads the exact desktop selection even without an RFB clipboard event", async () => {
  const t = setup({ readRemoteText: async () => "中文 🔑\nline two" });
  await t.clipboard.copy();
  expect(t.writes).toEqual(["中文 🔑\nline two"]);
});

test("failed remote clipboard write never sends a paste key", async () => {
  const t = setup({ setRemoteText: async () => { throw new Error("offline"); } });
  expect(await t.clipboard.paste("hello")).toBe(false);
  expect(t.stream.keys).toEqual([]);
  expect(t.notices).toEqual(["Could not update the Computer clipboard"]);
});

test("an older Computer can paste ASCII but does not silently corrupt Unicode", async () => {
  const t = setup({ setRemoteText: async () => { throw Object.assign(new Error("missing"), { status: 404 }); } });
  expect(await t.clipboard.paste("hello")).toBe(true);
  expect(t.stream.pasted).toEqual(["hello"]);
  expect(await t.clipboard.paste("中文")).toBe(false);
  expect(t.stream.pasted).toEqual(["hello"]);
  expect(t.notices.at(-1)).toBe("Update this Computer to paste Unicode text");
});

test("a touch press acts immediately and its compatibility click cannot paste twice", async () => {
  const { clipboardButtonHandlers } = await import("./computer-clipboard");
  const t = setup();
  let actions = 0;
  const handlers = clipboardButtonHandlers(() => { actions++; void t.clipboard.pasteFromDevice(); });
  let prevented = false;
  handlers.onPointerDown({ currentTarget: t.root, preventDefault() { prevented = true; } });
  handlers.onClick({ currentTarget: t.root });
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(prevented).toBe(true);
  expect(actions).toBe(1);
  expect(t.stream.pasted).toHaveLength(1);
});


test("touch clipboard actions wait for the activating release and ignore the following click", async () => {
  const { clipboardButtonHandlers } = await import("./computer-clipboard");
  const target = w.document.createElement("button");
  let actions = 0;
  const handlers = clipboardButtonHandlers(() => actions++);
  const event = { currentTarget: target, pointerType: "touch", preventDefault() {} };
  handlers.onPointerDown(event);
  expect(actions).toBe(0);
  handlers.onPointerUp(event);
  handlers.onClick(event);
  expect(actions).toBe(1);
});

test("a second Paste press while the native clipboard request is pending cannot duplicate input", async () => {
  let resolve!: (text: string) => void;
  const t = setup({ readText: () => new Promise<string>(done => { resolve = done; }) });
  const first = t.clipboard.pasteFromDevice();
  await t.clipboard.pasteFromDevice();
  resolve('one paste');
  await first;
  expect(t.stream.pasted).toEqual(['one paste']);
});

test("compatibility clicks are ignored, while keyboard and accessible activation still work", async () => {
  const { clipboardButtonHandlers } = await import("./computer-clipboard");
  const target = w.document.createElement('button');
  let actions = 0;
  const handlers = clipboardButtonHandlers(() => actions++);
  handlers.onPointerDown({ currentTarget: target, pointerType: 'mouse', preventDefault() {} });
  handlers.onClick({ currentTarget: target, detail: 1 });
  expect(actions).toBe(1);
  handlers.onClick({ currentTarget: target, detail: 0 });
  expect(actions).toBe(2);
});
