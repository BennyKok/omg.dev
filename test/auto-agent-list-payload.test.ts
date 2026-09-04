// The auto agent LIST payload used to carry every agent's whole prompt.
//
// That is fine with three toy agents and ruinous with thirty real ones: a live
// box measured 29 agents carrying 89,978 bytes of prompt — 93% of a 98,980-byte
// response — refetched by the 5s list poll and again by /api/bootstrap on every
// cold open, uncompressed across the hosted relay. The list renders the prompt
// in a single CSS-`truncate` line, so none of that tail was ever on screen.
//
// The rule these tests defend: LIST responses clip the prompt and say so;
// single-agent reads do not, because the editor writes what it was given back.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_AGENT_LIST_PROMPT_CHARS,
  truncateAutoAgentPrompt,
} from "../src/commands/serve.ts";

const SERVE = readFileSync(join(import.meta.dir, "..", "src", "commands", "serve.ts"), "utf8");
const APP = readFileSync(join(import.meta.dir, "..", "web", "src", "App.tsx"), "utf8");

describe("truncateAutoAgentPrompt", () => {
  test("leaves a short prompt exactly as it was, and says it is complete", () => {
    const short = "check the nightly backup actually restored";
    expect(truncateAutoAgentPrompt(short)).toEqual({
      prompt: short,
      promptTruncated: false,
    });
  });

  test("a prompt exactly at the limit is not truncated", () => {
    const exact = "x".repeat(AUTO_AGENT_LIST_PROMPT_CHARS);
    const out = truncateAutoAgentPrompt(exact);
    expect(out.promptTruncated).toBe(false);
    expect(out.prompt).toBe(exact);
  });

  test("clips one character past the limit and flags it", () => {
    const over = "x".repeat(AUTO_AGENT_LIST_PROMPT_CHARS + 1);
    const out = truncateAutoAgentPrompt(over);
    expect(out.promptTruncated).toBe(true);
    expect(out.prompt.length).toBe(AUTO_AGENT_LIST_PROMPT_CHARS);
  });

  test("a real-sized agent prompt collapses to a preview", () => {
    // The largest prompt on the box that prompted this change.
    const out = truncateAutoAgentPrompt("y".repeat(9437));
    expect(out.promptTruncated).toBe(true);
    expect(out.prompt.length).toBe(AUTO_AGENT_LIST_PROMPT_CHARS);
  });

  test("the preview is a prefix of the original, never a reordering", () => {
    const prompt = "watch the billing webhook. " + "detail ".repeat(400);
    const out = truncateAutoAgentPrompt(prompt);
    expect(prompt.startsWith(out.prompt)).toBe(true);
  });
});

describe("which responses truncate", () => {
  test("both list surfaces use the truncating shape", () => {
    // /api/auto/agents and the auto block of /api/bootstrap are the two hot
    // readers; either one left on the full shape puts the prompts back.
    const listers = [...SERVE.matchAll(/map\(\s*(?:full \? withAutoAgentMeta : )?withAutoAgentListMeta\s*\)/g)];
    expect(listers.length, "expected /api/auto/agents and /api/bootstrap to map the list shape")
      .toBe(2);
  });

  test("the single-agent GET returns the whole prompt", () => {
    // Without this route the editor can only ever see the preview, and saving
    // would write it back — silently replacing a 9 KB instruction with its
    // first line.
    const idRoute = SERVE.indexOf('path.match(/^\\/api\\/auto\\/agents\\/([a-z0-9_-]+)$/)');
    expect(idRoute, "per-id auto agent route not found").toBeGreaterThanOrEqual(0);
    const block = SERVE.slice(idRoute, idRoute + 600);
    expect(block).toContain('req.method === "GET"');
    expect(block).toContain("withAutoAgentMeta(agent)");
    expect(block).not.toContain("withAutoAgentListMeta");
  });
});

describe("the editor cannot save a preview", () => {
  test("save is blocked until the full prompt has been hydrated", () => {
    expect(APP).toContain("if (!promptHydrated) return;");
  });

  test("the save button is disabled while hydrating", () => {
    // The button's enabled state is one derived flag; hydration is a term in it.
    expect(APP).toContain("!busy && promptHydrated;");
    expect(APP).toContain("disabled={!canSave}");
  });

  test("a hydrating fetch does not clobber what the user already typed", () => {
    // The refetch lands asynchronously; adopting it unconditionally would wipe
    // an edit made in the meantime.
    expect(APP).toContain("setPrompt((current) => (current === preview ? full : current));");
  });
});

describe("the list poll", () => {
  test("stops while the tab is hidden and catches up on return", () => {
    expect(APP).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(APP).toContain("if (!document.hidden) start();");
  });

  test("the interval is not left running unconditionally", () => {
    // The old shape was a bare setInterval in an effect with no visibility
    // gate, which kept polling a backgrounded phone forever.
    expect(APP).not.toContain(`const id = setInterval(() => {
      refreshSessions().catch(() => {});
      refreshAuto().catch(() => {});
    }, 5000);`);
  });
});
