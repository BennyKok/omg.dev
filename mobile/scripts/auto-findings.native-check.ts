import { expect, test } from "bun:test";
import type { OmgClient } from "@omg-dev/client";
import { startSessionFromFinding } from "../src/omg/auto-findings";

const finding = { id: "f1", agentId: "watch", title: "Review the outage", reasoning: ["Error rate increased."] };

test("starting work preserves the finding context and agent settings", async () => {
  let request: { path: string; body: any } | undefined;
  const client = { transport: { request: async (path: string, init: RequestInit) => {
    request = { path, body: JSON.parse(String(init.body)) };
    return { sessionId: "new-session" };
  } } } as unknown as OmgClient;
  const id = await startSessionFromFinding(client, finding, {
    id: "watch", name: "Health watch", schedule: "0 * * * *", enabled: true,
    cwd: "/project", agent: "codex-aisdk", model: "gpt-6.1-sol",
  });
  expect(id).toBe("new-session");
  expect(request?.path).toBe("/api/sessions/new");
  expect(request?.body).toMatchObject({ cwd: "/project", agent: "codex-aisdk", model: "gpt-6.1-sol", title: finding.title });
  expect(request?.body.prompt).toContain("Health watch");
  expect(request?.body.prompt).toContain("Error rate increased.");
});

test("an empty launch response cannot resolve the finding", async () => {
  const client = { transport: { request: async () => ({}) } } as unknown as OmgClient;
  await expect(startSessionFromFinding(client, finding, undefined)).rejects.toThrow("The session did not start");
});
