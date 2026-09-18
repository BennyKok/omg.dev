import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Rocket } from "lucide-react";

import { toast } from "@/lib/notify";
import { api } from "../lib/omg-client";
import { cn } from "../lib/utils";

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

function phaseOf(status: DeployStatus | DeployStart | null): string {
  if (!status) return "";
  return String(("phase" in status ? status.phase : undefined) ?? status.status ?? "").toLowerCase();
}

function publicUrl(info: { slug?: string; url?: string } | null | undefined): string | null {
  if (info?.url) return info.url;
  if (info?.slug) return `https://${info.slug}.omgs.app`;
  return null;
}

/**
 * Deploy or republish one project folder through the box Cloud API.
 *
 * The row that hosts this control stays responsible for selecting the
 * project. Clicks here must not select or close the sheet.
 */
export function ProjectDeployControls({
  cwd,
  name,
  deploy,
  onDeployed,
  request = api,
}: {
  cwd: string;
  name: string;
  deploy?: ProjectDeployInfo | null;
  onDeployed?: (info: ProjectDeployInfo) => void;
  /** Test seam. Production uses the current machine transport. */
  request?: typeof api;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<ProjectDeployInfo | null>(deploy ?? null);

  useEffect(() => {
    setLatest(deploy ?? null);
  }, [deploy?.slug, deploy?.url]);

  const url = publicUrl(latest);
  const label = latest?.slug ? "Redeploy" : "Deploy";

  async function run(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const started = await request<DeployStart>("/api/cloud/apps/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, name, wait: false }),
      });
      if (!started.slug) throw new Error(started.error || "Deploy did not return a slug.");
      let status: DeployStatus = started;
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        const phase = phaseOf(status);
        if (DONE.has(phase) || FAILED.has(phase)) break;
        status = await request<DeployStatus>(
          `/api/cloud/apps/status?slug=${encodeURIComponent(started.slug)}`,
        );
        if (DONE.has(phaseOf(status)) || FAILED.has(phaseOf(status))) break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      const phase = phaseOf(status);
      if (FAILED.has(phase)) {
        throw new Error(status.buildError || `Deploy failed (${phase || "unknown"})`);
      }
      if (!DONE.has(phase)) throw new Error("Deploy is still running. Check the URL in a minute.");
      const info: ProjectDeployInfo = {
        slug: started.slug,
        url: publicUrl(status) ?? publicUrl(started) ?? `https://${started.slug}.omgs.app`,
        projectId: started.projectId,
        name,
      };
      setLatest(info);
      onDeployed?.(info);
      toast.success(`Published ${name}`, { description: info.url });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Deploy failed.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-1" data-project-deploy={cwd} onClick={(event) => event.stopPropagation()}>
      {url && !busy ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={url}
          aria-label={`Open ${name} at ${url}`}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={(event) => void run(event)}
        aria-label={`${label} ${name}`}
        title={error ?? label}
        className={cn(
          "flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium",
          busy ? "text-muted-foreground" : "text-blue-500 hover:bg-blue-500/10",
          "disabled:opacity-60",
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
        {busy ? "Publishing" : label}
      </button>
    </span>
  );
}
