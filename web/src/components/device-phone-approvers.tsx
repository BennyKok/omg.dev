import { useMemo } from "react";
import { renderSVG } from "uqr";
import type { ReceiverState } from "../lib/linked-devices";
import { SettingsFold } from "./settings-ui";

type Act = (action: string, body?: Record<string, unknown>) => Promise<void>;

/**
 * Phones that answer for the person at this computer: they approve or deny what
 * waits here, and start or stop access, from anywhere. A phone is added only here,
 * by scanning the code this screen shows; it then signs every decision with a key
 * that stays on the phone (behind Face ID), and this computer checks each one.
 */
export function PhoneApprovers({ state, busy, act }: { state: ReceiverState; busy: boolean; act: Act }) {
  const approvers = state.approvers ?? [];
  const invite = state.approverInvite ?? null;
  const qr = useMemo(() => (invite ? `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(invite.payload, { border: 2 }))}` : null), [invite?.payload]);
  const description = approvers.length ? `${approvers.length} phone${approvers.length === 1 ? "" : "s"}` : "None";
  return <SettingsFold title="Approve from your phone" description={description} open={!!invite}>
    <div className="space-y-3 px-4 py-3">
      <p className="text-xs text-muted-foreground">A phone added here can approve or deny requests, and start or stop access, while you are away. Each answer is signed on the phone after Face ID, and this computer checks it before doing anything. omg.dev must be running here.</p>
      {approvers.map((a) => <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-medium">{a.name}</p>
          <p className="text-xs text-muted-foreground">Added {new Date(a.addedAt).toLocaleDateString()} · {a.id}</p>
        </div>
        <button type="button" disabled={busy} className="shrink-0 text-sm text-destructive disabled:opacity-50" onClick={() => {
          if (window.confirm(`Remove ${a.name}? It will no longer be able to approve anything here.`)) void act("approver-remove", { id: a.id });
        }}>Remove</button>
      </div>)}
      {invite && qr ? <div className="space-y-2 rounded-lg border border-border p-3">
        <img src={qr} alt="Code for your phone to scan" className="mx-auto h-56 w-56 rounded bg-white" />
        <p className="text-center text-xs text-muted-foreground">In Subtract on your iPhone: Servers → this computer → Use this iPhone to approve, then scan this code. It works once, until {new Date(invite.expiresAt).toLocaleTimeString()}.</p>
        <button type="button" disabled={busy} className="w-full rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={() => void act("approver-invite-close")}>Cancel</button>
      </div> : <button type="button" disabled={busy || !state.deviceId} className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50" onClick={() => void act("approver-invite")}>Add a phone</button>}
      {state.remote?.error && approvers.length > 0 && <p role="alert" className="text-xs text-destructive">Not reaching the controller for phone answers: {state.remote.error}</p>}
    </div>
  </SettingsFold>;
}
