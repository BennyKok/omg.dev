import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plug, Plus, Shield, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  createdAt: number;
  updatedAt: number;
};

/** Executor's own policy row (GET /api/executor/api/policies). */
export type ExecutorPolicy = {
  id: string;
  owner: "org" | "user";
  pattern: string;
  action: "approve" | "require_approval" | "block";
};

// Executor's action literals, with the labels its own UI uses. `approve` is
// "runs without asking", which reads as Allow to anyone who has not seen the
// Executor code.
const GATEWAY_ACTIONS: { value: ExecutorPolicy["action"]; label: string }[] = [
  { value: "approve", label: "Allow" },
  { value: "require_approval", label: "Require approval" },
  { value: "block", label: "Block" },
];

// Every policy this box writes is tenant-wide: one Executor, one org, and
// the omg owner is the one editing it.
const GATEWAY_OWNER: ExecutorPolicy["owner"] = "org";

type Tab = "roles" | "gateway" | "integrations";

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
          Roles decide which tools a session can see and call. Gateway policies are the box-wide
          floor inside the connector gateway. Integrations are where services get connected.
        </p>
      </div>
      <div role="tablist" className="flex gap-1 rounded-xl bg-muted p-1 text-sm">
        {(
          [
            ["roles", "Roles", Users],
            ["gateway", "Gateway policies", Shield],
            ["integrations", "Integrations", Plug],
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
      {tab === "gateway" ? <GatewayPoliciesPanel /> : null}
      {tab === "integrations" ? <IntegrationsPanel /> : null}
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
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

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
        <RoleCard key={role.id} role={role} onChanged={load} onError={setError} />
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
  onChanged,
  onError,
}: {
  role: Role;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<RuleAction>("allow");
  const [busy, setBusy] = useState(false);

  const [hostDraft, setHostDraft] = useState("");
  const save = async (patch: Partial<Pick<Role, "name" | "defaultAction" | "rules" | "sandbox" | "network" | "allowHosts">>) => {
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

// ---------------------------------------------------------------------------
// Gateway (Executor) policies
// ---------------------------------------------------------------------------

export function GatewayPoliciesPanel() {
  const [policies, setPolicies] = useState<ExecutorPolicy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<ExecutorPolicy["action"]>("require_approval");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await call<ExecutorPolicy[] | { policies: ExecutorPolicy[] }>("/api/executor/api/policies");
      setPolicies(Array.isArray(rows) ? rows : rows.policies ?? []);
      setError(null);
    } catch (e) {
      setPolicies(null);
      setError(e instanceof Error ? e.message : "could not load gateway policies");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const p = pattern.trim();
    if (!p) return;
    setBusy(true);
    try {
      await call("/api/executor/api/policies", {
        method: "POST",
        body: JSON.stringify({ owner: GATEWAY_OWNER, pattern: p, action }),
      });
      setPattern("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not add the policy");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await call(`/api/executor/api/policies/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: JSON.stringify({ owner: GATEWAY_OWNER }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not remove the policy");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4" aria-label="Gateway policies">
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        These rules live inside the connector gateway and apply to every session on this box,
        whatever its role. Patterns are integration tool ids such as <code>github.*</code> or{" "}
        <code>gmail.send</code>. The most restrictive matching rule wins.
      </p>
      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
        {policies === null ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            {error ?? "Loading gateway policies."}
          </div>
        ) : policies.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            No gateway policies. Tools fall back to each integration&apos;s default approval behaviour.
          </div>
        ) : (
          policies.map((policy) => (
            <div key={policy.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <code className="min-w-0 flex-1 truncate text-xs">{policy.pattern}</code>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground/80">
                {GATEWAY_ACTIONS.find((a) => a.value === policy.action)?.label ?? policy.action}
              </span>
              <button
                type="button"
                aria-label={`Remove gateway policy ${policy.pattern}`}
                disabled={busy}
                onClick={() => void remove(policy.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
        <form
          className="flex items-center gap-2 px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="pattern, e.g. github.*"
            aria-label="New gateway policy pattern"
            className="h-8 font-mono text-xs"
          />
          <select
            aria-label="New gateway policy action"
            value={action}
            onChange={(e) => setAction(e.target.value as ExecutorPolicy["action"])}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {GATEWAY_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="secondary" disabled={busy || policies === null || !pattern.trim()}>
            Add policy
          </Button>
        </form>
      </div>
      {error && policies !== null ? <p className="px-1 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Integrations: a native panel over the connector gateway's REST API,
// forwarded through omg (/api/executor/api/...) so it works from any device,
// not just a browser on the box. No iframe.
// ---------------------------------------------------------------------------

export type Integration = {
  slug: string;
  name: string;
  description: string;
  kind: string;
  canRemove: boolean;
  canRefresh: boolean;
  authMethods: string[];
};

export type Connection = {
  owner: string;
  integration: string;
  name: string;
  status?: string;
};

export type ToolMeta = {
  address: string;
  integration: string;
  connection: string;
  name: string;
  description: string;
};

async function gateway<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/executor/api${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(body?.error ?? body?.message ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function IntegrationsPanel() {
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ints, conns, tls] = await Promise.all([
        gateway<Integration[]>("/integrations"),
        gateway<Connection[]>("/connections"),
        gateway<ToolMeta[]>("/tools"),
      ]);
      setIntegrations(ints);
      setConnections(conns);
      setTools(tls);
      setError(null);
    } catch (e) {
      setIntegrations(null);
      setError(e instanceof Error ? e.message : "the connector gateway is not running");
    }
  }, []);

  useEffect(() => {
    void load();
    // The dashboard link is the escape hatch for OAuth connect flows, which
    // still need a browser on the box. Loopback only, so it may be null here.
    void fetch("/api/executor/dashboard", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<{ url: string }>) : null))
      .then((p) => setDashboardUrl(p?.url ?? null))
      .catch(() => {});
  }, [load]);

  const removeConnection = async (c: Connection) => {
    setBusy(true);
    try {
      await gateway(`/connections/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.integration)}/${encodeURIComponent(c.name)}`, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not remove the connection");
    } finally {
      setBusy(false);
    }
  };

  const toolsFor = useMemo(() => {
    const by = new Map<string, number>();
    for (const t of tools) by.set(t.integration, (by.get(t.integration) ?? 0) + 1);
    return by;
  }, [tools]);

  const connsFor = useMemo(() => {
    const by = new Map<string, Connection[]>();
    for (const c of connections) {
      const list = by.get(c.integration) ?? [];
      list.push(c);
      by.set(c.integration, list);
    }
    return by;
  }, [connections]);

  if (integrations === null) {
    return (
      <section className="rounded-2xl border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground" aria-label="Integrations">
        {error ?? "Loading integrations."}
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-label="Integrations">
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Services connected to the gateway, and the tools each one exposes to agents. This reads the
        gateway directly, so it works from any device.
      </p>

      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
        {integrations.map((integration) => {
          const conns = connsFor.get(integration.slug) ?? [];
          const toolCount = toolsFor.get(integration.slug) ?? 0;
          return (
            <div key={integration.slug} className="px-4 py-3" data-integration={integration.slug}>
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground text-background">
                  <Plug className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {integration.name}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground/70">
                      {integration.kind}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {toolCount} tool{toolCount === 1 ? "" : "s"}
                    {conns.length ? ` · ${conns.length} connection${conns.length === 1 ? "" : "s"}` : ""}
                  </span>
                </span>
              </div>
              {conns.length ? (
                <ul className="mt-2 space-y-1 pl-10">
                  {conns.map((c) => (
                    <li key={`${c.owner}/${c.name}`} className="flex items-center gap-2 text-xs">
                      <code className="min-w-0 flex-1 truncate">
                        {c.name}
                        <span className="text-muted-foreground"> · {c.owner}</span>
                        {c.status ? <span className="text-muted-foreground"> · {c.status}</span> : null}
                      </code>
                      <button
                        type="button"
                        aria-label={`Remove connection ${c.name}`}
                        disabled={busy}
                        onClick={() => void removeConnection(c)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}

      <div className="rounded-2xl border border-dashed border-border px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Adding a service that signs in with OAuth still needs a browser on the computer running the
          gateway (the sign-in redirect returns to it).{" "}
          {dashboardUrl ? (
            <a href={dashboardUrl} target="_blank" rel="noreferrer" className="underline">
              Open the gateway on the box
            </a>
          ) : (
            <span>Open the gateway on the box to connect one.</span>
          )}
        </p>
      </div>
    </section>
  );
}
