// GitHub source, through the `gh` CLI and the account it is signed in to.
//
//   watch "issues"   new open issues in a repo
//   watch "pulls"    new open pull requests in a repo
//   watch "comments" new comments in a repo, or on one issue or PR when `issue` is set
//
// An agent that answers on GitHub would otherwise wake itself with its own
// comment. Anything whose body contains OMG_AGENT_MARKER (types.ts) is skipped, and the
// session action tells the agent to add that marker. maxRunsPerHour on the hook
// is the backstop if an agent forgets.
//
// gh gets its own config (~/.config/gh) through HOME, plus GH_TOKEN /
// GH_HOST / GH_CONFIG_DIR when the service has them. Those reach this built-in
// source only, never a user script.

import { homedir } from "node:os";
import { runBounded } from "../process.ts";
import { OMG_AGENT_MARKER, type NewEvent, type Source } from "../types.ts";
const BODY_MAX = 2_000;
const COMMENT_WINDOW_DAYS = 14;

type Watch = "issues" | "pulls" | "comments";
type GithubSource = { kind: "github"; repo: string; watch: Watch; issue?: number };

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

type Row = {
  id?: number;
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  issue_url?: string;
  pull_request?: unknown;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string } | string>;
};

const clip = (s: string | null | undefined) => (s ?? "").slice(0, BODY_MAX);
const fromAgent = (r: Row) => (r.body ?? "").includes(OMG_AGENT_MARKER);

export function githubEvents(watch: Watch, rows: Row[]): NewEvent[] {
  const out: NewEvent[] = [];
  for (const r of rows) {
    if (fromAgent(r)) continue;
    const author = r.user?.login ?? "unknown";
    if (watch === "comments") {
      const issue = Number(r.issue_url?.split("/").pop());
      out.push({
        key: `comment:${r.id}`,
        topic: "github.comment",
        title: `${author} commented on #${issue}`,
        url: r.html_url,
        data: { issue, author, body: clip(r.body) },
      });
      continue;
    }
    if (watch === "issues" && r.pull_request) continue;
    out.push({
      key: `${watch === "pulls" ? "pull" : "issue"}:${r.number}`,
      topic: watch === "pulls" ? "github.pull" : "github.issue",
      title: `#${r.number} ${r.title ?? ""}`.trim(),
      url: r.html_url,
      data: {
        number: r.number,
        title: r.title,
        author,
        body: clip(r.body),
        labels: (r.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean),
      },
    });
  }
  return out;
}

function apiPath(c: GithubSource, now = Date.now()): string {
  if (c.watch === "pulls") return `repos/${c.repo}/pulls?state=open&sort=created&direction=desc&per_page=50`;
  if (c.watch === "issues") return `repos/${c.repo}/issues?state=open&sort=created&direction=desc&per_page=50`;
  if (c.issue) {
    const since = new Date(now - COMMENT_WINDOW_DAYS * 86_400_000).toISOString();
    return `repos/${c.repo}/issues/${c.issue}/comments?per_page=100&since=${since}`;
  }
  return `repos/${c.repo}/issues/comments?sort=created&direction=desc&per_page=50`;
}

export const githubSource: Source<GithubSource> = {
  kind: "github",
  validate(input) {
    const repo = typeof input.repo === "string" ? input.repo.trim() : "";
    if (!REPO.test(repo)) return { ok: false, error: 'github source needs repo as "owner/name"' };
    const watch = input.watch;
    if (watch !== "issues" && watch !== "pulls" && watch !== "comments")
      return { ok: false, error: 'github source needs watch: "issues", "pulls" or "comments"' };
    let issue: number | undefined;
    if (input.issue !== undefined && input.issue !== null && input.issue !== "") {
      issue = Number(input.issue);
      if (!Number.isInteger(issue) || issue <= 0) return { ok: false, error: "issue must be a positive number" };
      if (watch !== "comments") return { ok: false, error: 'issue only applies to watch: "comments"' };
    }
    return { ok: true, config: { kind: "github", repo, watch, ...(issue ? { issue } : {}) } };
  },
  async collect(config, ctx) {
    const { stdout } = await runBounded(["gh", "api", apiPath(config)], {
      hookId: ctx.hookId,
      cwd: homedir(),
      env: {
        GH_TOKEN: process.env.GH_TOKEN,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        GH_HOST: process.env.GH_HOST,
        GH_CONFIG_DIR: process.env.GH_CONFIG_DIR,
        GH_PROMPT_DISABLED: "1",
        NO_COLOR: "1",
      },
    });
    const rows = JSON.parse(stdout) as Row[];
    if (!Array.isArray(rows)) throw new Error("gh api did not return a list");
    return githubEvents(config.watch, rows);
  },
};
