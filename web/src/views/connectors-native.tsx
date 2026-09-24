import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Plug, Plus, ShieldQuestion, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { omgFetch } from "@/lib/omg-client";

// The native connector manager: omg's tested connectors (Recommended) and
// this member's connections, all through omg's own API (/api/connectors...),
// so it works over remote access and is scoped per member. No Executor.
//
// The ~1,300-entry integrations.sh catalog is not offered here. Most of it
// was never tested with omg, and a list of things that may not work is worse
// than a short list that does. A custom MCP server stays available under
// Advanced for someone who knows what they are adding.

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
  oauthApp?: string;
  /** Set for a connector omg runs itself, e.g. "gmail". */
  native?: string;
  /** The signed-in account, e.g. the mailbox address. */
  account?: string;
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
  /** The catalog's `auth.kind`, or null when the entry says nothing. */
  authKind?: string | null;
  /** Signs in with this provider's pre-registered client on the box. */
  oauthApp?: string;
  /** A connector omg runs itself. */
  native?: string;
  /** omg's curated entries, shown above the searchable catalog. */
  recommended?: boolean;
};

export type OAuthAppStatus = {
  id: string;
  name: string;
  consoleUrl: string;
  configured: boolean;
  clientIdHint: string | null;
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
  // Through the transport for the same reason as connectors-page.tsx.
  const res = await omgFetch(path, {
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

// Reserve the popup during the click, before saving the connector or making
// any auth request. Both Add and Connect use the same flow.
//
// `reserved` lets the caller open the popup itself during the click and hand
// it over. Add needs that, because it only learns whether a sign-in is needed
// after the connector is saved, and a popup opened that late is blocked.
// Pass `undefined` to let this open its own. An id that resolves to null means
// no sign-in is needed, so a reserved popup is closed again.
function useConnectorSignIn(onChanged: () => Promise<void>) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  return async (id: string | Promise<string | null>, reserved?: Window | null) => {
    cleanup.current?.();
    const popup = reserved === undefined ? window.open("", "omg-oauth", "width=520,height=680") : reserved;
    try {
      const connectorId = await id;
      if (connectorId === null) {
        popup?.close();
        await onChanged();
        return;
      }
      if (!popup) throw new Error("Sign-in popup was blocked. Allow popups, then click Connect.");
      const res = await api<{ authorizeUrl?: string; alreadyAuthorized?: boolean }>(
        `/api/connectors/${connectorId}/oauth/start`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (res.alreadyAuthorized) {
        popup.close();
        await onChanged();
        return;
      }
      if (!res.authorizeUrl) throw new Error("The server did not return a sign-in URL.");
      const stop = () => {
        window.removeEventListener("message", onMsg);
        window.clearTimeout(timer);
        cleanup.current = null;
      };
      const onMsg = (ev: MessageEvent) => {
        if (ev.source === popup && typeof ev.data?.omgOauth === "boolean") {
          stop();
          void onChanged();
        }
      };
      const timer = window.setTimeout(() => {
        stop();
        void onChanged();
      }, 60_000);
      cleanup.current = stop;
      window.addEventListener("message", onMsg);
      popup.location.href = res.authorizeUrl;
    } catch (e) {
      popup?.close();
      throw e;
    }
  };
}

type ConnectorDraft = {
  user: string;
  role?: string;
  org?: boolean;
  name: string;
  endpoint: string;
  headers?: Record<string, string>;
  catalogSlug?: string;
  icon?: string;
  oauth?: boolean;
  oauthApp?: string;
  native?: string;
  /** The server may still ask for a sign-in; reserve the popup on the click. */
  maybeOauth?: boolean;
};
type AddConnector = (draft: ConnectorDraft) => Promise<void>;

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

const SCOPE_KEY = "omg.connectors.scope";

function savedScope(): Scope {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(SCOPE_KEY) : null;
    return v ? decodeScope(v) : { kind: "me" };
  } catch {
    return { kind: "me" };
  }
}

/** The owner bucket a scope reads and writes, or null for "me" (any personal bucket). */
function scopeBucket(scope: Scope): string | null {
  return scope.kind === "org" ? "*org*" : scope.kind === "role" ? `role:${scope.roleId}` : null;
}

function inScope(c: PublicConnector, scope: Scope): boolean {
  const bucket = scopeBucket(scope);
  return bucket ? c.owner === bucket : c.owner !== "*org*" && !c.owner.startsWith("role:");
}

/** One line under the tabs: who the selected scope's connections serve. */
export function scopeHint(scope: Scope, roles: RoleOption[]): string {
  if (scope.kind === "org") return "Every member's agents can use these.";
  if (scope.kind === "role") {
    const name = roles.find((r) => r.id === scope.roleId)?.name ?? scope.roleId;
    return `Agents of everyone in ${name} can use these. No tool rules needed.`;
  }
  return "Only your own agents can use these.";
}

/**
 * The connector manager, organised by who can use a connection. Pick a tab
 * (you, a role, or the whole team), then see that scope's apps: what is
 * connected, with which account, and what can be added. Adding happens in the
 * scope you are looking at, so there is no separate "add for" picker to keep
 * in sync with the list above it.
 */
export function ConnectorsNativePanel() {
  const [connectors, setConnectors] = useState<PublicConnector[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [scope, setScopeState] = useState<Scope>(savedScope);
  const user = useMemo(() => currentUser(), []);

  const setScope = (next: Scope) => {
    setScopeState(next);
    setError(null);
    try {
      localStorage.setItem(SCOPE_KEY, encodeScope(next));
    } catch {}
  };

  useEffect(() => {
    // Roles feed the tabs. Owner is not a bucket; a connector for everyone
    // is the team level.
    void api<{ roles: RoleOption[] }>("/api/roles")
      .then((payload) => setRoles((payload.roles ?? []).filter((r) => r.id !== "owner")))
      .catch(() => setRoles([]));
  }, []);

  // A remembered role that has since been deleted falls back to "me".
  useEffect(() => {
    if (scope.kind === "role" && roles.length > 0 && !roles.some((r) => r.id === scope.roleId)) setScope({ kind: "me" });
  }, [roles, scope]);

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

  const signIn = useConnectorSignIn(load);
  const addConnector: AddConnector = async (draft) => {
    let saved = false;
    let authError: string | null = null;
    const { maybeOauth, ...body } = draft;
    // The server probes the endpoint and returns the connector with `oauth`
    // set to what the endpoint actually requires, so the decision to sign in
    // comes from the saved connector and not from the catalog's claim.
    const wantsPopup = draft.oauth === true || maybeOauth === true;
    const popup = wantsPopup ? window.open("", "omg-oauth", "width=520,height=680") : null;
    const created = api<{ connector: PublicConnector }>("/api/connectors", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((result) => {
      saved = true;
      return result;
    });
    try {
      if (wantsPopup) {
        await signIn(
          created.then(({ connector }) => (connector.oauth ? connector.id : null)),
          popup,
        );
      } else await created;
    } catch (e) {
      popup?.close();
      if (!saved) throw e;
      authError = e instanceof Error ? e.message : "could not start sign-in";
    } finally {
      // Keep a saved connector visible and retryable if sign-in fails.
      await load();
    }
    if (authError) setError(authError);
  };

  const all = connectors ?? [];
  const tabs: { scope: Scope; label: string }[] = [
    { scope: { kind: "me" }, label: "Me" },
    ...roles.map((r) => ({ scope: { kind: "role", roleId: r.id } as Scope, label: r.name })),
    { scope: { kind: "org" }, label: "Whole team" },
  ];
  const team = scope.kind === "org" ? [] : all.filter((c) => c.owner === "*org*");

  return (
    <section className="space-y-3" aria-label="Connectors">
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Apps your agents can use. Credentials stay on this box; agents never see them.
      </p>

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Who can use it">
        <span className="px-1 text-xs text-muted-foreground">For</span>
        {tabs.map((t) => {
          const key = encodeScope(t.scope);
          const active = key === encodeScope(scope);
          const count = all.filter((c) => inScope(c, t.scope)).length;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              data-scope-tab={key}
              onClick={() => setScope(t.scope)}
              className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card/40 text-foreground hover:bg-foreground/[0.04]"
              }`}
            >
              {t.label}
              {count > 0 ? (
                <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="px-1 text-xs text-muted-foreground" data-scope-hint>
        {scopeHint(scope, roles)}
      </p>

      {connectors === null ? (
        <div className="rounded-2xl border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">Loading connectors.</div>
      ) : (
        <AppList
          user={user}
          scope={scope}
          connectors={all.filter((c) => inScope(c, scope))}
          addConnector={addConnector}
          onChanged={load}
          onError={setError}
          signIn={signIn}
        />
      )}
      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}

      {team.length > 0 ? (
        <p className="px-1 text-xs text-muted-foreground" data-inherited>
          Also available here, from Whole team: {team.map((c) => (c.native && c.account ? nativeTitle(c) : c.name)).join(", ")}.
        </p>
      ) : null}

      <AddByUrl user={user} scope={scope} addConnector={addConnector} />
    </section>
  );
}

/**
 * One scope's apps. Each tested connector is one card: its connected accounts
 * underneath, and Connect (or Add account) on the right. Anything else in the
 * scope, such as a custom MCP server, is listed after them under Other.
 */
export function AppList({
  user,
  scope,
  connectors,
  addConnector,
  onChanged,
  onError,
  signIn,
}: {
  user: string;
  scope: Scope;
  connectors: PublicConnector[];
  addConnector: AddConnector;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  signIn: (id: string) => Promise<void>;
}) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [apps, setApps] = useState<OAuthAppStatus[] | null>(null);
  const [redirectUri, setRedirectUri] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    try {
      const res = await api<{ apps: OAuthAppStatus[]; redirectUri: string }>("/api/connectors/oauth-apps");
      setApps(res.apps);
      setRedirectUri(res.redirectUri);
    } catch {
      setApps([]);
    }
  }, []);

  useEffect(() => {
    void api<{ recommended?: CatalogEntry[] }>("/api/connectors/catalog?recommended=1")
      .then((res) => setEntries(res.recommended ?? []))
      .catch(() => setEntries([]));
    void loadApps();
  }, [loadApps]);

  const accountsOf = (e: CatalogEntry) =>
    connectors.filter((c) => (e.native ? c.native === e.native : c.catalogSlug === e.slug));
  const matched = new Set(entries.flatMap((e) => accountsOf(e).map((c) => c.id)));
  const others = connectors.filter((c) => !matched.has(c.id));

  const neededApps = [...new Set(entries.map((e) => e.oauthApp).filter((a): a is string => !!a))];
  const missing = (apps ?? []).filter((a) => neededApps.includes(a.id) && !a.configured);

  const connect = async (entry: CatalogEntry) => {
    if (!entry.connectUrl) return;
    setAdding(entry.slug);
    onError(null);
    try {
      await addConnector({
        ...scopeBody(scope, user),
        name: entry.name,
        endpoint: entry.connectUrl,
        catalogSlug: entry.slug,
        icon: entry.icon ?? undefined,
        oauth: true,
        oauthApp: entry.oauthApp,
        native: entry.native,
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not connect");
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="space-y-2">
      {missing.map((app) => (
        <OAuthAppSetup key={app.id} app={app} redirectUri={redirectUri} onSaved={loadApps} />
      ))}
      <ul className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border" aria-label="Apps">
        {entries.map((e) => {
          const accounts = accountsOf(e);
          const blocked = apps === null || missing.some((a) => a.id === e.oauthApp);
          return (
            <li key={e.slug} className="px-4 py-3" data-app={e.slug}>
              <div className="flex items-center gap-3">
                <Logo src={e.icon} alt="" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.name}</span>
                  {accounts.length === 0 ? (
                    <span className="block truncate text-xs text-muted-foreground">{e.description}</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={accounts.length ? "secondary" : "default"}
                  disabled={blocked || adding === e.slug}
                  onClick={() => void connect(e)}
                  data-connect={e.slug}
                >
                  {adding === e.slug ? "Connecting…" : accounts.length ? "Add account" : "Connect"}
                </Button>
              </div>
              {accounts.length ? (
                <div className="mt-2 space-y-1 pl-9">
                  {accounts.map((c) => (
                    <ConnectorRow key={c.id} connector={c} onChanged={onChanged} onError={onError} signIn={signIn} compact />
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
        {others.length ? (
          <li className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground" data-others>
            Other
          </li>
        ) : null}
        {others.map((c) => (
          <li key={c.id} className="px-4 py-3">
            <ConnectorRow connector={c} onChanged={onChanged} onError={onError} signIn={signIn} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One connection. Compact rows sit under their app's card and show the
 * account; full rows (custom servers) show a logo, name and endpoint. The
 * settings that are rarely touched live behind Manage.
 */
function ConnectorRow({
  connector,
  onChanged,
  onError,
  signIn,
  compact = false,
}: {
  connector: PublicConnector;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  signIn: (id: string) => Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<{ name: string; description: string }[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const loadTools = async () => {
    try {
      const res = await api<{ ok: boolean; error?: string; needsAuth?: boolean; tools: { name: string; description: string }[] }>(
        `/api/connectors/${connector.id}/tools`,
      );
      if (!res.ok) {
        setToolsError(res.needsAuth ? "This connector needs a sign-in. Click Connect." : (res.error ?? "could not reach this connector"));
        // The server records the sign-in requirement it just found, so
        // reload to show the Connect button on this row.
        if (res.needsAuth && !connector.oauth) await onChanged();
      }
      setTools(res.tools ?? []);
    } catch (e) {
      setToolsError(e instanceof Error ? e.message : "could not reach this connector");
      setTools([]);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setConfirming(false);
    if (next && tools === null) void loadTools();
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
    try {
      await signIn(connector.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not start sign-in");
    } finally {
      setBusy(false);
    }
  };

  const needsSignIn = connector.oauth && !connector.oauthConnected;
  const title = connector.native ? (connector.account ?? "Not signed in yet") : connector.name;

  return (
    <div data-connector={connector.slug}>
      <div className="flex items-center gap-2">
        {compact ? null : <Logo src={connector.icon} alt="" />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${compact ? "text-xs" : "text-sm font-medium"}`}>{title}</span>
          {!compact && !connector.native ? <code className="block truncate text-xs text-muted-foreground">{connector.endpoint}</code> : null}
        </span>
        {connector.requireApproval ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title="Each use waits for your approval">
            <ShieldQuestion className="size-3.5" /> Asks first
          </span>
        ) : null}
        {needsSignIn ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => void connect()}>
            Connect
          </Button>
        ) : connector.oauth ? (
          <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">Connected</span>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Manage ${connector.native && connector.account ? `${nativeTitle(connector)} (${connector.account})` : connector.name}`}
          onClick={toggle}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Manage
          <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      </div>
      {open ? (
        <div className="mt-2 space-y-2 rounded-xl bg-muted/40 px-3 py-2.5 text-xs" data-manage={connector.id}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={`Ask me before each use of ${connector.name}`}
              checked={connector.requireApproval}
              disabled={busy}
              onChange={(e) => void save({ requireApproval: e.target.checked })}
            />
            <span>Ask me before each use</span>
            <span className="text-muted-foreground">Agents wait for your OK in chat.</span>
          </label>
          <div>
            <div className="mb-1 font-medium">Tools</div>
            <ul className="space-y-0.5" data-tools-for={connector.slug}>
              {toolsError ? <li className="text-destructive">{toolsError}</li> : null}
              {tools === null ? (
                <li className="text-muted-foreground">Loading tools.</li>
              ) : tools.length === 0 && !toolsError ? (
                <li className="text-muted-foreground">No tools.</li>
              ) : (
                tools.map((t) => (
                  <li key={t.name}>
                    <code className="text-foreground">{t.name}</code>
                    {t.description ? <span className="text-muted-foreground"> — {t.description.split("\n")[0]}</span> : null}
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="flex items-center gap-2 pt-1">
            {connector.oauth && !needsSignIn ? (
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void connect()}>
                Reconnect
              </Button>
            ) : null}
            {confirming ? (
              <>
                <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
                  Remove for good
                </Button>
                <button type="button" onClick={() => setConfirming(false)} className="text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label={`Remove connector ${connector.name}`}
                disabled={busy}
                onClick={() => setConfirming(true)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Remove
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "Gmail" for a native row whose name already carries the account below it. */
function nativeTitle(c: PublicConnector): string {
  const suffix = ` (${c.account})`;
  return c.name.endsWith(suffix) ? c.name.slice(0, -suffix.length) : c.name;
}

function AddByUrl({ user, scope, addConnector }: { user: string; scope: Scope; addConnector: AddConnector }) {
  const [expanded, setExpanded] = useState(false);
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-2.5 text-left text-xs text-muted-foreground hover:bg-foreground/[0.03]"
      >
        <Plus className="size-4 shrink-0" />
        Advanced: add a custom MCP server by URL
      </button>
    );
  }
  return <AddByUrlForm user={user} scope={scope} addConnector={addConnector} onClose={() => setExpanded(false)} />;
}

function AddByUrlForm({ user, scope, addConnector, onClose }: { user: string; scope: Scope; addConnector: AddConnector; onClose: () => void }) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [header, setHeader] = useState("");
  const [auth, setAuth] = useState("oauth");
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
      await addConnector({
        ...scopeBody(scope, user), name: name.trim(), endpoint: endpoint.trim(),
        headers: auth === "header" ? headers : {}, oauth: auth === "oauth",
        // "No authentication" is the user's guess. The server still probes,
        // so reserve the popup in case the endpoint asks for a sign-in.
        maybeOauth: auth !== "header",
      });
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
      <select
        aria-label="Connector authentication"
        value={auth}
        onChange={(e) => setAuth(e.target.value)}
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
      >
        <option value="oauth">Sign in with OAuth</option>
        <option value="header">Auth header</option>
        <option value="none">No authentication</option>
      </select>
      <div className="flex items-center gap-2">
        {auth === "header" ? <Input
          value={header}
          onChange={(e) => setHeader(e.target.value)}
          placeholder="Auth header, e.g. Authorization: Bearer sk-…"
          aria-label="Connector auth header"
          className="h-8 font-mono text-xs"
        /> : null}
        <Button type="submit" size="sm" disabled={busy || !name.trim() || !endpoint.trim()}>
          Add
        </Button>
      </div>
      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

/** One-time form: paste the provider's OAuth client, registered with this box's callback. */
function OAuthAppSetup({ app, redirectUri, onSaved }: { app: OAuthAppStatus; redirectUri: string; onSaved: () => Promise<void> }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/connectors/oauth-apps/${app.id}`, {
        method: "PUT",
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs"
      data-oauth-app-setup={app.id}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="font-medium">Set up {app.name} sign-in once</p>
      <p className="text-muted-foreground">
        {app.name} needs an OAuth client for this box. Create a Web application client in the{" "}
        <a href={app.consoleUrl} target="_blank" rel="noreferrer" className="underline">
          {app.name} console
        </a>
        , add this redirect URI, then paste the client here.
      </p>
      <code className="block select-all break-all rounded-md bg-muted px-2 py-1" data-redirect-uri>
        {redirectUri}
      </code>
      <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" aria-label={`${app.name} client ID`} className="h-8 font-mono text-xs" />
      <Input
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        placeholder="Client secret"
        type="password"
        aria-label={`${app.name} client secret`}
        className="h-8 font-mono text-xs"
      />
      <Button type="submit" size="sm" disabled={busy || !clientId.trim()}>
        Save
      </Button>
      {error ? <p className="text-destructive">{error}</p> : null}
    </form>
  );
}
