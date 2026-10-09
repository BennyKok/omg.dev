import { NO_PROJECT } from "./no-project-chat.ts";
import { projectName } from "./projects.ts";
import type { RepoEntry } from "./repo-resolve.ts";

/** Fork through the normal creation endpoint so launch policy has one owner. */
export async function createForkSession(options: {
  endpoint: string;
  sourceCwd: string;
  sourceProject?: string | null;
  repos: RepoEntry[];
  body: Record<string, unknown>;
}): Promise<Response> {
  const { sourceCwd, sourceProject, repos } = options;
  // Empty project is intentional. Do not infer a repo from its scratch cwd.
  const unassigned = sourceProject === NO_PROJECT;
  const repo = unassigned ? undefined : (
    repos.find((r) => r.cwd === sourceCwd) ??
    repos.find((r) => r.project === sourceProject) ??
    repos.find((r) => r.project === projectName(sourceCwd))
  );
  if (!unassigned && !repo) {
    return Response.json({ error: "source session repo is not in the repo picker" }, { status: 400 });
  }
  return fetch(options.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...options.body,
      ...(unassigned ? { unassigned: true } : { cwd: repo!.cwd }),
    }),
  });
}
