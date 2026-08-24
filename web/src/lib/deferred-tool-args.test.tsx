// The client half of the deferToolArgs capability.
//
// The transcript no longer carries tool_use arguments, so the pill has to go
// and get them when a reader opens it. That turns a field read into a network
// call, which means this surface now has a loading state and a failure state
// that did not exist before. These are render-level assertions, because the
// states are what the reader sees.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://127.0.0.1:5173/" });
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const React = await import("react");
const { act } = React;
const {
  isDeferredToolUse,
  deferredToolIds,
  fetchToolArgs,
  useDeferredToolArgs,
} = await import("./deferred-tool-args");
const { toolArgsPath } = await import("./transcript-paging");

const SID = "25ba4d3b-59d2-4c45-87e1-4e406d0bf0c5";
const ARGS = '{"command":"grep -n listen_port /etc/app.conf"}';

const deferredCall = { id: "u1", kind: "tool_use", toolArgsLen: ARGS.length };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Renders whatever the hook reports for one call, as text. */
function Harness(props: {
  open: boolean;
  fetchImpl: typeof fetch;
  messages?: Array<{ id?: string; kind?: string; toolArgsLen?: number }>;
  sid?: string | null;
}) {
  const states = useDeferredToolArgs(
    props.sid === undefined ? SID : props.sid,
    props.messages ?? [deferredCall],
    props.open,
    props.fetchImpl,
  );
  const state = states.u1;
  if (!state) return <div data-testid="state">idle</div>;
  if (state.status === "loading") return <div data-testid="state">loading</div>;
  if (state.status === "error") return <div data-testid="state">error: {state.error}</div>;
  return <div data-testid="state">ready: {state.args}</div>;
}

const text = () => host.querySelector('[data-testid="state"]')?.textContent ?? "";

async function render(element: React.ReactElement) {
  await act(async () => {
    root.render(element);
  });
}

describe("recognising a deferred call", () => {
  test("a marked tool_use with an id is deferred", () => {
    expect(isDeferredToolUse(deferredCall)).toBe(true);
  });

  test("a call with no arguments is not deferred, so it is never fetched", () => {
    // The server sends argument-less calls unchanged and unmarked.
    expect(isDeferredToolUse({ id: "u9", kind: "tool_use" })).toBe(false);
    expect(isDeferredToolUse({ id: "u9", kind: "tool_use", toolArgsLen: 0 })).toBe(false);
  });

  test("an older payload with the arguments inline is not deferred", () => {
    expect(isDeferredToolUse({ id: "u1", kind: "tool_use" })).toBe(false);
  });

  test("only tool calls are ever fetched", () => {
    expect(isDeferredToolUse({ id: "t1", kind: "text", toolArgsLen: 40 })).toBe(false);
    expect(isDeferredToolUse({ id: "h1", kind: "thinking", toolArgsLen: 10 })).toBe(false);
  });

  test("a group reports each deferred id once, in order", () => {
    expect(
      deferredToolIds([
        { id: "h1", kind: "thinking" },
        deferredCall,
        { id: "u2", kind: "tool_use", toolArgsLen: 12 },
        deferredCall,
      ]),
    ).toEqual(["u1", "u2"]);
  });
});

describe("the fetch itself", () => {
  test("asks the session-scoped path and returns the arguments", async () => {
    let asked = "";
    const args = await fetchToolArgs(SID, "u1", (async (url: string) => {
      asked = url;
      return jsonResponse({ id: SID, messageId: "u1", name: "Bash", args: ARGS });
    }) as unknown as typeof fetch);
    expect(asked).toBe(toolArgsPath(SID, "u1"));
    expect(args).toBe(ARGS);
  });

  test("a missing call is a readable message, not a status code", async () => {
    const failing = (async () => jsonResponse({}, 404)) as unknown as typeof fetch;
    await expect(fetchToolArgs(SID, "gone", failing)).rejects.toThrow(
      "Command details are no longer available",
    );
  });

  test("any other failure still names the status", async () => {
    const failing = (async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    await expect(fetchToolArgs(SID, "u1", failing)).rejects.toThrow("(500)");
  });
});

describe("what the reader sees when a pill opens", () => {
  test("a closed pill fetches nothing", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return jsonResponse({ args: ARGS });
    }) as unknown as typeof fetch;
    await render(<Harness open={false} fetchImpl={counting} />);
    expect(calls).toBe(0);
    expect(text()).toBe("idle");
  });

  test("opening shows a loading state, then the arguments", async () => {
    let release: (value: Response) => void = () => {};
    const pending = (async () => new Promise<Response>((resolve) => (release = resolve))) as unknown as typeof fetch;

    await render(<Harness open fetchImpl={pending} />);
    expect(text()).toBe("loading");

    await act(async () => {
      release(jsonResponse({ args: ARGS }));
    });
    expect(text()).toBe(`ready: ${ARGS}`);
  });

  test("a failed fetch shows the error in the pill", async () => {
    const failing = (async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    await render(<Harness open fetchImpl={failing} />);
    expect(text()).toContain("error:");
    expect(text()).toContain("(500)");
  });

  test("a missing call reads as gone rather than as a crash", async () => {
    const missing = (async () => jsonResponse({}, 404)) as unknown as typeof fetch;
    await render(<Harness open fetchImpl={missing} />);
    expect(text()).toBe("error: Command details are no longer available");
  });

  test("re-rendering an open pill does not refetch", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return jsonResponse({ args: ARGS });
    }) as unknown as typeof fetch;
    await render(<Harness open fetchImpl={counting} />);
    await render(<Harness open fetchImpl={counting} />);
    await render(<Harness open fetchImpl={counting} />);
    expect(calls).toBe(1);
    expect(text()).toBe(`ready: ${ARGS}`);
  });

  test("a call with no arguments never reaches the network", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return jsonResponse({ args: "" });
    }) as unknown as typeof fetch;
    await render(
      <Harness open fetchImpl={counting} messages={[{ id: "u1", kind: "tool_use" }]} />,
    );
    expect(calls).toBe(0);
    expect(text()).toBe("idle");
  });

  test("with no session there is nothing to ask", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return jsonResponse({ args: ARGS });
    }) as unknown as typeof fetch;
    await render(<Harness open fetchImpl={counting} sid={null} />);
    expect(calls).toBe(0);
  });

  test("a failure is retried when the reader opens the pill again", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 500) : jsonResponse({ args: ARGS });
    }) as unknown as typeof fetch;

    await render(<Harness open fetchImpl={flaky} />);
    expect(text()).toContain("error:");

    // Close, then reopen: the failed id was not cached, so it is asked again.
    await render(<Harness open={false} fetchImpl={flaky} />);
    await render(<Harness open fetchImpl={flaky} />);
    expect(calls).toBe(2);
    expect(text()).toBe(`ready: ${ARGS}`);
  });
});
