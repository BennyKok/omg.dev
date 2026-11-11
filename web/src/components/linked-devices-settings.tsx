import { useState } from "react";
import { Check, Copy, Laptop, Loader2, Plus, Trash2 } from "lucide-react";
import {
  createPairingCode,
  lastSeenLabel,
  linkCommand,
  removeLinkedDevice,
  useLinkedDevices,
  type DeviceApproval,
  type PairingCode,
} from "../lib/linked-devices";
import { SettingsGroup, SettingsIcon, SettingsRow } from "./settings-ui";

/** Same rule as src/devices/protocol.ts NAME_RE; the server checks it again. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const APPROVAL_LABEL: Record<DeviceApproval, string> = {
  "in-grant": "runs during a grant",
  "once-per-grant": "asks once per grant",
  each: "asks every time",
};

function CopyCommand({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy command"
      title="Copy command"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        } catch {
          // The browser can deny clipboard access. The command stays visible to copy by hand.
        }
      }}
    >
      {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
    </button>
  );
}

/**
 * Settings: machines linked with `omg device`. The list and the remove button
 * are the kill switch from this side; pairing makes a one-use code that only
 * the person at the device can use. Nothing here can approve a request: that
 * happens on the device itself (docs/device-link.md).
 */
export function LinkedDevicesSettingsSection() {
  const { devices, loaded, unavailable } = useLinkedDevices();
  const [name, setName] = useState("");
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // An older server has no device routes. Hide the section rather than show an error.
  if (!loaded || unavailable) return null;

  const trimmed = name.trim();
  const nameOk = NAME_RE.test(trimmed);

  const pair = async () => {
    if (!nameOk || busy) return;
    setBusy("pair");
    setError(null);
    try {
      setPairing(await createPairingCode(trimmed));
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (busy) return;
    if (!window.confirm(`Unlink "${id}"? Its next call is refused. To link it again, pair it again.`)) return;
    setBusy(id);
    setError(null);
    try {
      await removeLinkedDevice(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsGroup
      label="Linked devices"
      labelId="linked-devices-heading"
      footer={
        <>
          A linked device runs only the actions in its own config. You approve each grant on the device.
          In a chat, type <code>@</code> and the device name to point an agent at it.
        </>
      }
    >
      {devices.map((device) => (
        <div key={device.id} data-linked-device={device.id}>
          <SettingsRow
            icon={<SettingsIcon><Laptop /></SettingsIcon>}
            title={
              <>
                <span className="font-mono text-primary">@</span>
                {device.id}
              </>
            }
            description={
              <>
                {lastSeenLabel(device.lastSeenAt)}
                {device.tailnetIp ? ` · ${device.tailnetIp}` : ""}
                <span className="mt-0.5 block">
                  {device.actions.length
                    ? device.actions.map((a) => `${a.name} (${APPROVAL_LABEL[a.approval] ?? a.approval})`).join(", ")
                    : "No actions reported yet."}
                </span>
              </>
            }
            trailing={
              <button
                type="button"
                aria-label={`Unlink ${device.id}`}
                title="Unlink"
                disabled={!!busy}
                onClick={() => void remove(device.id)}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
              >
                {busy === device.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </button>
            }
          />
        </div>
      ))}

      <div className="space-y-3 px-4 py-2.5">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void pair();
          }}
        >
          <input
            aria-label="Device name"
            value={name}
            onChange={(event) => setName(event.target.value.toLowerCase())}
            placeholder="Device name, for example test-mac"
            maxLength={40}
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background/50 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={!nameOk || !!busy}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50"
          >
            {busy === "pair" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Pair
          </button>
        </form>

        {pairing ? (
          <div data-pairing-code className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Run this on the device before {new Date(pairing.expiresAt).toLocaleTimeString()}. The code works once.
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 py-1 pl-3 pr-1">
              <code className="min-w-0 flex-1 break-all text-xs">{linkCommand(pairing)}</code>
              <CopyCommand value={linkCommand(pairing)} />
            </div>
          </div>
        ) : null}

        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div>
    </SettingsGroup>
  );
}
