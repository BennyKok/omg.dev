import { approvalLabels, type DeviceRequestRow, type LinkedDevice } from "../lib/linked-devices";

export function DevicePermissions({ actions }: { actions: LinkedDevice["actions"] }) {
  return <div className="space-y-3 px-4 py-3">
    {actions.length ? actions.map((action) => <div key={action.name} className="flex flex-wrap items-start justify-between gap-2 text-sm">
      <div className="min-w-0"><code className="break-all">{action.name}</code>{action.description && <p className="text-xs text-muted-foreground">{action.description}</p>}</div>
      <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{approvalLabels[action.approval] ?? "Unknown permission"}</span>
    </div>) : <p className="text-sm text-muted-foreground">No actions configured on this device.</p>}
  </div>;
}

const statusLabels: Record<string, string> = {
  queued: "Queued", delivered: "Received", "waiting-approval": "Waiting for approval on the device",
  running: "Running", done: "Completed", failed: "Failed", denied: "Denied", expired: "Expired",
};

export function DeviceActivity({ requests }: { requests: DeviceRequestRow[] }) {
  return <div className="divide-y divide-border/50 px-4">
    {!requests.length && <p className="py-3 text-sm text-muted-foreground">No requests yet.</p>}
    {requests.map((r) => <details key={r.id} className="py-3" open={r.status === "waiting-approval"}>
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">{r.action}</span><span className="text-muted-foreground"> · @{r.device}</span>
        <span className={`mt-1 block text-xs ${r.status === "waiting-approval" ? "text-amber-600" : "text-muted-foreground"}`}>{statusLabels[r.status] ?? r.status} · {new Date(r.updatedAt).toLocaleTimeString()}</span>
      </summary>
      <div className="mt-3 space-y-2 text-xs">
        <code className="block break-all text-muted-foreground">{r.id}</code>
        {r.args && <pre className="whitespace-pre-wrap break-all">{JSON.stringify(r.args, null, 2)}</pre>}
        {r.reason && <p>{r.reason}</p>}
        {r.exitCode !== undefined && <p>Exit code: {r.exitCode}</p>}
        {!!r.files?.length && <p>Returned files: {r.files.map((f) => f.name).join(", ")}</p>}
        {r.untrustedOutput && <><p className="text-muted-foreground">Device output · untrusted text</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3">{r.untrustedOutput}</pre></>}
      </div>
    </details>)}
  </div>;
}
