// The Computer Use MCP is on by default, and a session's MCP registration
// follows that setting.
//
// Both halves matter and they used to disagree: the setting existed, the
// endpoint honoured it, and nothing ever registered /mcp/computer with a
// session, so turning it on gave an agent no tools at all.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS, omgMcpServers } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
const originalBase = process.env.LFG_BASE;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-computer-mcp-"));
  PATHS.data = testData;
  process.env.LFG_BASE = "http://127.0.0.1:8766";
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  if (originalBase === undefined) delete process.env.LFG_BASE;
  else process.env.LFG_BASE = originalBase;
  await rm(testData, { recursive: true, force: true });
});

describe("computerMcpEnabled", () => {
  test("defaults on for a box that has never stored the key", () => {
    expect(settings.getGlobalSettingsSync().computerMcpEnabled).toBe(true);
  });

  test("registers the Computer endpoint with a new session", () => {
    const servers = omgMcpServers("session-computer-on").mcpServers!;
    expect(servers.computer).toEqual({
      type: "http",
      url: "http://127.0.0.1:8766/mcp/computer?session=session-computer-on",
      headers: { "x-omg-session-token": expect.any(String) },
    });
  });

  test("persists an off choice and then registers nothing for the Computer", async () => {
    await settings.setGlobalSettings({ computerMcpEnabled: false });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().computerMcpEnabled).toBe(false);
    // The endpoint answers 404 when the setting is off, so a registration here
    // would show the agent a broken server rather than no server.
    const servers = omgMcpServers("session-computer-off").mcpServers!;
    expect(servers.computer).toBeUndefined();
    expect(servers.omg).toBeDefined();
    await settings.setGlobalSettings({ computerMcpEnabled: true });
  });
});
