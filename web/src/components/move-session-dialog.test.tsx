import { beforeEach, afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { MoveSessionDialog } = await import("./move-session-dialog");
let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("offers folders, sends the destination, and refreshes the existing chat", async () => {
  const writes: unknown[] = [];
  let refreshed = false;
  let closed = false;
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (path === "/api/repos") return { repos: [{ name: "example", cwd: "/repos/example", project: "example" }] } as T;
    writes.push({ path, body: JSON.parse(String(init?.body)) });
    return { ok: true } as T;
  };
  ui.render(<MoveSessionDialog sessionId="same-chat" currentProject="" request={request}
    onMoved={async () => { refreshed = true; }} onClose={() => { closed = true; }} />);
  await ui.flushAsync();
  const buttons = [...document.querySelectorAll("button")];
  expect(buttons.find((b) => b.textContent?.includes("No project"))?.disabled).toBe(true);
  const destination = buttons.find((b) => b.textContent?.includes("example"));
  expect(destination).toBeDefined();
  ui.flush(() => destination!.click());
  await ui.flushAsync();
  expect(writes).toEqual([{ path: "/api/sessions/same-chat/move", body: { cwd: "/repos/example" } }]);
  expect(refreshed).toBe(true);
  expect(closed).toBe(true);
});

test("shows a refusal and keeps the picker open", async () => {
  let closed = false;
  const request = async <T,>(path: string): Promise<T> => {
    if (path === "/api/repos") return { repos: [] } as T;
    throw new Error("Wait for the agent to finish");
  };
  ui.render(<MoveSessionDialog sessionId="same-chat" currentProject="example" request={request}
    onMoved={async () => { throw new Error("must not refresh"); }} onClose={() => { closed = true; }} />);
  await ui.flushAsync();
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("No project"));
  ui.flush(() => button!.click());
  await ui.flushAsync();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Wait for the agent to finish");
  expect(closed).toBe(false);
});
