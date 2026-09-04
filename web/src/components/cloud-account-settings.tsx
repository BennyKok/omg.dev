import { useCallback, useEffect, useState } from "react";
import { Cloud, Laptop, LogIn, LogOut } from "lucide-react";

/** Mirrors CloudAccountStatus in src/cloud-account.ts. */
export type CloudAccountStatus = {
  signedIn: boolean;
  email: string | null;
  expiresAt: number | null;
  kind: "api-key" | "jwt" | "oauth" | null;
  authUrl: string;
};

/** Mirrors CloudComputerRow in src/cloud-account.ts. */
export type CloudComputerRow = {
  slug: string;
  name: string;
  kind: "cloud" | "connected";
  online: boolean;
  status: string;
  isDefault: boolean;
  lastSeenAt?: number | null;
  defaultFolder?: string | null;
};

function statusLabel(row: CloudComputerRow): string {
  if (row.online) return "Online";
  switch (row.status) {
    case "provisioning":
      return "Setting up";
    case "paused":
      return "Paused";
    case "waking":
      return "Waking";
    case "recycled":
      return "Removed";
    case "upgrade_required":
      return "Needs upgrade";
    case "none":
      return "Not created yet";
    case "offline":
      return "Offline";
    default:
      return row.status.replace(/_/g, " ");
  }
}

/**
 * The account this box is signed in to, and the machines that account has.
 *
 * Sign-in is a redirect through this server: POST /api/cloud/login answers
 * with the authorization URL, the browser goes there, and auth.omg.dev sends
 * it back to /api/cloud/callback on this server, which stores the credential
 * on the box. The token never reaches this page.
 */
export function CloudAccountSettingsSection() {
  const [status, setStatus] = useState<CloudAccountStatus | null>(null);
  const [computers, setComputers] = useState<CloudComputerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/cloud/session", { credentials: "same-origin", signal });
    if (!response.ok) throw new Error(`Cloud session request failed (${response.status})`);
    const next = (await response.json()) as CloudAccountStatus;
    setStatus(next);
    return next;
  }, []);

  const loadComputers = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/cloud/computers", { credentials: "same-origin", signal });
    const body = (await response.json().catch(() => null)) as
      | { computers?: CloudComputerRow[]; error?: string }
      | null;
    if (!response.ok) throw new Error(body?.error ?? `Computer list failed (${response.status})`);
    setComputers(body?.computers ?? []);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadStatus(controller.signal)
      .then((next) => (next.signedIn ? loadComputers(controller.signal) : undefined))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        // An older server has no /api/cloud routes. `status` stays null and
        // the section hides instead of showing a permanent error row.
        if (e instanceof Error && !/session request failed/.test(e.message)) setError(e.message);
      });
    return () => controller.abort();
  }, [loadStatus, loadComputers]);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cloud/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}` }),
      });
      const body = (await response.json().catch(() => null)) as
        | { authorizeUrl?: string; error?: string }
        | null;
      if (!response.ok || !body?.authorizeUrl) {
        throw new Error(body?.error ?? `Sign-in could not start (${response.status})`);
      }
      window.location.assign(body.authorizeUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in could not start.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cloud/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(`Sign-out failed (${response.status})`);
      setComputers(null);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-out failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <section className="space-y-2" aria-labelledby="cloud-account-heading">
      <h2 id="cloud-account-heading" className="px-4 text-xs font-semibold text-muted-foreground">
        omg Cloud
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-primary text-white">
            <Cloud className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {status.signedIn ? "Signed in" : "Not signed in"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {status.signedIn
                ? (status.email ?? "omg Cloud account")
                : "Sign in to see your cloud and connected computers here."}
            </span>
          </span>
          {status.signedIn ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void signOut()}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void signIn()}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              <LogIn className="size-3.5" />
              Sign in
            </button>
          )}
        </div>

        {status.signedIn && computers === null && !error ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">Loading computers…</div>
        ) : null}

        {computers?.map((row) => (
          <div key={row.slug} className="flex items-center gap-3 px-4 py-3" data-cloud-computer={row.slug}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
              {row.kind === "cloud" ? (
                <Cloud className="size-4 text-foreground/70" />
              ) : (
                <Laptop className="size-4 text-foreground/70" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{row.name}</span>
                {row.isDefault ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Default
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${row.online ? "bg-success" : "bg-foreground/20"}`}
                />
                {statusLabel(row)}
              </span>
            </span>
          </div>
        ))}

        {computers && computers.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">No computers on this account yet.</div>
        ) : null}

        {error ? (
          <div className="px-4 py-3 text-xs text-destructive" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
