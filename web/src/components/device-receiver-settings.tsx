import { useRef, useState } from "react";
import { changeDeviceReceiver, controllerSessionUrl, useDeviceReceiver } from "../lib/device-receiver";
import { DeviceNotificationSettings } from "./device-receiver-monitor";
import { DevicePermissions } from "./device-activity";
import { SettingsGroup } from "./settings-ui";

const inputClass = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";
const buttonClass = "rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50";

export function DeviceReceiverSettings() {
  const { state, error: connectionError } = useDeviceReceiver();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState("");
  const [code, setCode] = useState("");
  const [minutes, setMinutes] = useState(60);
  const mutating = useRef(false);

  const act = async (action: string, body: Record<string, unknown> = {}) => {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError(null);
    try { await changeDeviceReceiver(action, body); if (action === "connect") setCode(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { mutating.current = false; setBusy(false); }
  };

  const pending = state?.pending;
  return <div className="space-y-6">
    <p className="px-1 text-sm text-muted-foreground">This instance receives requests. Its local config sets the permissions. Approve requests here on this computer.</p>
    {(error || connectionError) && <p role="alert" className="px-1 text-sm text-destructive">{error || connectionError}</p>}
    {!state && !error && !connectionError && <p className="px-1 text-sm text-muted-foreground">Loading device access…</p>}
    {state && <>
      {pending && <section id="device-approval" tabIndex={-1} aria-label="Action approval" className="space-y-3 rounded-xl border border-amber-500/50 bg-amber-500/5 p-4">
        <h2 className="text-sm font-semibold">Approve {pending.request.action}</h2>
        <p className="text-xs text-muted-foreground">Requested by {state.server}{pending.request.requestedBy ? ` · session ${pending.request.requestedBy}` : ""}</p>
        <p className="text-xs">{pending.approval === "once-per-grant" ? "This allows the action with any valid arguments until access ends." : "This approval allows only this request."}</p>
        <pre dir="ltr" className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 text-xs">{pending.argv.map((arg) => JSON.stringify(arg).replace(/[\u202a-\u202e\u2066-\u2069]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)).join(" ")}</pre>
        <p className="text-xs text-muted-foreground">No answer means deny. Expires at {new Date(pending.expiresAt).toLocaleTimeString()}.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={() => void act("decision", { token: pending.token, allow: false })}>Deny</button>
          <button type="button" disabled={busy || pending.expiresAt <= Date.now()} className={buttonClass} onClick={() => void act("decision", { token: pending.token, allow: true })}>{pending.approval === "once-per-grant" ? "Allow until access ends" : "Allow once"}</button>
        </div>
      </section>}

      {state.deviceId && <SettingsGroup label="Active requests and sessions" footer="These sessions requested work from the controller. Session links open that computer. Clearing requests keeps the audit log and leaves coding sessions open.">
        <div className="space-y-3 px-4 py-3">
          {state.queueError && <p role="alert" className="text-sm text-destructive">{state.queueError}</p>}
          {!state.queueError && !state.requests?.length && <p className="text-sm text-muted-foreground">No active requests. New requests appear here even when access is stopped.</p>}
          {state.requests?.map((request) => {
            const href = controllerSessionUrl(state.server, request.requestedBy);
            return <div key={request.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">{request.action} <span className="font-normal text-muted-foreground">· {request.status.replaceAll("-", " ")}</span></p>
              <p className="break-all text-xs text-muted-foreground">{request.id}</p>
              <p className="break-all text-xs">{request.requestedBy ? `Session ${request.requestedBy}` : "Request from the controller"}</p>
              <div className="flex flex-wrap gap-3 text-xs">
                {href && <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Open requesting session</a>}
                {state.pending?.request.id === request.id && <button type="button" className="underline underline-offset-4" onClick={() => {
                  const approval = document.getElementById("device-approval");
                  approval?.scrollIntoView?.({ block: "center", behavior: "smooth" }); approval?.focus();
                }}>Review approval</button>}
              </div>
            </div>;
          })}
          {(state.active || !!state.requests?.length || !!state.queueError) && <button type="button" disabled={busy || state.otherProcess} className="rounded-lg bg-destructive px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => void act("clear")}>Stop and clear requests</button>}
          <p className="text-xs text-muted-foreground">Stop and clear ends access, stops the running action, and cancels open requests. New requests cannot run until you start access again.</p>
        </div>
      </SettingsGroup>}

      <SettingsGroup label="Notifications on this computer"><DeviceNotificationSettings /></SettingsGroup>

      <SettingsGroup label="Controller">
        <div className="space-y-3 px-4 py-3">
          {state.deviceId ? <>
            <p className="text-sm">Linked as <strong>@{state.deviceId}</strong></p>
            <p className="break-all text-xs text-muted-foreground">{state.server}</p>
            <button type="button" disabled={busy} className="text-sm text-destructive disabled:opacity-50" onClick={() => {
              if (window.confirm("Disconnect this controller and stop incoming access?")) void act("disconnect");
            }}>Disconnect controller</button>
          </> : <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void act("connect", { server: server.trim(), code: code.trim() }); }}>
            <p className="text-xs text-muted-foreground">Create a pairing code under “Send requests” on the controller. Enter its address and code here.</p>
            <label className="block space-y-1 text-xs">Controller address<input aria-label="Controller address" type="url" required placeholder="https://controller.example.ts.net" value={server} onChange={(e) => setServer(e.target.value)} className={inputClass} /></label>
            <label className="block space-y-1 text-xs">Pairing code<input aria-label="Pairing code" required autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} /></label>
            <button type="submit" disabled={busy || !server.trim() || !code.trim()} className={buttonClass}>Connect controller</button>
          </form>}
        </div>
      </SettingsGroup>

      <SettingsGroup label="Permissions on this computer" footer="Actions come from ~/.omg-device/config.json. The controller cannot add actions or change these rules.">
        <DevicePermissions actions={state.actions} />
      </SettingsGroup>

      {state.deviceId && <SettingsGroup label="Incoming access">
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm font-medium" role="status">{state.active ? "Access is active" : state.otherProcess ? "Access is managed by another process" : "Access is stopped"}</p>
          {state.otherProcess && <p className="text-xs text-muted-foreground">Stop the other device process before starting access here. An old lock after a crash also blocks access.</p>}
          {state.active ? <>
            <p className="text-xs text-muted-foreground">Ends at {state.endsAt && new Date(state.endsAt).toLocaleTimeString()}. Stops after {state.idleMinutes} idle minutes.</p>
            <button type="button" disabled={busy} className="rounded-lg bg-destructive px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => void act("stop")}>Stop access</button>
          </> : <>
            <p className="text-xs text-muted-foreground">Starting access allows actions marked “Allowed during access” to run without another prompt. Other actions ask below.</p>
            <label className="flex items-center gap-3 text-sm">Access duration<select aria-label="Access duration" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="rounded-lg border border-border bg-background p-2">
              {[15, 30, 60, 120].map((n) => <option key={n} value={n}>{n} minutes</option>)}
            </select></label>
            <button type="button" disabled={busy || !state.actions.length || state.otherProcess} className={buttonClass} onClick={() => void act("start", { minutes, idle: 15 })}>Start access</button>
          </>}
          {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        </div>
      </SettingsGroup>}



      <SettingsGroup label="Activity on this computer">
        <div className="divide-y divide-border/50 px-4">
          {!state.activity.length && <p className="py-3 text-sm text-muted-foreground">No activity yet.</p>}
          {state.activity.map((entry, i) => <details key={`${entry.at}-${i}`} className="py-3 text-xs">
            <summary className="cursor-pointer">{entry.request?.action && <strong>{entry.request.action} · </strong>}{entry.kind.replaceAll("-", " ")}<span className="ml-2 text-muted-foreground">{new Date(entry.at).toLocaleTimeString()}</span></summary>
            <div className="mt-2 space-y-2">
              {entry.request && <pre className="whitespace-pre-wrap break-all">{JSON.stringify(entry.request.args, null, 2)}</pre>}
              {(entry.reason || entry.update?.reason) && <p>{entry.reason || entry.update?.reason}</p>}
              {entry.update?.exitCode !== undefined && <p>Exit code: {entry.update.exitCode}</p>}
              {entry.update?.logTail && <><p className="text-muted-foreground">Action output · untrusted text</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3">{entry.update.logTail}</pre></>}
            </div>
          </details>)}
        </div>
      </SettingsGroup>
    </>}
  </div>;
}
