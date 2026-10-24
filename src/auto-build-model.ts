import { isMachineMessage } from "../packages/protocol/src/machine-message.ts";
import { OMG_AUTO_MODEL, OMG_BUILD_MODEL } from "./omg-models.ts";

/**
 * Auto: the first build of a new app runs on the build model, later changes
 * run on Auto (Benny, 2026-10-24).
 *
 * A new-app session (firstRun, or newApp from the composer's no-project
 * Create path) that asks for Auto launches on OMG_BUILD_MODEL
 * and remembers OMG_AUTO_MODEL as the model to move to. The build is
 * everything the agent does for the first message. When the person sends
 * their second message, the session moves to Auto before that message runs.
 * The hosted router resolves both aliases per person, so which concrete
 * models they mean can change without an lfg release.
 */
export function planAutoBuildLaunch(input: {
  agent: string;
  model: string | undefined;
  firstRun: boolean;
  spawnedBy?: string;
}): { model: string | undefined; autoNextModel?: string } {
  const omgAgent = input.agent === "omg" || input.agent === "opencode";
  if (omgAgent && input.firstRun && input.spawnedBy !== "subagent" && input.model === OMG_AUTO_MODEL) {
    return { model: OMG_BUILD_MODEL, autoNextModel: OMG_AUTO_MODEL };
  }
  return { model: input.model };
}

/**
 * The model to switch to before this message runs, or null. Only a message
 * from the person ends the build: agent updates, task notices and
 * marker-prefixed machine messages (for example "[omg builder] ...") do not.
 */
export function autoBuildSwitch(
  record: { autoNextModel?: string } | undefined,
  text: string,
  fromPerson: boolean,
): string | null {
  if (!record?.autoNextModel || !fromPerson || isMachineMessage(text)) return null;
  return record.autoNextModel;
}

export type AutoRouteDeps = {
  /** True on a hosted Computer (the guest LLM proxy is present). */
  hosted: boolean;
  /** The guest proxy origin, for example http://169.254.0.1:9090. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * On a hosted Computer, ask the router whether this new Auto session starts a
 * new project (vibes apps/infra/internal/proxy/route.go: a cheap judge reads
 * the first message). The router answers with an alias: omg/build for a new
 * project, omg/auto for anything else. Any failure, or a self-hosted box,
 * keeps the local guess from planAutoBuildLaunch.
 */
export async function routeAutoLaunch(
  input: Parameters<typeof planAutoBuildLaunch>[0] & { message?: string; project?: string; noProject: boolean },
  deps: AutoRouteDeps,
): Promise<{ model: string | undefined; autoNextModel?: string; routeId?: string; routeSource?: string }> {
  const guess = planAutoBuildLaunch(input);
  const omgAgent = input.agent === "omg" || input.agent === "opencode";
  const message = input.message?.trim() ?? "";
  if (!deps.hosted || !deps.baseUrl || !omgAgent || input.spawnedBy === "subagent" || input.model !== OMG_AUTO_MODEL || !message) {
    return guess;
  }
  try {
    const res = await (deps.fetch ?? fetch)(`${deps.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/omg/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message.slice(0, 4000),
        project: input.project,
        noProject: input.noProject,
        newApp: input.firstRun,
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 2_500),
    });
    if (!res.ok) return { ...guess, routeSource: `http_${res.status}` };
    const answer = (await res.json()) as { alias?: string; routeId?: string; source?: string };
    if (answer.alias === "omg/build") {
      return { model: OMG_BUILD_MODEL, autoNextModel: OMG_AUTO_MODEL, routeId: answer.routeId, routeSource: answer.source };
    }
    if (answer.alias === "omg/auto") return { model: OMG_AUTO_MODEL, routeId: answer.routeId, routeSource: answer.source };
    return guess;
  } catch {
    return { ...guess, routeSource: "unreachable" };
  }
}
