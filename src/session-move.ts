import { stat } from "node:fs/promises";
import { createNoProjectWorkspace, NO_PROJECT } from "./no-project-chat.ts";
import { repoForRequestedSessionCwd, type RepoEntry } from "./repo-resolve.ts";
import { moveCommandFileSession, sessionIsMoving } from "./session-recovery.ts";

export async function handleSessionMove(request: Request, options: {
  sessionId: string;
  tmuxName?: string | null;
  busy?: boolean;
  queued?: boolean;
  repos: RepoEntry[];
  move?: typeof moveCommandFileSession;
  chatWorkspace?: typeof createNoProjectWorkspace;
}): Promise<Response> {
  const fail = (status: number, error: string) => Response.json({ error }, { status });
  const body = await request.json().catch(() => null) as { cwd?: unknown; unassigned?: unknown } | null;
  if (!body || (body.cwd !== undefined && typeof body.cwd !== "string") ||
      (body.unassigned !== undefined && typeof body.unassigned !== "boolean"))
    return fail(400, "Expected a folder or unassigned: true");
  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if ((body.unassigned === true && cwd) || (body.unassigned !== true && !cwd))
    return fail(400, "Select one destination folder");
  if (options.busy || options.queued) return fail(409, "Wait for the agent and queued messages to finish before moving this session");
  if (sessionIsMoving(options.sessionId)) return fail(409, "The session is already moving");
  if (!options.tmuxName) return fail(409, "This session must be resumed before it can move");

  let target: { cwd: string; project: string; repoRoot?: string };
  if (body.unassigned === true) {
    target = {
      cwd: await (options.chatWorkspace ?? createNoProjectWorkspace)(options.tmuxName),
      project: NO_PROJECT,
      repoRoot: undefined,
    };
  } else {
    const repo = repoForRequestedSessionCwd(options.repos, cwd, undefined);
    if (!repo || repo.cwd !== cwd) return fail(400, "Select a folder from this computer's project list");
    if (!await stat(repo.cwd).then((s) => s.isDirectory()).catch(() => false))
      return fail(400, "The destination folder no longer exists");
    target = { cwd: repo.cwd, project: repo.project, repoRoot: repo.cwd };
  }
  const result = await (options.move ?? moveCommandFileSession)(options.sessionId, target);
  return result.ok ? Response.json(result) : fail(result.status, result.error);
}
