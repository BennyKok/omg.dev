import { useRef, useState } from "react";
import { changeDeviceReceiver, controllerSessionUrl, useDeviceReceiver } from "../lib/device-receiver";
import { DeviceNotificationSettings } from "./device-receiver-monitor";
import { DevicePermissions } from "./device-activity";
import { ActiveAccess, ExtensionApproval, MissedRequests, StartAccess } from "./device-access-controls";
import { SettingsFold, SettingsGroup } from "./settings-ui";

const inputClass = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";
const buttonClass = "rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50";

export function DeviceReceiverSettings() {
  const { state, error: connectionError } = useDeviceReceiver();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState("");
  const [code, setCode] = useState("");
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
  const requestCount = state?.requests?.length ?? 0;

  // ORDER BY WHAT NEEDS YOU. An approval first, then one card that says
  // whether this computer is linked and whether access is on, with the one
  // button that changes it. Everything else (open requests, the permission
  // list, notifications, the log) is a closed row under it. It used to be
  // seven open sections, and Start access was the sixth.
  return <div className="space-y-6">
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

      <ExtensionApproval state={state} busy={busy} act={act} />

      {!state.deviceId ? <SettingsGroup label="Connect">
        <form className="space-y-3 px-4 py-3" onSubmit={(e) => { e.preventDefault(); void act("connect", { server: server.trim(), code: code.trim() }); }}>
          <p className="text-xs text-muted-foreground">On the other computer, open Agent access and choose “Add a computer”. Enter its address and code here.</p>
          <label className="block space-y-1 text-xs">Address of the other computer<input aria-label="Address of the other computer" type="url" required placeholder="https://other-computer.example.ts.net" value={server} onChange={(e) => setServer(e.target.value)} className={inputClass} /></label>
          <label className="block space-y-1 text-xs">Pairing code<input aria-label="Pairing code" required autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} /></label>
          <button type="submit" disabled={busy || !server.trim() || !code.trim()} className={buttonClass}>Connect</button>
        </form>
      </SettingsGroup> : <SettingsGroup label="Access">
        <div className="space-y-3 px-4 py-3">
          <div>
            <p className="text-sm font-medium" role="status">{state.active ? "Access is active" : state.otherProcess ? "Access is managed by another process" : "Access is stopped"}</p>
            <p className="break-all text-xs text-muted-foreground">Linked as <strong>@{state.deviceId}</strong> to {state.server}</p>
          </div>
          {state.otherProcess && <p className="text-xs text-muted-foreground">Stop the other device process before starting access here. An old lock after a crash also blocks access.</p>}
          {state.active ? <ActiveAccess state={state} busy={busy} act={act} /> : <StartAccess state={state} busy={busy} act={act} />}
          {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        </div>
      </SettingsGroup>}

      {state.deviceId && <MissedRequests state={state} busy={busy} act={act} />}

      <SettingsGroup>
        {state.deviceId && <SettingsFold
          title="Active requests"
          description={state.queueError ? "Could not read the queue" : requestCount ? `${requestCount} active` : "None"}
          open={requestCount > 0 || !!state.queueError}
        >
          <div className="space-y-3 px-4 py-3">
            {state.queueError && <p role="alert" className="text-sm text-destructive">{state.queueError}</p>}
            {!state.queueError && !requestCount && <p className="text-sm text-muted-foreground">No active requests. New requests appear here even when access is stopped.</p>}
            {state.requests?.map((request) => {
              const href = controllerSessionUrl(state.server, request.requestedBy);
              return <div key={request.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{request.action} <span className="font-normal text-muted-foreground">· {request.status.replaceAll("-", " ")}</span></p>
                <p className="break-all text-xs text-muted-foreground">{request.id}</p>
                <p className="break-all text-xs">{request.requestedBy ? `Session ${request.requestedBy}` : "Request from the other computer"}</p>
                <div className="flex flex-wrap gap-3 text-xs">
                  {href && <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Open requesting session</a>}
                  {state.pending?.request.id === request.id && <button type="button" className="underline underline-offset-4" onClick={() => {
                    const approval = document.getElementById("device-approval");
                    approval?.scrollIntoView?.({ block: "center", behavior: "smooth" }); approval?.focus();
                  }}>Review approval</button>}
                </div>
              </div>;
            })}
            {(state.active || !!requestCount || !!state.queueError) && <>
              <button type="button" disabled={busy || state.otherProcess} className="rounded-lg bg-destructive px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => void act("clear")}>Stop and clear requests</button>
              <p className="text-xs text-muted-foreground">Stop and clear ends access, stops the running action, and cancels open requests. New requests cannot run until you start access again.</p>
            </>}
          </div>
        </SettingsFold>}

        <SettingsFold
          title="Allowed actions"
          description={state.actions.length ? `${state.actions.length} set on this computer` : "None configured"}
        >
          <DevicePermissions actions={state.actions} />
          <p className="border-t border-border/50 px-4 py-2.5 text-xs text-muted-foreground">Actions come from ~/.omg-device/config.json. The other computer cannot add actions or change these rules.</p>
        </SettingsFold>

        <SettingsFold title="Notifications"><DeviceNotificationSettings /></SettingsFold>

        <SettingsFold title="Activity" description={state.activity.length ? `${state.activity.length} entries` : "None yet"}>
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
        </SettingsFold>
      </SettingsGroup>

      {state.deviceId && <button type="button" disabled={busy} className="px-4 text-sm text-destructive disabled:opacity-50" onClick={() => {
        if (window.confirm("Disconnect the other computer and stop incoming access?")) void act("disconnect");
      }}>Disconnect</button>}
    </>}
  </div>;
}
