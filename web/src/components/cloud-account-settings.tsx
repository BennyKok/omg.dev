import { Check, Cloud, Laptop, LogIn, LogOut } from "lucide-react";

import {
  LOCAL_MACHINE_CHOICE,
  machineStatusLabel,
  rowMachineChoice,
  useCloudMachines,
  type CloudComputerRow,
} from "../lib/cloud-machines";
import { activeMachine, selectMachine, type MachineChoice } from "../lib/machines";

export type { CloudAccountStatus, CloudComputerRow } from "../lib/cloud-machines";

/**
 * The account this box is signed in to, the machines that account has, and
 * which one this UI is pointed at.
 *
 * Sign-in is a redirect through this server: POST /api/cloud/login answers
 * with the authorization URL, the browser goes there, and auth.omg.dev sends
 * it back to /api/cloud/callback on this server, which stores the credential
 * on the box. The token never reaches this page.
 *
 * Picking a machine here is the mobile and tablet path; desktop also has the
 * machine rail. Both call selectMachine, which reloads against the choice.
 */
export function CloudAccountSettingsSection({
  onSelectMachine = selectMachine,
}: {
  onSelectMachine?: (choice: MachineChoice) => void;
}) {
  const { status, computers, error, busy, signIn, signOut } = useCloudMachines();
  const active = activeMachine();

  if (!status) return null;

  const rows: Array<{ key: string; choice: MachineChoice | null; row: CloudComputerRow | null }> = [
    { key: "local", choice: LOCAL_MACHINE_CHOICE, row: null },
    ...(computers ?? []).map((row) => ({ key: row.slug, choice: rowMachineChoice(row), row })),
  ];

  return (
    <section className="space-y-2" aria-labelledby="cloud-account-heading">
      <h2 id="cloud-account-heading" className="px-4 text-xs font-semibold text-muted-foreground">
        omg Cloud
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-primary text-white">
            <Cloud className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {status.signedIn ? "Signed in" : "Not signed in"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {status.signedIn
                ? (status.email ?? "omg Cloud account")
                : "Sign in to see your cloud and connected computers here."}
            </span>
          </span>
          {status.signedIn ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void signOut()}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void signIn()}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              <LogIn className="size-3.5" />
              Sign in
            </button>
          )}
        </div>

        {status.signedIn && computers === null && !error ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">Loading computers…</div>
        ) : null}

        {status.signedIn
          ? rows.map(({ key, choice, row }) => {
              const selected = choice?.id === active.id;
              const selectable = Boolean(choice) && !selected;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!selectable}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => choice && onSelectMachine(choice)}
                  data-cloud-computer={key}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:cursor-default"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
                    {row?.kind === "cloud" ? (
                      <Cloud className="size-4 text-foreground/70" />
                    ) : (
                      <Laptop className="size-4 text-foreground/70" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{row ? row.name : "This computer"}</span>
                      {row?.isDefault ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          Default
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${!row || row.online ? "bg-success" : "bg-foreground/20"}`}
                      />
                      {row ? machineStatusLabel(row) : "The box that served this page"}
                    </span>
                  </span>
                  {selected ? (
                    <Check className="size-4 shrink-0 text-primary" aria-label="Selected" />
                  ) : choice ? (
                    <span className="text-xs font-medium text-primary">Use</span>
                  ) : null}
                </button>
              );
            })
          : null}

        {computers && computers.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">No computers on this account yet.</div>
        ) : null}

        {error ? (
          <div className="px-4 py-3 text-xs text-destructive" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
