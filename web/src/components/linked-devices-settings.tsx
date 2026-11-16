import { useEffect, useState } from "react";
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
import { SettingsFold, SettingsGroup, SettingsIcon, SettingsRow } from "./settings-ui";
import { DeviceActivity, DevicePermissions } from "./device-activity";
import { useDeviceReceiver } from "../lib/device-receiver";
import { DeviceReceiverSettings } from "./device-receiver-settings";

/** Same rule as src/devices/protocol.ts NAME_RE; the server checks it again. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Summary above the per-action permission list. */
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
  const { state: receiver } = useDeviceReceiver();
  // Drawn while the list loads, with its description line kept, so the rows
  // under it do not move when the answer arrives. Hidden only once the
  // server has said it has no device linking.
  if (loaded && unavailable) return null;
  return (
    <SettingsRow
      reserveDescription
      onClick={onOpen}
      icon={<SettingsIcon><Laptop /></SettingsIcon>}
      title="Agent access"
      description={[devices.map((d) => `@${d.id}`).join(", "), receiver?.deviceId ? `Receiving as @${receiver.deviceId}${receiver.pending ? " · Approval needed" : ""}` : ""].filter(Boolean).join(" · ") || "No devices linked"}
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
  const { devices, requests, loaded, unavailable } = useLinkedDevices(true);
  const { state: receiver } = useDeviceReceiver();
  const [selectedRole, setRole] = useState<"controller" | "receiver" | null>(null);
  const role = selectedRole ?? (new URLSearchParams(window.location.search).has("receive") || receiver?.deviceId ? "receiver" : "controller");
  useEffect(() => {
    const open = () => setRole("receiver");
    window.addEventListener("omg-device-open", open);
    return () => window.removeEventListener("omg-device-open", open);
  }, []);
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

  const waiting = requests.filter((request) => request.status === "waiting-approval").length;

  // AS LITTLE AS POSSIBLE ON THE PAGE. It used to draw everything in full:
  // two role cards, every permission of every computer (24 rows for one
  // Mac), the request log and the pairing form. Now each computer is one
  // row, and its permissions, the log and the pairing form open in place.
  // Nothing is removed: Unlink and the permission list are one tap down.
  return (
    <div className="mx-auto max-w-xl space-y-6 pb-10" data-lfg-page-column>
      <div className="px-1">
        <h1 className="text-lg font-semibold leading-tight max-md:hidden">Agent access</h1>
        <p className="text-sm text-muted-foreground">
          {role === "receiver"
            ? "Agents on another computer can ask this one to do an action. You approve it here."
            : "Agents here can ask another computer to do an action. That computer approves it."}
        </p>
      </div>

      <div role="group" aria-label="Connection role" className="flex rounded-full bg-muted p-0.5">
        {([["controller", "Use another computer"], ["receiver", "Share this computer"]] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={role === value}
            onClick={() => setRole(value)}
            className={`relative h-9 min-w-0 flex-1 truncate rounded-full px-3 text-[13px] font-medium transition-colors ${role === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            {label}
            {value === "receiver" && receiver?.pending ? (
              <span role="status" aria-label="Approval needed" className="ml-1.5 inline-block size-2 rounded-full bg-amber-500 align-middle" />
            ) : null}
          </button>
        ))}
      </div>

      {role === "receiver" ? <DeviceReceiverSettings /> : loaded && unavailable ? (
        <p className="px-1 text-sm text-muted-foreground">This server cannot link devices.</p>
      ) : (
        <>
          <SettingsGroup label="Computers" footer={devices.length ? <>Type <code>@name</code> in a chat to use one.</> : undefined}>
            {devices.map((device) => (
              <div key={device.id} data-linked-device={device.id}>
                <SettingsFold
                  icon={<SettingsIcon><Laptop /></SettingsIcon>}
                  title={`@${device.id}`}
                  description={`${lastSeenLabel(device.lastSeenAt)} · ${actionsLine(device)}`}
                >
                  <DevicePermissions actions={device.actions} />
                  <div className="border-t border-border/50 px-4 py-2.5">
                    <button
                      type="button"
                      aria-label={`Unlink ${device.id}`}
                      disabled={!!busy}
                      onClick={() => void remove(device.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg text-sm font-medium text-destructive disabled:opacity-50"
                    >
                      {busy === device.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      Unlink
                    </button>
                  </div>
                </SettingsFold>
              </div>
            ))}
            <SettingsFold
              icon={<SettingsIcon><Plus /></SettingsIcon>}
              title="Add a computer"
              open={devices.length === 0 || !!pairing}
            >
              <div className="space-y-3 px-4 py-3">
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
                    placeholder="Name, for example test-mac"
                    maxLength={40}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background/50 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button
                    type="submit"
                    disabled={!nameOk || !!busy}
                    className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50"
                  >
                    {busy === "pair" ? <Loader2 className="size-4 animate-spin" /> : null}
                    Get code
                  </button>
                </form>

                {pairing ? (
                  <div data-pairing-code className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      On the other computer, open Agent access, then “Share this computer”. This code works once, until {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
                    </p>
                    <p className="break-all text-sm">Address: {pairing.server || "Use this computer’s Tailscale HTTPS address."}</p>
                    <p className="text-sm">Pairing code: <code className="font-semibold">{pairing.code}</code></p>
                    <p className="pt-2 text-xs text-muted-foreground">Or connect from its terminal:</p>
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 py-1 pl-3 pr-1">
                      <code className="min-w-0 flex-1 break-all text-xs">{linkCommand(pairing)}</code>
                      <CopyCommand value={linkCommand(pairing)} />
                    </div>
                  </div>
                ) : null}

                {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
              </div>
            </SettingsFold>
          </SettingsGroup>

          {/* The log is closed until something in it needs you. */}
          <SettingsGroup>
            <SettingsFold
              data-testid="device-requests-fold"
              title="Recent requests"
              description={
                waiting
                  ? `${waiting} waiting for approval on the other computer`
                  : requests.length
                    ? `${requests.length} in the log`
                    : "None yet"
              }
              open={waiting > 0}
            >
              <DeviceActivity requests={requests} />
            </SettingsFold>
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
