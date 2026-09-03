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
  needsOAuth: boolean;
};

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

export function ConnectorsNativePanel() {
  const [connectors, setConnectors] = useState<PublicConnector[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const user = useMemo(() => currentUser(), []);

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
        Connectors are MCP servers you add. They are scoped to you ({user}) and shared across all of
        your agents. Credentials stay on the box; agents never see them.
      </p>

      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
        {connectors === null ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">Loading connectors.</div>
        ) : connectors.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            No connectors yet. Add one from the catalog or by URL below.
          </div>
        ) : (
          connectors.map((c) => <ConnectorRow key={c.id} connector={c} onChanged={load} onError={setError} />)
        )}
      </div>
      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}

      <AddByUrl user={user} onAdded={load} />
      <CatalogBrowser user={user} onAdded={load} />
    </section>
  );
}

function ConnectorRow({
  connector,
  onChanged,
  onError,
}: {
  connector: PublicConnector;
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

  return (
    <div className="px-4 py-3" data-connector={connector.slug}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={open ? `Hide ${connector.name} tools` : `Show ${connector.name} tools`}
          aria-expanded={open}
          onClick={() => void expand()}
          className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground text-background"
        >
          <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{connector.name}</span>
          <code className="block truncate text-xs text-muted-foreground">{connector.endpoint}</code>
        </span>
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

function AddByUrl({ user, onAdded }: { user: string; onAdded: () => Promise<void> }) {
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
        body: JSON.stringify({ user, name: name.trim(), endpoint: endpoint.trim(), headers }),
      });
      setName("");
      setEndpoint("");
      setHeader("");
      await onAdded();
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
        <Plus className="size-4 text-muted-foreground" /> Add a connector by URL
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

function CatalogBrowser({ user, onAdded }: { user: string; onAdded: () => Promise<void> }) {
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
        body: JSON.stringify({ user, name: entry.name, endpoint: entry.connectUrl, catalogSlug: entry.slug }),
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
              <Plug className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{e.description || e.slug}</span>
              </span>
              {e.needsOAuth ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" title="OAuth connect is not supported yet">
                  OAuth
                </span>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={adding === e.slug || !e.connectUrl || e.needsOAuth}
                onClick={() => void add(e)}
                title={e.needsOAuth ? "OAuth connect not supported yet" : !e.connectUrl ? "No MCP endpoint; add by URL" : "Add"}
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
