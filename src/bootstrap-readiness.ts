type Agent = { key: string; label: string; visible?: boolean; status?: { configured?: boolean; accountConnected?: boolean } };
type Repo = { name: string; cwd: string };

/** The mobile readiness view shares the normal bootstrap's roster owners. */
export async function readinessBootstrap(
  loaders: { codingAgents: () => Promise<Agent[]>; repos: () => Promise<Repo[]> },
  identity: { version: string; bootId: string },
): Promise<Response> {
  const started = performance.now();
  const [agents, repos] = await Promise.allSettled([
    Promise.resolve().then(loaders.codingAgents),
    Promise.resolve().then(loaders.repos),
  ]);
  return Response.json({
    ...identity,
    codingAgents: agents.status === "fulfilled" ? agents.value.map(({ key, label, visible, status }) => ({
      key, label, visible,
      status: status ? { configured: status.configured, accountConnected: status.accountConnected } : undefined,
    })) : null,
    repos: repos.status === "fulfilled" ? repos.value.map(({ name, cwd }) => ({ name, cwd })) : null,
  }, { headers: {
    "Cache-Control": "no-cache",
    "Server-Timing": `bootstrap;dur=${(performance.now() - started).toFixed(1)}`,
  } });
}
