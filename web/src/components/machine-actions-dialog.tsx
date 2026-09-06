import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Copy,
  ExternalLink,
  Laptop,
  TimerOff,
  X,
} from "lucide-react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

/** The verified bootstrap from packages/cli/README.md. It does not need Bun or npm. */
export const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/BennyKok/omg.dev/main/scripts/setup.sh | OMG_INSTALL_BUN=1 bash";

const CLOUD_PLANS_URL = "https://app.omg.dev/settings";

const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

/** The pairing command the CLI accepts: `omg connect 'CODE' --relay 'wss://…'`. */
export function connectCommand(pairing: { code: string; connectUrl: string }): string {
  return `omg connect ${quote(pairing.code)} --relay ${quote(pairing.connectUrl)}`;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// The box's account routes. The box forwards them to the control plane under
// /api/cli; the names stay stable here.
const ROUTES = {
  pairing: "/api/cloud/pairing",
  rename: "/api/cloud/rename",
  provision: "/api/cloud/provision",
} as const;

async function request<T>(action: keyof typeof ROUTES, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(ROUTES[action], {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

type Pairing = { code: string; connectUrl: string; expiresAt: number };
type Outcome = "connected" | "expired" | null;
type Step = "choose" | "own" | "cloud";

/** One terminal line with a copy affordance. */
function CommandBlock({ command, label }: { command: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = useCallback(() => {
    const settle = (next: "copied" | "failed") => {
      setState(next);
      window.setTimeout(() => setState("idle"), next === "copied" ? 1400 : 3000);
    };
    if (!navigator.clipboard?.writeText) return settle("failed");
    navigator.clipboard.writeText(command).then(() => settle("copied"), () => settle("failed"));
  }, [command]);
  const title = state === "failed" ? "Copy failed. Select the command and copy it." : state === "copied" ? "Copied" : label;
  return (
    <div className="flex items-start gap-1.5 rounded-xl bg-foreground/[0.05] py-1.5 pl-3 pr-1.5 ring-1 ring-inset ring-foreground/[0.06]">
      <code className="min-w-0 flex-1 select-all break-all py-1 font-mono text-[12px] leading-5 text-foreground/85">
        {command}
      </code>
      <Button
        type="button"
        variant="tint"
        size="icon-sm"
        aria-label={label}
        title={title}
        data-copy-state={state}
        onClick={copy}
        className="shrink-0"
      >
        {state === "copied" ? (
          <Check className="size-4 text-success" />
        ) : state === "failed" ? (
          <X className="size-4 text-destructive" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
      {state === "failed" ? (
        <span role="status" className="sr-only">
          Copy failed. Select the command and copy it.
        </span>
      ) : null}
    </div>
  );
}

function StepItem({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
          done ? "bg-success/15 text-success" : "bg-foreground/[0.08] text-foreground/80",
        )}
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium leading-6">{title}</p>
        {children}
      </div>
    </li>
  );
}

function ChoiceCard({
  icon: Icon,
  title,
  body,
  onClick,
  id,
}: {
  icon: typeof Laptop;
  title: string;
  body: string;
  onClick: () => void;
  id: string;
}) {
  return (
    <button
      type="button"
      data-machine-choice={id}
      onClick={onClick}
      className="group flex items-center gap-3 rounded-2xl bg-foreground/[0.03] p-3 text-left ring-1 ring-inset ring-foreground/[0.08] transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-start sm:p-4"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{body}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 sm:hidden" />
    </button>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
      {children}
    </p>
  );
}

/**
 * Add a machine to the account this box is signed in to, or edit a machine
 * name. The machine list itself belongs to useCloudMachines; this dialog
 * only asks it to reload through `onSaved`.
 *
 * @param connectedIds The ids of the connected machines on the account right
 * now. While a pairing code is out, the dialog reloads the list and treats a
 * new id as "that machine connected".
 * @param machineExists False when the selected machine no longer exists. Rename
 * is disabled in that case, because there is nothing to name.
 */
export function MachineActionsDialog({
  action,
  name,
  machineExists = true,
  bindingId = "cloud",
  connectedIds = [],
  onClose,
  onSaved,
}: {
  action: "add" | "rename";
  name: string;
  machineExists?: boolean;
  bindingId?: string;
  connectedIds?: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [draft, setDraft] = useState(name);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const requestCode = useCallback(() => {
    knownIdsRef.current = new Set(connectedIds);
    setOutcome(null);
    setPairing(null);
    return run(async () => {
      setPairing(await request<Pairing>("pairing"));
    });
    // The snapshot of known ids is taken when the code is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedIds.join("\u0000")]);

  const waiting = pairing !== null && outcome === null;

  // A new connected id while a code is out means that machine paired.
  useEffect(() => {
    if (!waiting) return;
    if (connectedIds.some((id) => !knownIdsRef.current.has(id))) setOutcome("connected");
  }, [connectedIds, waiting]);

  // Ask the list owner to reload while waiting, so the connection shows up
  // here in seconds rather than at the owner's own refresh cadence.
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => void onSavedRef.current(), 3000);
    return () => window.clearInterval(id);
  }, [waiting]);

  // Countdown, and the flip to "expired".
  useEffect(() => {
    if (!waiting || !pairing) return;
    const check = () => {
      if (Date.now() >= pairing.expiresAt) setOutcome("expired");
      else setTick((tick) => tick + 1);
    };
    check();
    const id = window.setInterval(check, 1000);
    return () => window.clearInterval(id);
  }, [pairing, waiting]);

  const close = () => {
    if (!busy) onClose();
  };

  const trimmed = draft.trim();
  const canSave = machineExists && !busy && trimmed.length > 0 && trimmed !== name;

  const title =
    action === "rename" ? "Edit machine" : step === "own" ? "Connect your machine" : step === "cloud" ? "omg.dev cloud" : "Add machine";
  const description =
    action === "rename"
      ? "Choose a name you can recognize in your machine list."
      : step === "own"
        ? "Two commands in Terminal on the machine you want to connect."
        : step === "cloud"
          ? "A machine omg.dev runs for you."
          : "Where should your agents run?";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-md" innerClassName="gap-5 p-5" data-machine-dialog={action}>
        <DialogHeader className="gap-1.5 pr-8">
          {action === "add" && step !== "choose" ? (
            <button
              type="button"
              onClick={() => {
                setStep("choose");
                setError(null);
              }}
              className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              All options
            </button>
          ) : null}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {action === "rename" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSave) return;
              void run(async () => {
                await request("rename", { name: trimmed, bindingId });
                await onSaved();
                onClose();
              });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="machine-name" className="text-xs font-medium text-muted-foreground">
                Name
              </label>
              <Input
                id="machine-name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={80}
                autoComplete="off"
                disabled={!machineExists || busy}
                placeholder="Machine name"
              />
              <p className="text-xs text-muted-foreground">Up to 80 characters.</p>
            </div>
            {!machineExists ? (
              <p className="rounded-xl bg-foreground/[0.05] px-3 py-2 text-xs leading-5 text-muted-foreground">
                This machine is no longer available.
              </p>
            ) : null}
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        ) : step === "choose" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard
              id="own"
              icon={Laptop}
              title="Your machine"
              body="A computer you own. Your files stay where they are."
              onClick={() => {
                setStep("own");
                setError(null);
              }}
            />
            <ChoiceCard
              id="cloud"
              icon={Cloud}
              title="omg.dev cloud"
              body="Ready when you need it. Nothing to install."
              onClick={() => {
                setStep("cloud");
                setError(null);
              }}
            />
          </div>
        ) : step === "own" ? (
          <ol className="flex flex-col gap-5">
            <StepItem n={1} title="Install omg on that machine">
              <CommandBlock command={INSTALL_COMMAND} label="Copy install command" />
              <p className="text-xs leading-5 text-muted-foreground">
                Already installed? Skip this. If <code className="font-mono">omg</code> is not found afterwards, open a fresh
                Terminal so it picks up the new PATH.
              </p>
            </StepItem>
            <StepItem n={2} title="Connect it to your account" done={outcome === "connected"}>
              {pairing && outcome === null ? (
                <CommandBlock command={connectCommand(pairing)} label="Copy connect command" />
              ) : null}
              {busy && !pairing ? (
                <div className="h-10 animate-pulse rounded-xl bg-foreground/[0.05]" aria-label="Getting a code" />
              ) : null}
              {error ? <ErrorNote>{error}</ErrorNote> : null}
              {!pairing && !busy && !error ? (
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void requestCode()}>
                  Ready to connect
                </Button>
              ) : null}
              {!pairing && !busy && error ? (
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void requestCode()}>
                  Try again
                </Button>
              ) : null}
              {pairing && outcome === null ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground" data-pairing-status="waiting">
                  <span className="relative flex size-2 shrink-0">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">Waiting for that machine…</span>
                  <span className="tabular-nums">Expires in {formatRemaining(pairing.expiresAt - Date.now())}</span>
                </div>
              ) : null}
              {outcome === "connected" ? (
                <div className="flex items-center gap-2 text-xs text-success" data-pairing-status="connected">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span className="flex-1">Connected. It is in your machine list now.</span>
                  <Button type="button" size="sm" onClick={onClose}>
                    Done
                  </Button>
                </div>
              ) : null}
              {outcome === "expired" ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground" data-pairing-status="expired">
                  <TimerOff className="size-4 shrink-0" />
                  <span className="flex-1">That code expired. Codes last a few minutes.</span>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void requestCode()}>
                    Get a new code
                  </Button>
                </div>
              ) : null}
            </StepItem>
          </ol>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-2xl bg-foreground/[0.03] p-3 ring-1 ring-inset ring-foreground/[0.08]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Cloud className="size-5" />
              </span>
              <ul className="flex flex-col gap-1 text-xs leading-5 text-muted-foreground">
                <li>Access it from any device.</li>
                <li>Machine size and compute follow your plan.</li>
                <li>Appears in your machine list as soon as it is ready.</li>
              </ul>
            </div>
            <a
              href={CLOUD_PLANS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
            >
              View cloud plans
              <ExternalLink className="size-3" />
            </a>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const cloud = await request<{ status: string }>("provision");
                    if (cloud.status === "upgrade_required") {
                      throw new Error("Your plan does not include a cloud machine yet. Open View cloud plans to upgrade.");
                    }
                    if (cloud.status === "none") throw new Error("Your cloud machine is not ready yet. Try again in a moment.");
                    await onSaved();
                    onClose();
                  })
                }
              >
                {busy ? "Setting up…" : "Create cloud machine"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
