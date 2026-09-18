import { useCallback, useState } from "react";
import { Linking } from "react-native";

import { useOmg, type Repo } from "./provider";

export type ProjectDeployInfo = {
  slug: string;
  url: string;
  projectId?: string;
  name?: string;
};

type DeployStart = {
  slug?: string;
  url?: string;
  status?: string;
  projectId?: string;
  error?: string;
};

type DeployStatus = {
  slug?: string;
  url?: string;
  status?: string;
  phase?: string;
  buildError?: string;
};

const DONE = new Set(["ready", "succeeded"]);
const FAILED = new Set(["failed", "error"]);

function phaseOf(status: DeployStatus | DeployStart): string {
  return String(("phase" in status ? status.phase : undefined) ?? status.status ?? "").toLowerCase();
}

export function deployUrlForRepo(repo: Repo | undefined): string | null {
  return repo?.deploy?.url ?? (repo?.deploy?.slug ? `https://${repo.deploy.slug}.omgs.app` : null);
}

export function useProjectDeploy() {
  const { client, repos, probe } = useOmg();
  const [busyCwd, setBusyCwd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const urlFor = useCallback(
    (cwd: string) => {
      if (urls[cwd]) return urls[cwd];
      return deployUrlForRepo(repos.find((repo) => repo.cwd === cwd));
    },
    [repos, urls],
  );

  const deploy = useCallback(
    async (cwd: string, name: string) => {
      if (!client || busyCwd) return;
      setBusyCwd(cwd);
      setError(null);
      try {
        const started = await client.transport.request<DeployStart>("/api/cloud/apps/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, name, wait: false }),
        });
        if (!started.slug) throw new Error(started.error || "Deploy did not return a slug.");
        let status: DeployStatus = started;
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
          if (DONE.has(phaseOf(status)) || FAILED.has(phaseOf(status))) break;
          status = await client.transport.request<DeployStatus>(
            `/api/cloud/apps/status?slug=${encodeURIComponent(started.slug)}`,
          );
          if (DONE.has(phaseOf(status)) || FAILED.has(phaseOf(status))) break;
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        const phase = phaseOf(status);
        if (FAILED.has(phase)) throw new Error(status.buildError || `Deploy failed (${phase || "unknown"})`);
        if (!DONE.has(phase)) throw new Error("Deploy is still running. Check the URL in a minute.");
        const url = status.url || started.url || `https://${started.slug}.omgs.app`;
        setUrls((current) => ({ ...current, [cwd]: url }));
        await probe().catch(() => {});
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Deploy failed.");
      } finally {
        setBusyCwd(null);
      }
    },
    [busyCwd, client, probe],
  );

  const open = useCallback(async (cwd: string) => {
    const url = urlFor(cwd);
    if (url) await Linking.openURL(url).catch(() => {});
  }, [urlFor]);

  return { deploy, open, busyCwd, error, urlFor };
}
