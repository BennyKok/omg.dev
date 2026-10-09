import { afterAll, describe, expect, test } from "bun:test";
import { createForkSession } from "../src/session-fork.ts";
import { NO_PROJECT } from "../src/no-project-chat.ts";

const requests: Record<string, unknown>[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const body = await request.json();
    requests.push(body);
    if (body.prompt === "paused") return Response.json({ error: "Agent activation paused" }, { status: 503 });
    return Response.json({ ok: true, sessionId: "replacement" });
  },
});
afterAll(() => server.stop(true));

const repo = { cwd: "/repos/example", project: "example", name: "example" };
const create = (sourceProject: string | undefined, repos = [repo], sourceCwd = "/chats/source") =>
  createForkSession({
    endpoint: `http://127.0.0.1:${server.port}/api/sessions/new`,
    sourceCwd,
    sourceProject,
    repos,
    body: { prompt: "Read the source transcript", title: "Original title", agent: "codex", user: "owner" },
  });

describe("session fork creation", () => {
  test("continues a no-project session through unassigned creation", async () => {
    const response = await create(NO_PROJECT);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sessionId: "replacement" });
    expect(requests.at(-1)).toEqual({
      unassigned: true,
      prompt: "Read the source transcript",
      title: "Original title",
      agent: "codex",
      user: "owner",
    });
  });

  test("no-project creation works with an empty repo picker", async () => {
    expect((await create(NO_PROJECT, [])).status).toBe(200);
    expect(requests.at(-1)?.unassigned).toBe(true);
    expect(requests.at(-1)).not.toHaveProperty("cwd");
  });

  test("a normal no-project fork does not need an inherited title", async () => {
    const response = await createForkSession({
      endpoint: `http://127.0.0.1:${server.port}/api/sessions/new`,
      sourceCwd: "/chats/source",
      sourceProject: NO_PROJECT,
      repos: [],
      body: { prompt: "Continue the task" },
    });
    expect(response.status).toBe(200);
    expect(requests.at(-1)).toEqual({ prompt: "Continue the task", unassigned: true });
  });

  test("preserves creation failures from the normal activation gate", async () => {
    const response = await createForkSession({
      endpoint: `http://127.0.0.1:${server.port}/api/sessions/new`,
      sourceCwd: "/chats/source",
      sourceProject: NO_PROJECT,
      repos: [],
      body: { prompt: "paused" },
    });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Agent activation paused" });
  });

  test("an explicit no-project label wins over a matching cwd", async () => {
    expect((await create(NO_PROJECT, [repo], repo.cwd)).status).toBe(200);
    expect(requests.at(-1)?.unassigned).toBe(true);
    expect(requests.at(-1)).not.toHaveProperty("cwd");
  });

  test("project sessions still create in the listed repo", async () => {
    expect((await create(repo.project)).status).toBe(200);
    expect(requests.at(-1)?.cwd).toBe(repo.cwd);
    expect(requests.at(-1)).not.toHaveProperty("unassigned");
  });

  test("legacy records with no project field still resolve by cwd", async () => {
    expect((await create(undefined, [repo], repo.cwd)).status).toBe(200);
    expect(requests.at(-1)?.cwd).toBe(repo.cwd);
  });

  test("missing project repos stay an error without launching a session", async () => {
    const count = requests.length;
    const response = await create("missing");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "source session repo is not in the repo picker" });
    expect(requests.length).toBe(count);
  });
});
