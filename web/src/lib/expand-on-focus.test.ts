// The drawer → page morph, exercised as behaviour rather than as source text.
//
// finding-sheet-page-mode.test.ts guards that each sheet is WIRED to the hook;
// this file guards what the hook actually decides. The rules that matter are
// the ones that were painful to get right: focus expands, a tap on the sheet's
// own buttons must not fold it back under the click, focus moving between
// fields is not "left the sheet", and typed work pins it open.

import { describe, expect, test, beforeAll, afterEach } from "bun:test";
import { Window } from "happy-dom";

// The hook calls window.setTimeout / document.activeElement at module scope of
// the render, so a DOM has to exist before React is imported.
const win = new Window({ url: "https://local.test" });
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  // Without this React refuses to batch inside act() and every state update
  // lands outside the assertion window — the tests would pass on timing luck.
  g.IS_REACT_ACT_ENVIRONMENT = true;
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "MutationObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
  ]) {
    g[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

type Harness = {
  root: HTMLElement;
  paged: () => boolean;
  focus: (el: Element) => Promise<void>;
  blur: () => Promise<void>;
  pointerDown: () => Promise<void>;
};

// Drive the hook without React: it is a small state machine over four inputs,
// and the handlers are plain functions. Re-implementing the wiring here would
// be testing a copy, so instead render it for real with react-dom.
async function mount(): Promise<Harness> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useExpandOnFocus } = await import("./expand-on-focus.ts");

  let handlers: ReturnType<typeof useExpandOnFocus> | null = null;

  function Sheet() {
    const morph = useExpandOnFocus();
    handlers = morph;
    return React.createElement(
      "div",
      {
        "data-testid": "content",
        className: morph.paged ? "lfg-sheet-page" : "",
      },
      React.createElement("input", { "data-testid": "a" }),
      React.createElement("input", { "data-testid": "b" }),
      React.createElement("button", { "data-testid": "save" }, "Save"),
    );
  }

  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const reactRoot = createRoot(host as unknown as HTMLElement);
  await act(async () => {
    reactRoot.render(React.createElement(Sheet));
  });

  const root = host.firstElementChild as unknown as HTMLElement;
  const call = async (fn: () => void) => {
    await act(async () => {
      fn();
    });
  };

  return {
    root,
    paged: () => root.className.includes("lfg-sheet-page"),
    focus: async (el) => {
      (el as unknown as HTMLElement).focus();
      await call(() => handlers?.onFocusCapture({ target: el }));
    },
    blur: async () => {
      await call(() => handlers?.onBlurCapture({ currentTarget: root }));
    },
    pointerDown: async () => {
      await call(() => handlers?.onPointerDownCapture());
    },
  };
}

const field = (h: Harness, id: string) =>
  h.root.querySelector(`[data-testid="${id}"]`) as unknown as HTMLInputElement;

// The fold-back is deliberately delayed so blur cannot outrun the click that
// caused it. Every assertion about folding has to wait out that delay.
let settle = async () => {
  await new Promise((r) => setTimeout(r, 400));
};
{
  const { act } = await import("react");
  settle = async () => {
    // The fold-back lands from a timer, i.e. outside any event handler, so the
    // resulting re-render has to be flushed inside act() as well.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
  };
}

afterEach(() => {
  win.document.body.innerHTML = "";
});

describe("useExpandOnFocus", () => {
  test("focusing a field turns the sheet into a page", async () => {
    const h = await mount();
    expect(h.paged()).toBe(false);
    await h.focus(field(h, "a"));
    await settle();
    expect(h.paged()).toBe(true);
  });

  test("focusing a non-field (a button) does not", async () => {
    // Tapping "Save" must not re-lay-out the sheet under the finger.
    const h = await mount();
    await h.focus(field(h, "save"));
    await settle();
    expect(h.paged()).toBe(false);
  });

  test("leaving the last empty field folds it back down", async () => {
    const h = await mount();
    const a = field(h, "a");
    await h.focus(a);
    await settle();
    expect(h.paged()).toBe(true);
    a.blur();
    await h.blur();
    await settle();
    expect(h.paged()).toBe(false);
  });

  test("typed work pins the sheet open", async () => {
    // Dismissing the keyboard must not throw away a half-written prompt.
    const h = await mount();
    const a = field(h, "a");
    await h.focus(a);
    await settle();
    a.value = "half a thought";
    a.blur();
    await h.blur();
    await settle();
    expect(h.paged()).toBe(true);
  });

  test("focus moving to another field in the sheet is not leaving it", async () => {
    const h = await mount();
    await h.focus(field(h, "a"));
    await settle();
    await h.blur();
    field(h, "b").focus();
    await settle();
    expect(h.paged()).toBe(true);
  });

  test("a pointer-down cancels a pending fold-back", async () => {
    // blur fires before click: without the cancel, the button the user is
    // reaching for moves out from under the tap.
    const h = await mount();
    const a = field(h, "a");
    await h.focus(a);
    await settle();
    a.blur();
    await h.blur();
    await h.pointerDown();
    await settle();
    expect(h.paged()).toBe(true);
  });

  test("disabled means disabled: no page mode, ever", async () => {
    const React = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { useExpandOnFocus } = await import("./expand-on-focus.ts");
    function Off() {
      const morph = useExpandOnFocus(false);
      morph.onFocusCapture({ target: win.document.createElement("input") });
      return React.createElement("i", { className: morph.paged ? "paged" : "card" });
    }
    expect(renderToString(React.createElement(Off))).toContain("card");
  });
});
