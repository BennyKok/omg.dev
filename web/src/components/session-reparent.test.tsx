import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { Session } from "../App";
const { SessionReparentProvider, SessionReparentTarget, SESSION_DRAG_TYPE, TOUCH_ARM_MS, useSessionDragMenuGuard } = await import("./session-reparent");
const { getSubagentGroupChoices, resetSubagentGroupChoices } = await import("../lib/subagent-group-open");
const { toast } = await import("sonner");
const { RailItem, CompactSessionRow } = await import("../App");

let ui: Mounted;
const child: Session = { sessionId: "child", title: "Child", managed: true, tmuxName: "child" };
const parent: Session = { sessionId: "parent", title: "Parent", managed: true, tmuxName: "parent" };
const grandchild: Session = { sessionId: "grandchild", parentSessionId: "child", managed: true, tmuxName: "grandchild" };
beforeEach(() => { ui = mount(); resetSubagentGroupChoices(); });
afterEach(() => { ui.cleanup(); toast.dismiss(); });

function transfer() {
  const data = new Map<string, string>();
  return {
    types: [] as string[], effectAllowed: "uninitialized", dropEffect: "none",
    setData(type: string, value: string) { data.set(type, value); this.types = [...data.keys()]; },
    getData(type: string) { return data.get(type) || ""; },
  };
}
function drag(target: Element, type: string, dataTransfer: ReturnType<typeof transfer>, relatedTarget?: Element) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { dataTransfer: { value: dataTransfer }, relatedTarget: { value: relatedTarget } });
  ui.flush(() => target.dispatchEvent(event));
  return event;
}
const row = (id: string) => ui.query(`[data-session-drag-id="${id}"]`)!;

test("the app's actual rail rows support reparenting without opening the session", async () => {
  let moved = 0;
  let opened = 0;
  ui.render(<SessionReparentProvider sessions={[child, parent]} onRefresh={async () => {}}
    request={async <T,>() => { moved++; return { parentNotified: true } as T; }}>
    {[child, parent].map((session) => <RailItem key={session.sessionId} session={session} users={[]} userFilter="__all"
      busy={false} latest="" active={false} cursored={false} pinned={false} topPinned={false} collapsed={false}
      onActivate={() => { opened++; }} onTogglePin={() => {}} />)}
  </SessionReparentProvider>);
  const data = transfer();
  drag(row("child"), "dragstart", data);
  drag(row("parent"), "dragover", data);
  drag(row("parent"), "drop", data);
  await ui.flushAsync();
  expect(moved).toBe(1);
  expect(opened).toBe(0);
});

test("compact list rows support reparenting without opening the session", async () => {
  let moved = 0;
  let opened = 0;
  ui.render(<SessionReparentProvider sessions={[child, parent]} onRefresh={async () => {}}
    request={async <T,>() => { moved++; return { parentNotified: true } as T; }}>
    {[child, parent].map((session) => <CompactSessionRow key={session.sessionId} session={session} users={[]} userFilter="__all"
      busy={false} dense onOpen={() => { opened++; }} />)}
  </SessionReparentProvider>);
  expect(row("child").getAttribute("draggable")).toBe("true");
  const data = transfer();
  drag(row("child").querySelector("button")!, "dragstart", data);
  expect(drag(row("parent"), "dragover", data).defaultPrevented).toBe(true);
  expect(ui.text()).toContain("Move under Parent");
  drag(row("parent"), "drop", data);
  await ui.flushAsync();
  expect(moved).toBe(1);
  expect(opened).toBe(0);
});

test("a rendered drag highlights a valid parent, saves once, opens its children, and refreshes", async () => {
  const writes: unknown[] = [];
  let refreshed = 0;
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    writes.push({ path, body: JSON.parse(String(init?.body)) });
    return { ok: true, changed: true, parentNotified: true } as T;
  };
  ui.render(<SessionReparentProvider sessions={[child, parent, grandchild]} request={request} onRefresh={async () => { refreshed++; }}>
    {[child, parent, grandchild].map((session) => <SessionReparentTarget key={session.sessionId} session={session}>
      <button>{session.title || session.sessionId}</button>
    </SessionReparentTarget>)}
  </SessionReparentProvider>);
  const data = transfer();
  drag(row("child").querySelector("button")!, "dragstart", data);
  expect(data.getData(SESSION_DRAG_TYPE)).toBe("child");
  expect(data.effectAllowed).toBe("move");
  expect(drag(row("parent"), "dragover", data).defaultPrevented).toBe(true);
  expect(row("parent").getAttribute("data-session-drop-target")).toBe("true");
  expect(ui.text()).toContain("Move under Parent");
  drag(row("parent"), "drop", data);
  drag(row("parent"), "drop", data);
  await ui.flushAsync();
  expect(writes).toEqual([{ path: "/api/sessions/reparent", body: { sessionId: "child", parentSessionId: "parent" } }]);
  expect(refreshed).toBe(1);
  expect(getSubagentGroupChoices().get("parent")).toBe(true);
  expect(ui.query("[data-session-drop-target]")).toBeNull();
  expect(toast.getHistory().at(-1)).toMatchObject({ type: "success", title: "Session moved. Parent session notified." });
});

test("self, descendants, and the current parent reject a drop", () => {
  const originalParent = { ...parent, nativeSessionId: "native-parent" };
  const source = { ...child, parentSessionId: "native-parent" };
  let writes = 0;
  ui.render(<SessionReparentProvider sessions={[source, originalParent, grandchild]}
    request={async <T,>() => { writes++; return {} as T; }} onRefresh={async () => {}}>
    {[source, originalParent, grandchild].map((session) => <SessionReparentTarget key={session.sessionId} session={session}>{session.sessionId}</SessionReparentTarget>)}
  </SessionReparentProvider>);
  const data = transfer();
  drag(row("child"), "dragstart", data);
  for (const id of ["child", "parent", "grandchild"]) {
    expect(drag(row(id), "dragover", data).defaultPrevented).toBe(false);
    drag(row(id), "drop", data);
  }
  expect(writes).toBe(0);
  expect(ui.query("[data-session-drop-target]")).toBeNull();
});

test("unmanaged rows cannot be dragged and external text and files are ignored", () => {
  const external = { ...child, managed: false };
  let writes = 0;
  ui.render(<SessionReparentProvider sessions={[external, parent]}
    request={async <T,>() => { writes++; return {} as T; }} onRefresh={async () => {}}>
    <SessionReparentTarget session={external}>External</SessionReparentTarget>
    <SessionReparentTarget session={parent}>Parent</SessionReparentTarget>
  </SessionReparentProvider>);
  expect(row("child").getAttribute("draggable")).toBe("false");
  const data = transfer();
  drag(row("child"), "dragstart", data);
  expect(data.types).toEqual([]);
  data.setData("text/plain", "child");
  data.types.push("Files");
  expect(drag(row("parent"), "dragover", data).defaultPrevented).toBe(false);
  drag(row("parent"), "drop", data);
  expect(writes).toBe(0);
});

test("drag leave and drag cancellation clear the target hint", () => {
  ui.render(<SessionReparentProvider sessions={[child, parent]} onRefresh={async () => {}}>
    <SessionReparentTarget session={child}>Child</SessionReparentTarget>
    <SessionReparentTarget session={parent}><button>Parent</button></SessionReparentTarget>
  </SessionReparentProvider>);
  const data = transfer();
  drag(row("child"), "dragstart", data);
  drag(row("parent"), "dragover", data);
  drag(row("parent"), "dragleave", data, row("parent").querySelector("button")!);
  expect(ui.query("[data-session-drop-target]")).not.toBeNull();
  drag(row("parent"), "dragleave", data);
  expect(ui.query("[data-session-drop-target]")).toBeNull();
  drag(row("parent"), "dragover", data);
  drag(row("child"), "dragend", data);
  expect(ui.query("[data-session-drop-target]")).toBeNull();
  drag(row("child"), "dragstart", data);
  expect(ui.query("[data-session-drop-target]")).toBeNull();
});

test("a refused move leaves the list unchanged and a later drag can retry", async () => {
  let writes = 0;
  let refreshed = 0;
  ui.render(<SessionReparentProvider sessions={[child, parent]}
    request={async <T,>() => { if (++writes === 1) throw new Error("Parent session not found"); return { parentNotified: false } as T; }}
    onRefresh={async () => { refreshed++; }}>
    <SessionReparentTarget session={child}>Child</SessionReparentTarget>
    <SessionReparentTarget session={parent}>Parent</SessionReparentTarget>
  </SessionReparentProvider>);
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = transfer();
    drag(row("child"), "dragstart", data);
    drag(row("parent"), "drop", data);
    await ui.flushAsync();
    expect(refreshed).toBe(attempt);
    expect(toast.getHistory().at(-1)).toMatchObject(attempt === 0
      ? { type: "error", title: "Parent session not found" }
      : { type: "warning", title: "Session moved. Parent notice failed: Could not send the notice" });
  }
  expect(writes).toBe(2);
});

test("moving under a nested parent opens the root's group", async () => {
  const nestedParent = { ...parent, parentSessionId: "root" };
  const root = { sessionId: "root", title: "Root" };
  ui.render(<SessionReparentProvider sessions={[child, nestedParent, root]}
    request={async <T,>() => ({ parentNotified: true }) as T} onRefresh={async () => {}}>
    <SessionReparentTarget session={child}>Child</SessionReparentTarget>
    <SessionReparentTarget session={nestedParent}>Parent</SessionReparentTarget>
  </SessionReparentProvider>);
  const data = transfer();
  drag(row("child"), "dragstart", data);
  drag(row("parent"), "drop", data);
  await ui.flushAsync();
  expect(getSubagentGroupChoices().get("root")).toBe(true);
});

// Touch drag: phones send no HTML5 drag events for a finger.
function place(id: string, top: number) {
  row(id).getBoundingClientRect = () => ({ left: 0, right: 300, top, bottom: top + 40, width: 300, height: 40, x: 0, y: top, toJSON() {} }) as DOMRect;
}
function finger(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(event, "touches", { value: touches });
  ui.flush(() => target.dispatchEvent(event));
  return event;
}
const hold = () => new Promise((resolve) => setTimeout(resolve, TOUCH_ARM_MS + 40));

function touchList(onOpen: () => void, request: typeof import("../lib/omg-client").api, onGuard?: (guard: ReturnType<typeof useSessionDragMenuGuard>) => void) {
  function Guard() { onGuard?.(useSessionDragMenuGuard()); return null; }
  ui.render(<SessionReparentProvider sessions={[child, parent]} onRefresh={async () => {}} request={request}>
    <Guard />
    {[child, parent].map((session) => <CompactSessionRow key={session.sessionId} session={session} users={[]} userFilter="__all"
      busy={false} onOpen={onOpen} />)}
  </SessionReparentProvider>);
  place("child", 0);
  place("parent", 100);
}

test("a long press then a finger move lifts a compact row onto a new parent", async () => {
  let moved: unknown = null;
  let opened = 0;
  touchList(() => { opened++; }, async <T,>(_path: string, init?: RequestInit) => { moved = JSON.parse(String(init?.body)); return { parentNotified: true } as T; });
  const start = row("child").querySelector("button")!;
  finger(start, "touchstart", 20, 20);
  await hold();
  expect(finger(start, "touchmove", 20, 60).defaultPrevented).toBe(true);
  expect(document.querySelector("[data-session-drag-ghost]")?.textContent).toBe("Child");
  expect(document.querySelector("[data-session-drag-ghost-target]")).toBeNull();
  expect(row("child").getAttribute("data-session-dragging")).toBe("true");
  finger(start, "touchmove", 20, 120);
  expect(row("parent").getAttribute("data-session-drop-target")).toBe("true");
  expect(document.querySelector("[data-session-drag-ghost-target]")?.textContent).toBe("Move under Parent");
  expect(finger(start, "touchend", 0, 0).defaultPrevented).toBe(true);
  await ui.flushAsync();
  expect(moved).toEqual({ sessionId: "child", parentSessionId: "parent" });
  expect(opened).toBe(0);
  expect(document.querySelector("[data-session-drag-ghost]")).toBeNull();
});

test("a quick swipe stays a scroll, and a drop off any parent moves nothing", async () => {
  let writes = 0;
  touchList(() => {}, async <T,>() => { writes++; return {} as T; });
  const start = row("child").querySelector("button")!;
  finger(start, "touchstart", 20, 20);
  expect(finger(start, "touchmove", 20, 60).defaultPrevented).toBe(false);
  await hold();
  expect(finger(start, "touchmove", 20, 120).defaultPrevented).toBe(false);
  expect(document.querySelector("[data-session-drag-ghost]")).toBeNull();
  finger(start, "touchend", 0, 0);

  finger(start, "touchstart", 20, 20);
  await hold();
  finger(start, "touchmove", 20, 70);
  expect(ui.query("[data-session-drop-target]")).toBeNull();
  finger(start, "touchend", 0, 0);
  await ui.flushAsync();
  expect(writes).toBe(0);
});

test("the row menu stays shut during a touch drag and just after the drop", async () => {
  let guard!: ReturnType<typeof useSessionDragMenuGuard>;
  touchList(() => {}, async <T,>() => ({}) as T, (next) => { guard = next; });
  const start = row("child").querySelector("button")!;
  finger(start, "touchstart", 20, 20);
  await hold();
  expect(guard.blocked()).toBe(false);
  finger(start, "touchmove", 20, 60);
  expect(guard.touchDragging).toBe(true);
  expect(guard.blocked()).toBe(true);
  finger(start, "touchend", 0, 0);
  expect(guard.touchDragging).toBe(false);
  expect(guard.blocked()).toBe(true);
});
