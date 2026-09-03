import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plug, Plus, Shield, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ViewToggleKey } from "@/lib/viewer-role";
import { Input } from "@/components/ui/input";
import { ConnectorsNativePanel } from "./connectors-native";

// ---------------------------------------------------------------------------
// Types mirrored from the server. Kept small on purpose; the server is the
// validator, this page only stops obviously wrong input before a round trip.
// ---------------------------------------------------------------------------

export type RuleAction = "allow" | "block";
export type SandboxMode = "none" | "bwrap";
export type NetworkMode = "shared" | "allowlist";
export type RoleRule = { pattern: string; action: RuleAction };
export type Role = {
  id: string;
  name: string;
  defaultAction: RuleAction;
  rules: RoleRule[];
  sandbox: SandboxMode;
  network: NetworkMode;
  allowHosts: string[];
  views: RoleViews;
  members: string[];
  createdAt: number;
  updatedAt: number;
};
export type RoleViews = { hide: ViewToggleKey[]; hiddenPages: string[] };

/** Same rows as Settings > View. A role can only turn a switch off. */
export const VIEW_TOGGLE_ROWS: { key: ViewToggleKey; label: string }[] = [
  { key: "showSidebarAgentIcons", label: "Agent icons in the sidebar" },
  { key: "showSessionAgentIcons", label: "Agent icons in chat" },
  { key: "showSessionDiffBar", label: "Worktree diff badge in chat" },
  { key: "showComposerAgents", label: "Agent picker in the composer" },
  { key: "showComposerModels", label: "Model picker in the composer" },
  { key: "showBots", label: "Bots" },
  { key: "showSchedules", label: "Schedules" },
];

/** Pages a role may hide. Live and Settings stay so a role cannot lock itself out. */
export const HIDEABLE_PAGE_ROWS: { id: string; label: string }[] = [
  { id: "notifications", label: "Notifications" },
  { id: "artifacts", label: "Artifacts" },
  { id: "board", label: "Board" },
  { id: "computer", label: "Computer" },
  { id: "auto", label: "Schedules page" },
  { id: "usage", label: "Provider limits" },
  { id: "coding-agents", label: "Coding agents" },
  { id: "term", label: "Terminal" },
  { id: "browser", label: "Browser" },
  { id: "changelog", label: "Changelog" },
];

type RosterUser = { email: string; name?: string };


type Tab = "roles" | "connectors";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** The Settings row that opens this page. */
export function ConnectorsRow({ onOpen, roleCount }: { onOpen: () => void; roleCount: number | null }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors duration-150 ease-ios hover:bg-foreground/[0.03] active:bg-foreground/[0.06]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-muted text-foreground/70">
          <Shield className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">Roles &amp; tool access</span>
          <span className="block truncate text-xs text-muted-foreground">
            {roleCount === null ? "Which tools each session may use" : `${roleCount} role${roleCount === 1 ? "" : "s"}`}
          </span>
        </span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ConnectorsPage() {
  const [tab, setTab] = useState<Tab>("roles");
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-10" data-lfg-page-column>
      <div>
        <h1 className="text-lg font-semibold">Tool access</h1>
        <p className="text-sm text-muted-foreground">
          Roles decide which tools a session can see and call. Connectors are MCP servers you add,
          scoped to you and shared across your agents.
        </p>
      </div>
      <div role="tablist" className="flex gap-1 rounded-xl bg-muted p-1 text-sm">
        {(
          [
            ["roles", "Roles", Users],
            ["connectors", "Connectors", Plug],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 ${
              tab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      {tab === "roles" ? <RolesPanel /> : null}
      {tab === "connectors" ? <ConnectorsNativePanel /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const ACTION_LABEL: Record<RuleAction, string> = { allow: "Allow", block: "Block" };

const PATTERN_HELP = [
  "*",
  "omg.*",
  "omg.ship",
  "computer.*",
  "executor.*",
  "executor.execute",
];

export function RolesPanel() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The roster is who can be a member. Missing roster (no LFG_USERS) just
    // leaves the member picker as a free email field.
    void call<{ users: RosterUser[] }>("/api/users")
      .then((payload) => setRoster(Array.isArray(payload.users) ? payload.users : []))
      .catch(() => setRoster([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const { roles } = await call<{ roles: Role[] }>("/api/roles");
      setRoles(roles);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load roles");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await call("/api/roles", { method: "POST", body: JSON.stringify({ name, defaultAction: "block", rules: [] }) });
      setNewName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not create the role");
    } finally {
      setBusy(false);
    }
  };

  const editable = useMemo(() => (roles ?? []).filter((r) => r.id !== "owner"), [roles]);

  return (
    <section className="space-y-4" aria-label="Roles">
      <div className="rounded-2xl border border-border bg-card/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground text-background">
            <Users className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Owner</span>
            <span className="block text-xs text-muted-foreground">
              Built in. Every tool, no rules. Sessions without a role run as owner.
            </span>
          </span>
        </div>
      </div>

      {editable.map((role) => (
        <RoleCard key={role.id} role={role} roster={roster} onChanged={load} onError={setError} />
      ))}

      <form
        className="flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New role name, e.g. Marketing"
          aria-label="New role name"
          className="h-8"
        />
        <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
          Add role
        </Button>
      </form>

      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Tool ids are <code>server.tool</code>: <code>omg.ship</code>, <code>computer.screenshot</code>,{" "}
        <code>executor.execute</code>. A trailing <code>*</code> matches the rest. Block wins over
        allow. Tools with no matching rule get the role&apos;s default.
      </p>
    </section>
  );
}

function RoleCard({
  role,
  roster,
  onChanged,
  onError,
}: {
  role: Role;
  roster: RosterUser[];
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [pattern, setPattern] = useState("");
  const [memberDraft, setMemberDraft] = useState("");
  const views = role.views ?? { hide: [], hiddenPages: [] };
  const members = role.members ?? [];
  const unassigned = roster.filter((u) => !members.includes(u.email.toLowerCase()));
  const [action, setAction] = useState<RuleAction>("allow");
  const [busy, setBusy] = useState(false);

  const [hostDraft, setHostDraft] = useState("");
  const save = async (patch: Partial<Pick<Role, "name" | "defaultAction" | "rules" | "sandbox" | "network" | "allowHosts" | "views" | "members">>) => {
    setBusy(true);
    try {
      await call(`/api/roles/${role.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      onError(null);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not save the role");
    } finally {
      setBusy(false);
    }
  };

  const addRule = async () => {
    const p = pattern.trim();
    if (!p) return;
    await save({ rules: [...role.rules, { pattern: p, action }] });
    setPattern("");
  };

  const remove = async () => {
    setBusy(true);
    try {
      await call(`/api/roles/${role.id}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not delete the role");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border" data-role-id={role.id}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-primary text-white">
          <Users className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{role.name}</span>
          <span className="block text-xs text-muted-foreground">
            id <code>{role.id}</code> · {role.rules.length} rule{role.rules.length === 1 ? "" : "s"}
          </span>
        </span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Default
          <select
            aria-label={`Default action for ${role.name}`}
            value={role.defaultAction}
            disabled={busy}
            onChange={(e) => void save({ defaultAction: e.target.value as RuleAction })}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="block">Block</option>
            <option value="allow">Allow</option>
          </select>
        </label>
        <button
          type="button"
          aria-label={`Delete role ${role.name}`}
          disabled={busy}
          onClick={() => void remove()}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="min-w-0">
          <span className="block text-sm">Sandbox</span>
          <span className="block text-xs text-muted-foreground">
            Run this role&apos;s sessions with an empty home and only their worktree writable.
          </span>
        </span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <select
            aria-label={`Sandbox for ${role.name}`}
            value={role.sandbox}
            disabled={busy}
            onChange={(e) => void save({ sandbox: e.target.value as SandboxMode })}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="none">Off</option>
            <option value="bwrap">Filesystem (bwrap)</option>
          </select>
        </label>
      </div>

      <div className="space-y-2 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm">Network</span>
            <span className="block text-xs text-muted-foreground">
              Allowlist restricts outbound traffic to the model APIs plus the hosts below.
            </span>
          </span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <select
              aria-label={`Network for ${role.name}`}
              value={role.network}
              disabled={busy}
              onChange={(e) => void save({ network: e.target.value as NetworkMode })}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="shared">Shared</option>
              <option value="allowlist">Allowlist</option>
            </select>
          </label>
        </div>
        {role.network === "allowlist" ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {role.allowHosts.length === 0 ? (
                <span className="text-xs text-muted-foreground">Model APIs only. Add a host to allow more.</span>
              ) : null}
              {role.allowHosts.map((host) => (
                <span key={host} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                  <code>{host}</code>
                  <button
                    type="button"
                    aria-label={`Remove host ${host}`}
                    disabled={busy}
                    onClick={() => void save({ allowHosts: role.allowHosts.filter((h) => h !== host) })}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const host = hostDraft.trim().toLowerCase();
                if (!host || role.allowHosts.includes(host)) return;
                void save({ allowHosts: [...role.allowHosts, host] }).then(() => setHostDraft(""));
              }}
            >
              <Input
                value={hostDraft}
                onChange={(e) => setHostDraft(e.target.value)}
                placeholder="host, e.g. github.com or .corp.example"
                aria-label={`New allowed host for ${role.name}`}
                className="h-8 font-mono text-xs"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={busy || !hostDraft.trim()}>
                Add host
              </Button>
            </form>
          </div>
        ) : null}
      </div>

      <div className="space-y-2 px-4 py-2.5">
        <span className="block text-sm">Views</span>
        <span className="block text-xs text-muted-foreground">
          What this role does not see in the web UI. Layout only: tool rules below are the real limit.
        </span>
        <div className="grid gap-1 sm:grid-cols-2">
          {VIEW_TOGGLE_ROWS.map((row) => {
            const hidden = views.hide.includes(row.key);
            return (
              <label key={row.key} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  aria-label={`${row.label} for ${role.name}`}
                  checked={!hidden}
                  disabled={busy}
                  onChange={(e) =>
                    void save({
                      views: {
                        ...views,
                        hide: e.target.checked ? views.hide.filter((k) => k !== row.key) : [...views.hide, row.key],
                      },
                    })
                  }
                />
                {row.label}
              </label>
            );
          })}
        </div>
        <span className="block pt-1 text-xs text-muted-foreground">Pages</span>
        <div className="grid gap-1 sm:grid-cols-2">
          {HIDEABLE_PAGE_ROWS.map((page) => {
            const hidden = views.hiddenPages.includes(page.id);
            return (
              <label key={page.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  aria-label={`${page.label} page for ${role.name}`}
                  checked={!hidden}
                  disabled={busy}
                  onChange={(e) =>
                    void save({
                      views: {
                        ...views,
                        hiddenPages: e.target.checked
                          ? views.hiddenPages.filter((id) => id !== page.id)
                          : [...views.hiddenPages, page.id],
                      },
                    })
                  }
                />
                {page.label}
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 px-4 py-2.5">
        <span className="block text-sm">Members</span>
        <span className="block text-xs text-muted-foreground">
          Roster users who view and start sessions as this role. A user belongs to one role; anyone unlisted is the owner.
        </span>
        <div className="flex flex-wrap gap-1.5">
          {members.length === 0 ? <span className="text-xs text-muted-foreground">No members.</span> : null}
          {members.map((email) => (
            <span key={email} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
              <span>{roster.find((u) => u.email.toLowerCase() === email)?.name ?? email}</span>
              <button
                type="button"
                aria-label={`Remove member ${email}`}
                disabled={busy}
                onClick={() => void save({ members: members.filter((m) => m !== email) })}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const email = memberDraft.trim().toLowerCase();
            if (!email || members.includes(email)) return;
            void save({ members: [...members, email] }).then(() => setMemberDraft(""));
          }}
        >
          {unassigned.length > 0 ? (
            <select
              aria-label={`Add member to ${role.name}`}
              value={memberDraft}
              disabled={busy}
              onChange={(e) => setMemberDraft(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="">Pick a user</option>
              {unassigned.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name ? `${u.name} (${u.email})` : u.email}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={memberDraft}
              onChange={(e) => setMemberDraft(e.target.value)}
              placeholder="email"
              aria-label={`Add member to ${role.name}`}
              className="h-8 text-xs"
            />
          )}
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !memberDraft.trim()}>
            Add member
          </Button>
        </form>
      </div>

      <ul className="divide-y divide-border">
        {role.rules.length === 0 ? (
          <li className="px-4 py-2 text-xs text-muted-foreground">No rules. Every tool gets the default.</li>
        ) : null}
        {role.rules.map((rule, index) => (
          <li key={`${rule.pattern}-${index}`} className="flex items-center gap-3 px-4 py-2 text-sm">
            <code className="min-w-0 flex-1 truncate text-xs">{rule.pattern}</code>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                rule.action === "allow" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
              }`}
            >
              {ACTION_LABEL[rule.action]}
            </span>
            <button
              type="button"
              aria-label={`Remove rule ${rule.pattern}`}
              disabled={busy}
              onClick={() => void save({ rules: role.rules.filter((_, i) => i !== index) })}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <form
        className="flex items-center gap-2 px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void addRule();
        }}
      >
        <Input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="pattern, e.g. executor.*"
          aria-label={`New rule pattern for ${role.name}`}
          list={`patterns-${role.id}`}
          className="h-8 font-mono text-xs"
        />
        <datalist id={`patterns-${role.id}`}>
          {PATTERN_HELP.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <select
          aria-label={`New rule action for ${role.name}`}
          value={action}
          onChange={(e) => setAction(e.target.value as RuleAction)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="allow">Allow</option>
          <option value="block">Block</option>
        </select>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !pattern.trim()}>
          Add rule
        </Button>
      </form>
    </div>
  );
}
