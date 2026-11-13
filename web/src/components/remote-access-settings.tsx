import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  Check,
  Copy,
  ExternalLink,
  Globe2,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { LOCAL_MACHINE_ID, selectMachine, usePeerMachines } from "../lib/machines";
import { cn } from "../lib/utils";
import { SettingsGroup, SettingsIcon, SettingsRow } from "./settings-ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

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

/**
 * The box's own answer to "how do I reach this from another device", from
 * GET /api/server/access. Null until it loads, and null on an older server
 * that has no such route: the row and page then stay hidden rather than show
 * guessed network information.
 */
export function useServerAccess(): ServerAccessInfo | null {
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
        // An older server can render this newer UI. Stay hidden.
      });
    return () => controller.abort();
  }, []);
  return access;
}

/** The desktop app owns a private runtime, so it offers no remote access. */
function offersRemoteAccess(access: ServerAccessInfo | null): access is ServerAccessInfo {
  return !!access && access.runtime !== "desktop";
}

/** The Settings row that opens the Remote access page. The caller owns the card. */
export function RemoteAccessRow({ onOpen }: { onOpen: () => void }) {
  const access = useServerAccess();
  if (!offersRemoteAccess(access)) return null;
  const { tailscale } = access;
  return (
    <SettingsRow
      onClick={onOpen}
      icon={<SettingsIcon><Globe2 /></SettingsIcon>}
      title="Remote access"
      description={
        tailscale.serveEnabled && tailscale.serveUrl
          ? tailscale.serveUrl.replace(/^https?:\/\//, "")
          : "Local only"
      }
      descriptionClassName="truncate"
    />
  );
}

/** Settings > Remote access: the local address and private Tailscale access. */
export function RemoteAccessPage() {
  const access = useServerAccess();
  return (
    <div className="mx-auto max-w-xl space-y-8 pb-10" data-lfg-page-column>
      <div className="px-1">
        <h1 className="text-lg font-semibold leading-tight">Remote access</h1>
        <p className="text-sm text-muted-foreground">Open omg.dev from your phone or another computer.</p>
      </div>
      {offersRemoteAccess(access) ? (
        <>
          <RemoteAccessGroups access={access} />
          <LinkedMachinesGroup />
        </>
      ) : null}
    </div>
  );
}

function RemoteAccessGroups({ access }: { access: ServerAccessInfo }) {
  const { tailscale } = access;
  const suggestedUrl = tailscale.dnsName ? `https://${tailscale.dnsName}` : null;

  return (
    <SettingsGroup
      label="Addresses"
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

/**
 * Settings > Remote access > Linked machines (src/peer-machines.ts).
 *
 * Two directions, kept apart on purpose:
 * - Inbound: "Allow linking" gives this computer a pairing code. Whoever holds
 *   it gets full control of this computer over the tailnet. Off by default.
 * - Outbound: paste another computer's pairing code to control it from here.
 */
export function LinkedMachinesGroup() {
  const { self, peers, fleetNodes, unified, setUnified, active, addPeer, removePeer, rotateToken, setInbound } =
    usePeerMachines(true);

  const [pairingInput, setPairingInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [togglingInbound, setTogglingInbound] = useState(false);

  if (!self) return null;
  const nodeByPeerId = new Map(fleetNodes.map((n) => [n.id, n]));

  const handleLinkSubmit = async (allowOffline = false) => {
    const trimmed = pairingInput.trim();
    if (!trimmed || linking) return;
    setLinking(true);
    setLinkError(null);
    try {
      const res = await addPeer({ pairingCode: trimmed, name: nameInput.trim() || undefined, allowOffline });
      if (!res.ok) {
        setLinkError(res.error);
        setUnreachable(Boolean(res.unreachable));
        return;
      }
      setPairingInput("");
      setNameInput("");
      setUnreachable(false);
    } finally {
      setLinking(false);
    }
  };

  return (
    <>
      <SettingsGroup
        label="This computer"
        labelId="linked-machines-inbound-heading"
        footer="Anyone with the pairing code can start agents and run commands on this computer through your tailnet. Share it only with your own machines. Turning this off or rotating the code locks out every machine that used the old code."
      >
        <SettingsRow
          icon={<SettingsIcon><KeyRound /></SettingsIcon>}
          title="Allow linking from other machines"
          description={self.inboundEnabled ? "Other omg.dev computers can link with the pairing code." : "Off"}
          trailing={
            <Switch
              checked={self.inboundEnabled}
              disabled={togglingInbound}
              aria-label="Allow linking from other machines"
              onCheckedChange={async (checked) => {
                setTogglingInbound(true);
                try {
                  await setInbound(Boolean(checked));
                } finally {
                  setTogglingInbound(false);
                }
              }}
            />
          }
        />
        {self.inboundEnabled && self.pairingCode ? (
          <div className="flex items-center gap-2 px-4 py-3 pl-14" data-testid="peer-pairing-code">
            <code className="min-w-0 flex-1 truncate rounded-xl border border-border bg-background/50 px-3 py-2 font-mono text-xs">
              {self.pairingCode}
            </code>
            <CopyValue value={self.pairingCode} label="pairing code" />
            <button
              type="button"
              aria-label="Rotate pairing code"
              title="Rotate pairing code"
              disabled={rotating}
              onClick={async () => {
                setRotating(true);
                try {
                  await rotateToken();
                } finally {
                  setRotating(false);
                }
              }}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("size-4", rotating && "animate-spin")} />
            </button>
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        label="Linked machines"
        labelId="linked-machines-heading"
        footer="Paste the pairing code from another omg.dev computer. This computer keeps its token and connects for you, so the token never reaches the browser."
      >
        {peers.length > 0 ? (
          <SettingsRow
            icon={<SettingsIcon><Layers /></SettingsIcon>}
            title="Unified session sidebar"
            description="Show sessions from every linked machine in the sidebar."
            trailing={
              <Switch
                checked={unified}
                onCheckedChange={(checked) => setUnified(Boolean(checked))}
                aria-label="Unified session sidebar"
              />
            }
          />
        ) : null}

        {peers.map((peer) => {
          const node = nodeByPeerId.get(peer.id);
          const online = node?.online ?? false;
          const isSelected = active.id === peer.id;
          const displayName = node?.name || peer.name;
          const status = node
            ? node.online
              ? `${node.sessionCount} session${node.sessionCount === 1 ? "" : "s"}`
              : node.error || "Offline"
            : null;
          return (
            <div key={peer.id} data-peer-row={peer.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
              <span className="relative">
                <SettingsIcon><Server /></SettingsIcon>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card",
                    online ? "bg-success" : "bg-muted-foreground/50",
                  )}
                  aria-label={online ? "Online" : "Offline"}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{displayName}</span>
                  {isSelected ? (
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                      Active
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {peer.url}
                  {status ? ` · ${status}` : ""}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 px-2.5 text-xs"
                onClick={() =>
                  isSelected
                    ? selectMachine({ id: LOCAL_MACHINE_ID, name: self.name || "This computer" })
                    : selectMachine({ id: peer.id, name: displayName })
                }
              >
                <ArrowRightLeft className="mr-1 size-3" />
                {isSelected ? "Back to local" : "Switch"}
              </Button>
              <button
                type="button"
                aria-label={`Unlink ${displayName}`}
                title={`Unlink ${displayName}`}
                onClick={() => void removePeer(peer.id)}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}

        <form
          className="space-y-2 px-4 py-3"
          data-testid="peer-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleLinkSubmit(false);
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={pairingInput}
              onChange={(e) => {
                setPairingInput(e.target.value);
                setUnreachable(false);
              }}
              disabled={linking}
              placeholder="https://studio.tailnet.ts.net#omg_peer_..."
              aria-label="Pairing code from another omg.dev computer"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 font-mono text-xs"
            />
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              disabled={linking}
              placeholder="Name (optional)"
              aria-label="Name for the linked machine"
              className="text-xs sm:w-40"
            />
            <Button type="submit" size="sm" disabled={linking || !pairingInput.trim()} className="shrink-0">
              <Plus className="mr-1 size-3.5" />
              {linking ? "Linking…" : "Link"}
            </Button>
          </div>
          {linkError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <span>{linkError}</span>
              {unreachable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={linking}
                  onClick={() => void handleLinkSubmit(true)}
                >
                  Save offline
                </Button>
              ) : null}
            </div>
          ) : null}
        </form>
      </SettingsGroup>
    </>
  );
}
