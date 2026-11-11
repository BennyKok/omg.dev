import { useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePwaInstall, type PwaInstallMode } from "@/lib/pwa-install";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/notify";
import { OmgBrandMark } from "@/components/omg-brand-mark";
import { SettingsIcon, SettingsRow } from "@/components/settings-ui";

export function InstallInstructions({ mode, open, onOpenChange }: {
  mode: PwaInstallMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ios = mode === "ios";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {ios ? <Share className="size-7" /> : <Download className="size-7" />}
          </div>
          <DialogTitle>{ios ? "Install omg on your Home Screen" : "Install omg on your Mac"}</DialogTitle>
          <DialogDescription>
            {ios
              ? "Open omg like an app, without browser controls."
              : "Add omg to your Dock and open it in its own window."}
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {(ios
            ? [
                <>Tap the <strong>Share</strong> button in your browser.</>,
                <>Choose <strong>Add to Home Screen</strong>.</>,
                <>Keep <strong>Open as Web App</strong> on, then tap <strong>Add</strong>.</>,
              ]
            : [
                <>Open the <strong>File</strong> menu in Safari.</>,
                <>Choose <strong>Add to Dock…</strong>.</>,
                <>Confirm the name, then click <strong>Add</strong>.</>,
              ]
          ).map((step, index) => (
            <li key={index} className="flex items-start gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <Button onClick={() => onOpenChange(false)}>Got it</Button>
      </DialogContent>
    </Dialog>
  );
}

function useInstallAction(mode: PwaInstallMode, install: () => Promise<boolean>) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async () => {
    if (mode !== "native") {
      setInstructionsOpen(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const installed = await install();
      if (installed) toast.success("omg installed");
    } catch {
      toast.error("Could not open the install prompt");
    } finally {
      setBusy(false);
    }
  };

  return { act, busy, instructionsOpen, setInstructionsOpen };
}

/** A Settings row under "This device"; the caller owns the card. */
export function PwaInstallSettingsRow() {
  const { installed, mode, install } = usePwaInstall();
  const action = useInstallAction(mode, install);

  if (installed || mode === "none") return null;

  return (
    <>
      <SettingsRow
        onClick={() => void action.act()}
        className={cn(action.busy && "pointer-events-none opacity-50")}
        aria-disabled={action.busy}
        icon={<SettingsIcon><Download /></SettingsIcon>}
        title="Install omg"
        description="Open it from your desktop or Home Screen"
      />
      <InstallInstructions mode={mode} open={action.instructionsOpen} onOpenChange={action.setInstructionsOpen} />
    </>
  );
}

const RAIL_CARD_DISMISSED_KEY = "lfg_get_apps_card_dismissed";

function railCardInitiallyDismissed() {
  try {
    return window.localStorage.getItem(RAIL_CARD_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * THE DESKTOP RAIL'S "GET THE APPS" CARD.
 *
 * The install suggestion used to be a full-width banner over the whole
 * desktop layout, pushing everything down to sell one thing. It sits at the
 * foot of the rail now and offers to install the web app on this computer.
 *
 * Dismissal is remembered on this browser. The iPhone offer does not depend
 * on this browser's install state, so a session-only dismissal would bring
 * the card back every visit to anyone who has already installed.
 */
export function GetAppsRailCard() {
  const { installed, mode, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState(railCardInitiallyDismissed);
  const action = useInstallAction(mode, install);
  const canInstallHere = !installed && mode !== "none";
  // Nothing left to offer once this computer has it.
  if (dismissed || !canInstallHere) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(RAIL_CARD_DISMISSED_KEY, "1");
    } catch {
      // Storage can be disabled; dismissing for this render is still enough.
    }
  };
  const rowClass =
    "flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-muted";

  return (
    <>
      <section
        aria-label="Install omg"
        data-testid="get-apps-card"
        className="mx-2 mb-2 rounded-xl border border-border bg-card/70 p-1.5"
      >
        <div className="flex items-center gap-2 px-2 pb-1 pt-0.5">
          <OmgBrandMark className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">Install omg</span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss the install card"
            className="-mr-1 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <button type="button" onClick={() => void action.act()} disabled={action.busy} className={rowClass}>
          <Download className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">Install on this computer</span>
        </button>
      </section>
      <InstallInstructions mode={mode} open={action.instructionsOpen} onOpenChange={action.setInstructionsOpen} />
    </>
  );
}
