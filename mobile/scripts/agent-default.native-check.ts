import { describe, expect, test } from "bun:test";
import { preferredAgent } from "../src/omg/agent-default";

const row = (key: string, connected: boolean) => ({
  key,
  label: key,
  visible: true,
  status: { configured: true, accountConnected: connected },
});

describe("preferredAgent", () => {
  test("a hosted Computer starts the composer on omg, not the first roster entry", () => {
    // Roster order on a fresh hosted box: OpenCode (configured, no account)
    // comes before omg (connected). The composer used to take index 0.
    expect(preferredAgent([row("opencode", false), row("omg", true)])).toBe("omg");
  });

  test("a connected Claude account wins over omg", () => {
    expect(preferredAgent([row("opencode", false), row("omg", true), row("aisdk", true)])).toBe("aisdk");
  });

  test("with nothing connected the preference order still applies", () => {
    expect(preferredAgent([row("opencode", false), row("aisdk", false)])).toBe("aisdk");
  });

  test("an agent outside the preference list is the fallback, and an empty roster is undefined", () => {
    expect(preferredAgent([row("grok", true)])).toBe("grok");
    expect(preferredAgent([])).toBeUndefined();
  });
});
