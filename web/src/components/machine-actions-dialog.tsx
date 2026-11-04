import { useState } from "react";
import { Cloud, ExternalLink } from "lucide-react";

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

const CLOUD_PLANS_URL = "https://app.omg.dev/settings";

// The box's account routes. The box forwards them to the control plane under
// /api/cli; the names stay stable here.
const ROUTES = {
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
 * @param machineExists False when the selected machine no longer exists. Rename
 * is disabled in that case, because there is nothing to name.
 */
export function MachineActionsDialog({
  action,
  name,
  machineExists = true,
  bindingId = "cloud",
  onClose,
  onSaved,
}: {
  action: "add" | "rename";
  name: string;
  machineExists?: boolean;
  bindingId?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const close = () => {
    if (!busy) onClose();
  };

  const trimmed = draft.trim();
  const canSave = machineExists && !busy && trimmed.length > 0 && trimmed !== name;

  const title = action === "rename" ? "Edit machine" : "omg.dev cloud";
  const description = action === "rename" ? "The name shows in your machine list on every device." : "A machine omg.dev runs for you.";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {/* Opened from the machine switcher, which on a phone sits inside the
          side navigation drawer (z-[180]) and a modal drawer turns off
          pointer events outside itself. Lift the dialog above the drawer and
          turn its pointer events back on, or it opens behind the drawer and
          ignores taps. Same band as the image annotator. */}
      <DialogContent
        className="pointer-events-auto z-[190] sm:max-w-md"
        overlayClassName="pointer-events-auto z-[190]"
        innerClassName="gap-5 p-5"
        data-machine-dialog={action}
      >
        <DialogHeader className="gap-1.5 pr-8">
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
