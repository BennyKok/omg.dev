import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe2, ShieldCheck, TerminalSquare } from "lucide-react";
import { SettingsGroup, SettingsIcon, SettingsRow } from "./settings-ui";

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
    <SettingsGroup
      label="Remote access"
      labelId="remote-access-heading"
      footer={
        <>
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
        </>
      }
    >
      <SettingsRow
        icon={<SettingsIcon><Globe2 /></SettingsIcon>}
        title="Local server"
        description={<code className="block truncate">{access.localUrl}</code>}
        trailing={<CopyValue value={access.localUrl} label="local server URL" />}
      />

      <div className="space-y-3 pb-3">
        <SettingsRow
          className="pb-0"
          icon={<SettingsIcon><ShieldCheck /></SettingsIcon>}
          title={
            <span className="flex items-center gap-2">
              Tailscale
              {tailscale.serveEnabled ? (
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                  Active
                </span>
              ) : null}
            </span>
          }
          description={
            tailscale.serveEnabled
              ? "Private HTTPS access is ready for devices in your tailnet."
              : tailscale.connected
                ? "This computer is connected. Run the command below once to expose omg.dev privately."
                : tailscale.installed
                  ? "Connect Tailscale on this computer, then run the command below."
                  : "Install Tailscale on this computer and your phone, then run the command below."
          }
        />

        {/* Indented to the title column, so the values line up under the row text. */}
        <div className="space-y-2 pl-14 pr-4">
          {tailscale.serveUrl ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 py-1 pl-3 pr-1">
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
            <p className="text-xs text-muted-foreground">
              After setup: <code>{suggestedUrl}</code>
            </p>
          ) : null}

          {!tailscale.serveEnabled ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 py-1 pl-3 pr-1">
              <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 truncate text-xs">{tailscale.command}</code>
              <CopyValue value={tailscale.command} label="Tailscale command" />
            </div>
          ) : null}
        </div>
      </div>
    </SettingsGroup>
  );
}
