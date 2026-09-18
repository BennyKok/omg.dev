import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCloudAppsClient } from "../../packages/cloud/src/apps.ts";
import { cmdApps } from "./apps.ts";

function capture() {
  const lines: string[] = [];
  return {
    lines,
    output: (line: string) => lines.push(line),
    error: (line: string) => lines.push(line),
    text: () => lines.join("\n"),
  };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

test("omg whoami prints the Cloud email", async () => {
  const log = capture();
  const client = createCloudAppsClient({
    getAuthToken: async () => "tok",
    fetch: async () => json({ userId: "u1", email: "ada@example.com" }),
    endpoints: { controlPlaneOrigin: "https://backend.example" },
  });
  expect(await cmdApps(["whoami"], { ...log, client })).toBe(0);
  expect(log.text()).toBe("ada@example.com");
});

test("omg deploy publishes cwd and prints the URL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omg-deploy-cli-"));
  writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
  const log = capture();
  const client = createCloudAppsClient({
    getAuthToken: async () => "tok",
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("deploy-source")) {
        return json({
          slug: "hi",
          url: "https://hi.omgs.app",
          status: "accepted",
          projectId: "p1",
          runId: "r1",
          dashboardUrl: "https://omg.dev/p1",
        });
      }
      return json({ slug: "hi", phase: "ready", url: "https://hi.omgs.app", status: "ready" });
    },
    endpoints: { controlPlaneOrigin: "https://backend.example" },
  });
  expect(
    await cmdApps(["deploy", "--name", "Hi"], {
      ...log,
      client,
      cwd: () => dir,
      sleep: async () => {},
    }),
  ).toBe(0);
  expect(log.text()).toContain("https://hi.omgs.app");
  rmSync(dir, { recursive: true, force: true });
});

test("omg login is a no-op on an inherited Computer", async () => {
  const log = capture();
  const account = {
    status: () => ({
      signedIn: true,
      inherited: true,
      email: null,
      expiresAt: null,
      kind: null,
      authUrl: "https://auth.omg.dev",
      thisBoxId: null,
    }),
  };
  expect(await cmdApps(["login"], { ...log, account: account as never })).toBe(0);
  expect(log.text()).toContain("already uses the owner's Cloud account");
});
