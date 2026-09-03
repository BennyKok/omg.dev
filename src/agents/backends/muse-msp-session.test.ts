import { describe, expect, test } from "bun:test";
import {
  MspClient,
  applyMuseViewEvent,
  museApprovalMode,
  museReasoningEffort,
  museServeArgv,
  museTurnInput,
  museUserInputAnswers,
  newMuseTurnState,
  uuidv7,
} from "./muse-msp-session.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ManagedSdkEventSink } from "./managed-sdk-session.ts";

function recordingSink(): { sink: ManagedSdkEventSink; events: string[] } {
  const events: string[] = [];
  const sink: ManagedSdkEventSink = {
    draft: (text) => events.push(`draft:${text}`),
    thinking: (text) => events.push(`think:${text}`),
    commitText: (text) => events.push(`commit:${text}`),
    toolStart: (id, name, input) => events.push(`toolStart:${id}:${name}:${JSON.stringify(input ?? null)}`),
    toolEnd: (id, name, output, error) => events.push(`toolEnd:${id}:${name}:${String(output)}:${error ? "err" : "ok"}`),
    ask: async () => 0,
  };
  return { sink, events };
}

describe("muse launch vocabulary", () => {
  test("uuidv7 is time-ordered and RFC-shaped", () => {
    const a = uuidv7(1_000_000);
    const b = uuidv7(2_000_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  test("reasoning effort maps omg levels onto Muse's vocabulary", () => {
    expect(museReasoningEffort("high")).toBe("high");
    expect(museReasoningEffort("max")).toBe("ultra");
    expect(museReasoningEffort("off")).toBe("none");
    expect(museReasoningEffort("XHIGH")).toBe("xhigh");
    expect(museReasoningEffort("bogus")).toBeUndefined();
    expect(museReasoningEffort(undefined)).toBeUndefined();
  });

  test("serve argv fixes the sandbox posture and trusts the workspace", () => {
    expect(museServeArgv()).toEqual(["serve", "--disable-sandbox", "--trust-workspace"]);
  });

  test("approval mode defaults to allowAll and only accepts the closed enum", () => {
    expect(museApprovalMode({})).toBe("allowAll");
    expect(museApprovalMode({ LFG_MUSE_APPROVAL_MODE: "onRequest" })).toBe("onRequest");
    expect(museApprovalMode({ LFG_MUSE_APPROVAL_MODE: "yolo" })).toBe("allowAll");
  });
});

describe("MspClient framing", () => {
  test("matches responses to requests and rejects JSON-RPC errors with the error kind", async () => {
    const written: string[] = [];
    const client = new MspClient((line) => written.push(line));
    const ok = client.request("model/list", {});
    const bad = client.request("nope/method", {});
    expect(JSON.parse(written[0]!)).toEqual({ jsonrpc: "2.0", id: 1, method: "model/list", params: {} });
    client.feed('{"id":1,"jsonrpc":"2.0","result":{"models":[]}}\n{"id":2,"jsonrpc":"2.0","error":{"code":-32601,"message":"method not found","data":{"kind":"methodNotFound"}}}\n');
    expect(await ok).toEqual({ models: [] });
    await expect(bad).rejects.toThrow("muse nope/method: method not found (methodNotFound)");
  });

  test("buffers partial lines and dispatches notifications", () => {
    const seen: unknown[] = [];
    const client = new MspClient(() => {});
    client.onNotification("turn/completed", (params) => seen.push(params));
    client.feed('{"jsonrpc":"2.0","method":"turn/comp');
    expect(seen).toEqual([]);
    client.feed('leted","params":{"terminal":"completed"}}\n');
    expect(seen).toEqual([{ terminal: "completed" }]);
  });

  test("acknowledges server-initiated requests and routes them like the notification", () => {
    const written: string[] = [];
    const seen: unknown[] = [];
    const client = new MspClient((line) => written.push(line));
    client.onNotification("approval/requested", (params) => seen.push(params));
    client.feed('{"jsonrpc":"2.0","id":"srv-1","method":"approval/request","params":{"approvalId":"a1"}}\n');
    expect(JSON.parse(written[0]!)).toEqual({ jsonrpc: "2.0", id: "srv-1", result: {} });
    expect(seen).toEqual([{ approvalId: "a1" }]);
  });

  test("close rejects everything still pending", async () => {
    const client = new MspClient(() => {});
    const pending = client.request("turn/start", {});
    client.close("muse serve exited (9)");
    await expect(pending).rejects.toThrow("muse serve exited (9)");
    await expect(client.request("x", {})).rejects.toThrow("muse serve exited (9)");
  });
});

describe("applyMuseViewEvent", () => {
  test("streams agentMessage deltas into the draft and lets the completed item win", () => {
    const { sink, events } = recordingSink();
    const state = newMuseTurnState();
    applyMuseViewEvent("item/started", { item: { itemId: "m1", kind: "agentMessage" } }, sink, state);
    applyMuseViewEvent("item/delta", { itemId: "m1", delta: "Hal" }, sink, state);
    applyMuseViewEvent("item/delta", { itemId: "m1", delta: "lo" }, sink, state);
    applyMuseViewEvent("item/completed", { item: { itemId: "m1", kind: "agentMessage", status: "completed", text: "Hallo wereld" } }, sink, state);
    expect(events).toEqual(["draft:Hal", "draft:Hallo", "draft:Hallo wereld"]);
    expect(state.draft).toBe("Hallo wereld");
  });

  test("commits narration before a tool call and reports the tool result", () => {
    const { sink, events } = recordingSink();
    const state = newMuseTurnState();
    applyMuseViewEvent("item/started", { item: { itemId: "m1", kind: "agentMessage" } }, sink, state);
    applyMuseViewEvent("item/delta", { itemId: "m1", delta: "Ik lees eerst het bestand." }, sink, state);
    applyMuseViewEvent("item/completed", { item: { itemId: "m1", kind: "agentMessage", status: "completed", text: "Ik lees eerst het bestand." } }, sink, state);
    applyMuseViewEvent("item/started", { item: { itemId: "t1", kind: "toolCall", tool: "read_file", args: '{"path":"a.ts"}' } }, sink, state);
    applyMuseViewEvent("item/delta", { itemId: "t1", field: "visibleOutput", delta: "const a = 1;" }, sink, state);
    applyMuseViewEvent("item/completed", { item: { itemId: "t1", kind: "toolCall", tool: "read_file", status: "completed" } }, sink, state);
    applyMuseViewEvent("item/started", { item: { itemId: "m2", kind: "agentMessage" } }, sink, state);
    applyMuseViewEvent("item/delta", { itemId: "m2", delta: "Klaar." }, sink, state);
    expect(events).toContain("commit:Ik lees eerst het bestand.");
    expect(events).toContain('toolStart:t1:read_file:{"path":"a.ts"}');
    expect(events).toContain("toolEnd:t1:read_file:const a = 1;:ok");
    // The second message starts a fresh draft after the commit.
    expect(state.draft).toBe("Klaar.");
  });

  test("a failed tool call is reported as an error with its reason", () => {
    const { sink, events } = recordingSink();
    const state = newMuseTurnState();
    applyMuseViewEvent("item/completed", { item: { itemId: "t1", kind: "toolCall", tool: "shell", status: "failed", failureReason: "exit 1" } }, sink, state);
    expect(events).toEqual(["toolStart:t1:shell:null", "toolEnd:t1:shell:exit 1:err"]);
  });

  test("reasoning summaries stream as thinking", () => {
    const { sink, events } = recordingSink();
    const state = newMuseTurnState();
    applyMuseViewEvent("item/started", { item: { itemId: "r1", kind: "reasoning" } }, sink, state);
    applyMuseViewEvent("item/delta", { itemId: "r1", field: "summary.0", delta: "Denk " }, sink, state);
    applyMuseViewEvent("item/delta", { itemId: "r1", field: "summary.0", delta: "na" }, sink, state);
    applyMuseViewEvent("item/completed", { item: { itemId: "r1", kind: "reasoning", status: "completed", summary: ["Denk na"] } }, sink, state);
    expect(events.at(-1)).toBe("think:Denk na");
    expect(state.thought).toBe("Denk na");
  });

  test("user messages and unknown kinds are ignored", () => {
    const { sink, events } = recordingSink();
    const state = newMuseTurnState();
    applyMuseViewEvent("item/completed", { item: { itemId: "u1", kind: "userMessage", text: "hoi" } }, sink, state);
    applyMuseViewEvent("item/completed", { item: { itemId: "c1", kind: "compaction" } }, sink, state);
    applyMuseViewEvent("session/branchChanged", { branch: "main" }, sink, state);
    expect(events).toEqual([]);
    expect(state.draft).toBe("");
  });
});

describe("museUserInputAnswers", () => {
  test("answers every question by label and cancels when the user declines", async () => {
    const questions = [
      { id: "q1", header: "Deploy?", question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] },
      { id: "q2", header: "Env", question: "Where?", options: [{ label: "prod" }, { label: "staging" }] },
    ];
    expect(await museUserInputAnswers(questions, async (_q, options) => options.length - 1)).toEqual([
      { questionId: "q1", selectedLabel: "No" },
      { questionId: "q2", selectedLabel: "staging" },
    ]);
    expect(await museUserInputAnswers(questions, async () => null)).toBeNull();
  });
});

describe("museTurnInput", () => {
  test("plain prompts stay one text part", () => {
    expect(museTurnInput("hoi")).toEqual([{ type: "text", text: "hoi" }]);
  });

  test("uploaded images become MSP image parts; other uploads stay as path lines", () => {
    const uploads = join(mkdtempSync(join(tmpdir(), "lfg-muse-att-")), "lfg-uploads");
    mkdirSync(uploads);
    const png = join(uploads, "a.png");
    const pdf = join(uploads, "b.pdf");
    writeFileSync(png, Buffer.from([1, 2, 3]));
    writeFileSync(pdf, "%PDF-1.4");
    const parts = museTurnInput(`Kijk\n\nAttached files:\n- a.png: ${png}\n- b.pdf: ${pdf}`);
    expect(parts).toEqual([
      { type: "text", text: `Kijk\n\nAttached files:\n- b.pdf: ${pdf}` },
      { type: "image", mediaType: "image/png", base64Data: "AQID" },
    ]);
  });
});
