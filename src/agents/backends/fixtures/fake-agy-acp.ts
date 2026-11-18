#!/usr/bin/env bun
// A stand-in for `agy acp` that speaks just enough ACP over stdio for the
// runtime tests: initialize, session/new, session/resume, set_config_option,
// prompt and close. Each process appends one JSON line per request to
// FAKE_AGY_LOG, with its pid, so a test can see which process served what.
import { appendFileSync } from "node:fs";

const log = process.env.FAKE_AGY_LOG!;
const record = (entry: Record<string, unknown>) =>
  appendFileSync(log, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
const send = (message: Record<string, unknown>): void => void
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

const configOptions = [
  {
    type: "select",
    id: "thinking",
    name: "Thinking level",
    category: "thought_level",
    currentValue: "medium",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
];

function handle(message: { id?: number; method?: string; params?: Record<string, unknown> }): void {
  if (!message.method || message.id == null) return;
  record({ method: message.method, params: message.params });
  const reply = (result: unknown): void => send({ id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {} } },
      });
    case "session/new":
      return reply({ sessionId: "fake-conversation", configOptions });
    case "session/resume":
      return reply({ configOptions });
    case "session/set_config_option":
      return reply({ configOptions });
    case "session/prompt": {
      const sessionId = message.params?.sessionId;
      send({
        method: "session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `reply from ${process.pid}` } },
        },
      });
      // Real agy streams text long before the turn ends; answer on a later
      // tick so the update is handled before the prompt resolves.
      setTimeout(() => reply({ stopReason: "end_turn" }), 20);
      return;
    }
    default:
      return reply({});
  }
}

let buffered = "";
process.stdin.on("data", (chunk) => {
  buffered += chunk.toString();
  let newline = buffered.indexOf("\n");
  while (newline >= 0) {
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    if (line) handle(JSON.parse(line));
    newline = buffered.indexOf("\n");
  }
});
