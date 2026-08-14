import { describe, expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import {
  acpResumeStrategy,
  advertisedAcpSessionMethods,
  applyAcpSessionUpdate,
  bindAcpConversation,
  type AcpUpdateState,
} from "./acp-session.ts";
import type { ManagedSdkEventSink } from "./managed-sdk-session.ts";

function sinkRecorder() {
  const drafts: string[] = [];
  const tools: string[] = [];
  const sink: ManagedSdkEventSink = {
    draft(text) {
      drafts.push(text);
    },
    thinking() {},
    toolStart(id, name) {
      tools.push(`start:${id}:${name}`);
    },
    toolEnd(id, name) {
      tools.push(`end:${id}:${name}`);
    },
    async ask() {
      return null;
    },
  };
  return { sink, drafts, tools };
}

describe("ACP initialize capabilities", () => {
  test("defaults load/resume/close to unsupported", () => {
    expect(advertisedAcpSessionMethods({})).toEqual({
      loadSession: false,
      resume: false,
      close: false,
    });
    expect(advertisedAcpSessionMethods({
      agentCapabilities: { loadSession: false, sessionCapabilities: {} },
    })).toEqual({
      loadSession: false,
      resume: false,
      close: false,
    });
  });

  test("treats advertised resume/close objects as supported", () => {
    expect(advertisedAcpSessionMethods({
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {}, close: {} },
      },
    })).toEqual({
      loadSession: true,
      resume: true,
      close: true,
    });
  });

  test("never selects session/load when the agent does not advertise it", () => {
    expect(acpResumeStrategy({ loadSession: false, resume: false, close: false }, "sess-1")).toBe("new");
    expect(acpResumeStrategy({ loadSession: true, resume: false, close: false }, "sess-1")).toBe("load");
    expect(acpResumeStrategy({ loadSession: true, resume: true, close: false }, "sess-1")).toBe("resume");
    expect(acpResumeStrategy({ loadSession: true, resume: true, close: false })).toBe("new");
  });
});

describe("ACP load replay suppression", () => {
  test("ignores load-history notifications so tools and drafts are not duplicated", () => {
    const { sink, drafts, tools } = sinkRecorder();
    const state: AcpUpdateState = { draft: "", thought: "", replaying: true };
    applyAcpSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "old answer" },
    }, sink, state);
    applyAcpSessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Read",
      status: "completed",
    }, sink, state);
    expect(drafts).toEqual([]);
    expect(tools).toEqual([]);
    expect(state.draft).toBe("");

    state.replaying = false;
    applyAcpSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "fresh" },
    }, sink, state);
    expect(drafts).toEqual(["fresh"]);
    expect(state.draft).toBe("fresh");
  });
});

describe("bindAcpConversation", () => {
  test("opens a new session when loadSession is unsupported", async () => {
    const methods: string[] = [];
    const { sink } = sinkRecorder();
    const state: AcpUpdateState = { draft: "", thought: "", replaying: false };
    const opened = await bindAcpConversation({
      cwd: "/tmp",
      mcpServers: [],
      resume: "old-session",
      state,
      sink,
      context: {
        async request(method, params) {
          methods.push(method);
          if (method === "initialize") {
            return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false } };
          }
          if (method === "session/new") {
            expect(params).toEqual(expect.objectContaining({ cwd: "/tmp" }));
            return { sessionId: "fresh-session" };
          }
          throw new Error(`unexpected ${method}`);
        },
      },
    });
    expect(opened.sessionId).toBe("fresh-session");
    expect(methods).toEqual(["initialize", "session/new"]);
  });

  test("prefers session/resume over session/load", async () => {
    const methods: string[] = [];
    const { sink } = sinkRecorder();
    const opened = await bindAcpConversation({
      cwd: "/tmp",
      mcpServers: [],
      resume: "old-session",
      state: { draft: "", thought: "", replaying: false },
      sink,
      context: {
        async request(method) {
          methods.push(method);
          if (method === "initialize") {
            return {
              protocolVersion: acp.PROTOCOL_VERSION,
              agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
            };
          }
          if (method === "session/resume") return {};
          throw new Error(`unexpected ${method}`);
        },
      },
    });
    expect(opened.sessionId).toBe("old-session");
    expect(methods).toEqual(["initialize", "session/resume"]);
  });

  test("session/load replay notifications do not reach the sink", async () => {
    const { sink, drafts, tools } = sinkRecorder();
    const state: AcpUpdateState = { draft: "stale", thought: "old", replaying: false };
    let loadStarted = false;
    const agent = acp.agent({ name: "load-replay-agent" })
      .onRequest(acp.methods.agent.initialize, ({ params }) => ({
        protocolVersion: params.protocolVersion,
        agentCapabilities: { loadSession: true },
        authMethods: [],
      }))
      .onRequest(acp.methods.agent.session.load, async ({ client }) => {
        loadStarted = state.replaying;
        await client.notify(acp.methods.client.session.update, {
          sessionId: "old-session",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "replayed" } },
        });
        await client.notify(acp.methods.client.session.update, {
          sessionId: "old-session",
          update: { sessionUpdate: "tool_call", toolCallId: "call-replay", title: "Read", status: "completed" },
        });
        return {};
      })
      .onRequest(acp.methods.agent.session.new, () => {
        throw new Error("session/new must not run when loadSession is advertised");
      });
    const client = acp.client({ name: "load-replay-client" })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        applyAcpSessionUpdate(params.update, sink, state);
      });

    await client.connectWith(agent, async (context) => {
      const opened = await bindAcpConversation({
        context,
        cwd: "/tmp",
        mcpServers: [],
        resume: "old-session",
        state,
        sink,
      });
      expect(opened.sessionId).toBe("old-session");
      expect(opened.methods.loadSession).toBe(true);
    });

    expect(loadStarted).toBe(true);
    expect(state.replaying).toBe(false);
    expect(state.draft).toBe("");
    expect(drafts.at(-1)).toBe("");
    expect(tools).toEqual([]);
  });
});
