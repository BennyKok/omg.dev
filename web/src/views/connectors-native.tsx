import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plug, Plus, Search, ShieldQuestion, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The native connector manager: browse the integrations.sh catalog and manage
// this member's connections, all through omg's own API (/api/connectors...),
// so it works over remote access and is scoped per member. No Executor.

export type PublicConnector = {
  id: string;
  owner: string;
  name: string;
  slug: string;
  endpoint: string;
  headerNames: string[];
  catalogSlug?: string;
  icon?: string;
  oauth?: boolean;
  oauthConnected?: boolean;
  requireApproval: boolean;
  createdAt: number;
  updatedAt: number;
};

export type CatalogEntry = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: string;
  categories: string[];
  connectUrl: string | null;
  icon: string | null;
  domain: string | null;
  needsOAuth: boolean;
};

/** A logo, falling back to a plug glyph when the image is missing or fails. */
function Logo({ src, alt }: { src?: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-muted text-muted-foreground">
        <Plug className="size-3.5" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-6 shrink-0 rounded-[6px] bg-muted object-contain"
    />
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
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

function currentUser(): string {
  return (typeof localStorage !== "undefined" && localStorage.getItem("lfg_user")) || "owner";
}

/**
 * Who a new connector is for. Three levels: the member adding it, every
 * member of one role, or the whole team. Sent as `role` / `org` on POST.
 */
export type Scope = { kind: "me" } | { kind: "role"; roleId: string } | { kind: "org" };

type RoleOption = { id: string; name: string };

function scopeBody(scope: Scope, user: string): { user: string; role?: string; org?: boolean } {
  if (scope.kind === "role") return { user, role: scope.roleId };
  if (scope.kind === "org") return { user, org: true };
  return { user };
}

function encodeScope(scope: Scope): string {
  return scope.kind === "role" ? `role:${scope.roleId}` : scope.kind;
}

function decodeScope(value: string): Scope {
  if (value === "org") return { kind: "org" };
  if (value.startsWith("role:")) return { kind: "role", roleId: value.slice(5) };
  return { kind: "me" };
}

/** The level a stored connector lives at, from its owner bucket. */
export function connectorLevel(owner: string, roles: RoleOption[]): { label: string; shared: boolean } {
  if (owner === "*org*") return { label: "Team", shared: true };
  if (owner.startsWith("role:")) {
    const id = owner.slice(5);
    return { label: `Role: ${roles.find((r) => r.id === id)?.name ?? id}`, shared: true };
  }
  return { label: "Only you", shared: false };
}

export function ConnectorsNativePanel() {
  const [connectors, setConnectors] = useState<PublicConnector[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [scope, setScope] = useState<Scope>({ kind: "me" });
  const user = useMemo(() => currentUser(), []);

  useEffect(() => {
    // Roles feed the scope picker. Owner is not a bucket; a connector for
    // everyone is the team level.
    void api<{ roles: RoleOption[] }>("/api/roles")
      .then((payload) => setRoles((payload.roles ?? []).filter((r) => r.id !== "owner")))
      .catch(() => setRoles([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const { connectors } = await api<{ connectors: PublicConnector[] }>(`/api/connectors?user=${encodeURIComponent(user)}`);
      setConnectors(connectors);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load connectors");
      setConnectors([]);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4" aria-label="Connectors">
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Connectors are MCP servers you add. Each one is for you ({user}), for every member of one role,
        or for the whole team. Your agents see all three. Credentials stay on the box; agents never see them.
      </p>

      <label className="flex items-center gap-3 rounded-2xl border border-border bg-card/40 px-4 py-2.5 text-xs">
        <span className="shrink-0 font-medium">Add new connectors for</span>
        <select
          aria-label="Connector scope"
          value={encodeScope(scope)}
          onChange={(e) => setScope(decodeScope(e.target.value))}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="me">Only me ({user})</option>
          {roles.map((r) => (
            <option key={r.id} value={`role:${r.id}`}>
              Role: {r.name}
            </option>
          ))}
          <option value="org">Whole team</option>
        </select>
      </label>

      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
        {connectors === null ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">Loading connectors.</div>
        ) : connectors.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            No connectors yet. Add one from the catalog or by URL below.
          </div>
        ) : (
          connectors.map((c) => <ConnectorRow key={c.id} connector={c} roles={roles} onChanged={load} onError={setError} />)
        )}
      </div>
      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}

      <CatalogBrowser user={user} scope={scope} onAdded={load} />
      <AddByUrl user={user} scope={scope} onAdded={load} />
    </section>
  );
}

function ConnectorRow({
  connector,
  roles,
  onChanged,
  onError,
}: {
  connector: PublicConnector;
  roles: RoleOption[];
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<{ name: string; description: string }[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const expand = async () => {
    const next = !open;
    setOpen(next);
    if (next && tools === null) {
      try {
        const res = await api<{ ok: boolean; error?: string; tools: { name: string; description: string }[] }>(
          `/api/connectors/${connector.id}/tools`,
        );
        if (!res.ok) setToolsError(res.error ?? "could not reach this connector");
        setTools(res.tools ?? []);
      } catch (e) {
        setToolsError(e instanceof Error ? e.message : "could not reach this connector");
        setTools([]);
      }
    }
  };

  const save = async (patch: Partial<Pick<PublicConnector, "requireApproval">>) => {
    setBusy(true);
    try {
      await api(`/api/connectors/${connector.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      onError(null);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not update the connector");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/connectors/${connector.id}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not remove the connector");
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    onError(null);
    // Open the popup synchronously so the browser does not block it.
    const popup = window.open("", "omg-oauth", "width=520,height=680");
    try {
      const res = await api<{ authorizeUrl?: string; alreadyAuthorized?: boolean }>(
        `/api/connectors/${connector.id}/oauth/start`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (res.alreadyAuthorized) {
        popup?.close();
        await onChanged();
        return;
      }
      if (res.authorizeUrl && popup) popup.location.href = res.authorizeUrl;
      else if (res.authorizeUrl) window.open(res.authorizeUrl, "_blank", "noopener");
      // Refresh when the callback page signals completion (or after a poll).
      const onMsg = (ev: MessageEvent) => {
        if (ev.data && typeof ev.data === "object" && "omgOauth" in ev.data) {
          window.removeEventListener("message", onMsg);
          void onChanged();
        }
      };
      window.addEventListener("message", onMsg);
      window.setTimeout(() => {
        window.removeEventListener("message", onMsg);
        void onChanged();
      }, 60_000);
    } catch (e) {
      popup?.close();
      onError(e instanceof Error ? e.message : "could not start sign-in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-3" data-connector={connector.slug}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={open ? `Hide ${connector.name} tools` : `Show ${connector.name} tools`}
          aria-expanded={open}
          onClick={() => void expand()}
          className="flex size-6 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        <Logo src={connector.icon} alt="" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{connector.name}</span>
            {(() => {
              const level = connectorLevel(connector.owner, roles);
              return level.shared ? (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground" data-level={connector.owner}>
                  {level.label}
                </span>
              ) : null;
            })()}
          </span>
          <code className="block truncate text-xs text-muted-foreground">{connector.endpoint}</code>
        </span>
        {connector.oauth ? (
          connector.oauthConnected ? (
            <span className="flex items-center gap-2 text-[11px]">
              <span className="rounded-full bg-success/15 px-2 py-0.5 font-semibold text-success">Connected</span>
              <button type="button" disabled={busy} onClick={() => void connect()} className="text-muted-foreground hover:text-foreground">
                Reconnect
              </button>
            </span>
          ) : (
            <Button type="button" size="sm" disabled={busy} onClick={() => void connect()}>
              Connect
            </Button>
          )
        ) : null}
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Pause calls for your approval in chat">
          <ShieldQuestion className="size-3.5" />
          <input
            type="checkbox"
            aria-label={`Require approval for ${connector.name}`}
            checked={connector.requireApproval}
            disabled={busy}
            onChange={(e) => void save({ requireApproval: e.target.checked })}
          />
          approve
        </label>
        <button
          type="button"
          aria-label={`Remove connector ${connector.name}`}
          disabled={busy}
          onClick={() => void remove()}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      {open ? (
        <ul className="mt-2 space-y-1 pl-10" data-tools-for={connector.slug}>
          {toolsError ? <li className="text-xs text-destructive">{toolsError}</li> : null}
          {tools === null ? (
            <li className="text-xs text-muted-foreground">Loading tools.</li>
          ) : tools.length === 0 && !toolsError ? (
            <li className="text-xs text-muted-foreground">No tools.</li>
          ) : (
            tools.map((t) => (
              <li key={t.name} className="text-xs">
                <code className="text-foreground">{t.name}</code>
                {t.description ? <span className="text-muted-foreground"> — {t.description.split("\n")[0]}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

function AddByUrl({ user, scope, onAdded }: { user: string; scope: Scope; onAdded: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-2.5 text-left text-xs text-muted-foreground hover:bg-foreground/[0.03]"
      >
        <Plus className="size-4 shrink-0" />
        Add a custom MCP server by URL
      </button>
    );
  }
  return <AddByUrlForm user={user} scope={scope} onAdded={onAdded} onClose={() => setExpanded(false)} />;
}

function AddByUrlForm({ user, scope, onAdded, onClose }: { user: string; scope: Scope; onAdded: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [header, setHeader] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !endpoint.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      const h = header.trim();
      if (h) {
        const idx = h.indexOf(":");
        if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      }
      await api("/api/connectors", {
        method: "POST",
        body: JSON.stringify({ ...scopeBody(scope, user), name: name.trim(), endpoint: endpoint.trim(), headers }),
      });
      setName("");
      setEndpoint("");
      setHeader("");
      await onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not add the connector");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2 rounded-2xl border border-border bg-card/40 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Plus className="size-4 text-muted-foreground" /> Add a custom MCP server
        <button type="button" onClick={onClose} className="ml-auto text-xs font-normal text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Connector name" className="h-8 text-xs" />
      <Input
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
        placeholder="MCP endpoint URL (https://…/mcp)"
        aria-label="Connector endpoint"
        className="h-8 font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <Input
          value={header}
          onChange={(e) => setHeader(e.target.value)}
          placeholder="Auth header (optional), e.g. Authorization: Bearer sk-…"
          aria-label="Connector auth header"
          className="h-8 font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={busy || !name.trim() || !endpoint.trim()}>
          Add
        </Button>
      </div>
      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

function CatalogBrowser({ user, scope, onAdded }: { user: string; scope: Scope; onAdded: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogEntry[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    try {
      const { results, total } = await api<{ total: number; results: CatalogEntry[] }>(
        `/api/connectors/catalog?q=${encodeURIComponent(query)}&limit=40`,
      );
      setResults(results);
      setTotal(total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load the catalog");
      setResults([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void search(q), 250);
    return () => clearTimeout(t);
  }, [q, search]);

  const add = async (entry: CatalogEntry) => {
    if (!entry.connectUrl) {
      setError(`${entry.name} has no MCP endpoint in the catalog; add it by URL.`);
      return;
    }
    setAdding(entry.slug);
    setError(null);
    try {
      await api("/api/connectors", {
        method: "POST",
        body: JSON.stringify({
          ...scopeBody(scope, user),
          name: entry.name,
          endpoint: entry.connectUrl,
          catalogSlug: entry.slug,
          icon: entry.icon ?? undefined,
          oauth: entry.needsOAuth,
        }),
      });
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not add");
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card/40 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Search className="size-4 text-muted-foreground" /> Browse the catalog
        {total !== null ? <span className="text-xs font-normal text-muted-foreground">({total})</span> : null}
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search connectors, e.g. github, notion, stripe" aria-label="Search catalog" className="h-8 text-xs" />
      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {results === null ? (
          <li className="px-1 text-xs text-muted-foreground">Loading.</li>
        ) : results.length === 0 ? (
          <li className="px-1 text-xs text-muted-foreground">No matches.</li>
        ) : (
          results.map((e) => (
            <li key={e.slug} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-foreground/[0.03]" data-catalog={e.slug}>
              <Logo src={e.icon} alt="" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{e.description || e.slug}</span>
              </span>
              {e.needsOAuth ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" title="Sign in after adding">
                  OAuth
                </span>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={adding === e.slug || !e.connectUrl}
                onClick={() => void add(e)}
                title={!e.connectUrl ? "No MCP endpoint; add by URL" : "Add"}
              >
                {adding === e.slug ? "Adding…" : "Add"}
              </Button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
