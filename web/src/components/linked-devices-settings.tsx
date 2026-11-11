import { useState } from "react";
import { Check, Copy, Laptop, Loader2, Plus, Trash2 } from "lucide-react";
import {
  createPairingCode,
  lastSeenLabel,
  linkCommand,
  removeLinkedDevice,
  useLinkedDevices,
  type LinkedDevice,
  type PairingCode,
} from "../lib/linked-devices";
import { SettingsGroup, SettingsIcon, SettingsRow } from "./settings-ui";

/** Same rule as src/devices/protocol.ts NAME_RE; the server checks it again. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** "11 actions": the full list, with approval levels, is in omg_list_devices. */
function actionsLine(device: LinkedDevice): string {
  const n = device.actions.length;
  return n ? `${n} action${n === 1 ? "" : "s"}` : "No actions yet";
}

function CopyCommand({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy command"
      title="Copy"
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
 * The Settings row that opens the Linked devices page. Hidden when the server
 * has no device routes (an older server, or a bot's view).
 */
export function LinkedDevicesRow({ onOpen }: { onOpen: () => void }) {
  const { devices, loaded, unavailable } = useLinkedDevices();
  if (!loaded || unavailable) return null;
  return (
    <SettingsRow
      onClick={onOpen}
      icon={<SettingsIcon><Laptop /></SettingsIcon>}
      title="Linked devices"
      description={devices.length ? devices.map((d) => `@${d.id}`).join(", ") : "None"}
      descriptionClassName="truncate"
    />
  );
}

/**
 * Settings > Linked devices: machines linked with `omg device`. Remove is the
 * kill switch from this side; Pair makes a one-use code. Nothing here approves
 * a request: that happens on the device itself (docs/device-link.md).
 */
export function LinkedDevicesPage() {
  const { devices, loaded, unavailable } = useLinkedDevices();
  const [name, setName] = useState("");
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (!window.confirm(`Unlink @${id}?`)) return;
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
    <div className="mx-auto max-w-xl space-y-8 pb-10" data-lfg-page-column>
      <div className="px-1">
        <h1 className="text-lg font-semibold leading-tight">Linked devices</h1>
        <p className="text-sm text-muted-foreground">You approve each action on the device.</p>
      </div>

      {loaded && unavailable ? (
        <p className="px-1 text-sm text-muted-foreground">This server cannot link devices.</p>
      ) : (
        <>
          {devices.length ? (
            <SettingsGroup label="Devices" footer={<>Type <code>@name</code> in a chat to use one.</>}>
              {devices.map((device) => (
                <div key={device.id} data-linked-device={device.id}>
                  <SettingsRow
                    icon={<SettingsIcon><Laptop /></SettingsIcon>}
                    title={`@${device.id}`}
                    description={`${lastSeenLabel(device.lastSeenAt)} · ${actionsLine(device)}`}
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
            </SettingsGroup>
          ) : null}

          <SettingsGroup label="Pair a device">
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
                  placeholder="test-mac"
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
                    Run on the device. Works once, until {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
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
        </>
      )}
    </div>
  );
}
