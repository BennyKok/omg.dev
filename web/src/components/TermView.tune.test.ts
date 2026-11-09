// tuneGhostty patches two ghostty-web seams. The browser end-to-end test
// (test/browser/terminal-e2e.ts) proves the visible effect; these pin the
// rules: how long a synchronized update may hold a frame, and that the
// browser never answers a terminal query itself.
import { describe, expect, test } from "bun:test";
import { tuneGhostty } from "./TermView";

function fakeTerm() {
  const state = { sync: false, responses: [] as string[], renders: [] as boolean[] };
  const term = {
    wasmTerm: {
      getMode: (mode: number) => mode === 2026 && state.sync,
      readResponse: () => state.responses.shift() ?? null,
    },
    renderer: { render: (_buf: unknown, force?: boolean) => void state.renders.push(!!force) },
    processTerminalResponses: () => {
      throw new Error("the original would emit the reply as typed input");
    },
  };
  return { term, state };
}

describe("tuneGhostty", () => {
  test("frames are held while a synchronized update is open, then painted", () => {
    const { term, state } = fakeTerm();
    let now = 1000;
    tuneGhostty(term, () => now);
    term.renderer.render(null);
    expect(state.renders).toHaveLength(1);
    state.sync = true;
    term.renderer.render(null);
    now += 100;
    term.renderer.render(null);
    expect(state.renders).toHaveLength(1);
    state.sync = false;
    term.renderer.render(null);
    expect(state.renders).toHaveLength(2);
  });

  test("an update that never ends cannot freeze the screen", () => {
    const { term, state } = fakeTerm();
    let now = 0;
    tuneGhostty(term, () => now);
    state.sync = true;
    term.renderer.render(null);
    now = 149;
    term.renderer.render(null);
    expect(state.renders).toHaveLength(0);
    now = 151;
    term.renderer.render(null);
    expect(state.renders).toHaveLength(1);
    // The next hold starts fresh.
    now = 160;
    term.renderer.render(null);
    expect(state.renders).toHaveLength(1);
  });

  test("a forced full redraw (resize) is never held", () => {
    const { term, state } = fakeTerm();
    tuneGhostty(term, () => 0);
    state.sync = true;
    term.renderer.render(null, true);
    expect(state.renders).toEqual([true]);
  });

  test("query replies are drained and dropped: the host already answered", () => {
    const { term, state } = fakeTerm();
    tuneGhostty(term);
    state.responses.push("\x1b[5;1R", "\x1b[?62c");
    expect(() => term.processTerminalResponses()).not.toThrow();
    expect(state.responses).toEqual([]);
  });
});
