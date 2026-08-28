import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe2, ShieldCheck, TerminalSquare } from "lucide-react";

export type ServerAccessInfo = {
  runtime: "desktop" | "self-hosted";
  localUrl: string;
  tailscale: {
    installed: boolean;
    connected: boolean;
    dnsName: string | null;
    serveEnabled: boolean;
    serveUrl: string | null;
    command: string;
  };
};

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        } catch {
          // Clipboard permission can be denied by the browser or page context.
        }
      }}
    >
      {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
    </button>
  );
}

export function RemoteAccessSettingsSection() {
  const [access, setAccess] = useState<ServerAccessInfo | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/server/access", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Server access request failed (${response.status})`);
        return (await response.json()) as { access: ServerAccessInfo };
      })
      .then((payload) => setAccess(payload.access))
      .catch(() => {
        // An older server can render this newer UI. Hide the section instead of
        // presenting guessed network information or a permanent error row.
      });
    return () => controller.abort();
  }, []);

  if (!access || access.runtime === "desktop") return null;

  const { tailscale } = access;
  const suggestedUrl = tailscale.dnsName ? `https://${tailscale.dnsName}` : null;

  return (
    <section className="space-y-2" aria-labelledby="remote-access-heading">
      <h2 id="remote-access-heading" className="px-4 text-xs font-semibold text-muted-foreground">
        Remote access
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground text-background">
            <Globe2 className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Local server</span>
            <code className="block truncate text-xs text-muted-foreground">{access.localUrl}</code>
          </span>
          <CopyValue value={access.localUrl} label="local server URL" />
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-primary text-white">
              <ShieldCheck className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                Tailscale
                {tailscale.serveEnabled ? (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                    Active
                  </span>
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">
                {tailscale.serveEnabled
                  ? "Private HTTPS access is ready for devices in your tailnet."
                  : tailscale.connected
                    ? "This computer is connected. Run the command below once to expose omg.dev privately."
                    : tailscale.installed
                      ? "Connect Tailscale on this computer, then run the command below."
                      : "Install Tailscale on this computer and your phone, then run the command below."}
              </span>
            </span>
          </div>

          {tailscale.serveUrl ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-2">
              <a
                href={tailscale.serveUrl}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-mono text-xs text-foreground hover:underline"
              >
                {tailscale.serveUrl}
              </a>
              <CopyValue value={tailscale.serveUrl} label="Tailscale URL" />
            </div>
          ) : suggestedUrl ? (
            <p className="px-1 text-xs text-muted-foreground">
              After setup: <code>{suggestedUrl}</code>
            </p>
          ) : null}

          {!tailscale.serveEnabled ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-2">
              <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 truncate text-xs">{tailscale.command}</code>
              <CopyValue value={tailscale.command} label="Tailscale command" />
            </div>
          ) : null}

          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            On your phone, join the same tailnet and open the Tailscale URL. This uses Tailscale
            Serve, not a public Funnel.{" "}
            <a
              href="https://tailscale.com/kb/1242/tailscale-serve"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-foreground hover:underline"
            >
              Guide <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
