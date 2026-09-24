import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { renderSVG } from "uqr";
import { ChevronRight, Download, Share, Smartphone, X } from "lucide-react";
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

const CALLOUT_DISMISSED_KEY = "lfg_pwa_install_callout_dismissed";

function initiallyDismissed() {
  try {
    return sessionStorage.getItem(CALLOUT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

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

export function PwaInstallCallout() {
  const { installed, mode, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState(initiallyDismissed);
  const action = useInstallAction(mode, install);

  if (installed || mode === "none" || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(CALLOUT_DISMISSED_KEY, "1");
    } catch {
      // Storage can be disabled; dismissing for this render is still enough.
    }
  };

  return (
    <>
      <aside className="mx-3 mt-2 flex items-center gap-3 rounded-2xl border border-primary/20 bg-card/90 px-3 py-2.5 shadow-sm backdrop-blur-xl">
        <OmgBrandMark className="size-10 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Install omg</div>
          <div className="truncate text-xs text-muted-foreground">
            Faster launch, its own window, and a home-screen icon.
          </div>
        </div>
        <Button size="sm" onClick={() => void action.act()} disabled={action.busy}>
          <Download className="size-4" />
          {mode === "native" ? "Install" : "How"}
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={dismiss} aria-label="Dismiss install suggestion">
          <X className="size-3.5" />
        </Button>
      </aside>
      <InstallInstructions mode={mode} open={action.instructionsOpen} onOpenChange={action.setInstructionsOpen} />
    </>
  );
}

export function PwaInstallSettingsSection() {
  const { installed, mode, install } = usePwaInstall();
  const action = useInstallAction(mode, install);

  if (installed || mode === "none") return null;

  return (
    <>
      {/* No section header: this is the only row in it, and "App" said
          nothing "Install omg" below didn't already say. */}
      <section className="space-y-2">
        <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
          <button
            type="button"
            onClick={() => void action.act()}
            disabled={action.busy}
            className={cn(
              "flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors duration-150 ease-ios hover:bg-foreground/[0.03] active:bg-foreground/[0.06]",
              action.busy && "opacity-50",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="flex size-7 items-center justify-center rounded-[7px] bg-primary text-white">
                <Download className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">Install omg</span>
                <span className="block text-xs text-muted-foreground">Open it from your desktop or Home Screen</span>
              </span>
            </div>
          </button>
        </div>
      </section>
      <InstallInstructions mode={mode} open={action.instructionsOpen} onOpenChange={action.setInstructionsOpen} />
    </>
  );
}

/** The omg.dev iPhone app. Same link as the README's App Store badge. */
export const IOS_APP_STORE_URL = "https://apps.apple.com/us/app/omg-dev/id6800792515";

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
 * foot of the rail now, above the machine switcher, and offers both ways to
 * have omg outside a browser tab: this computer (the web app install) and
 * your phone. The phone row opens a QR code for the iPhone app, because the
 * person reading this is at a desk and the phone is the device that has to
 * open the link.
 *
 * Dismissal is remembered on this browser. The iPhone offer does not depend
 * on this browser's install state, so a session-only dismissal would bring
 * the card back every visit to anyone who has already installed.
 */
export function GetAppsRailCard() {
  const { installed, mode, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState(railCardInitiallyDismissed);
  const action = useInstallAction(mode, install);
  if (dismissed) return null;
  const canInstallHere = !installed && mode !== "none";

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(RAIL_CARD_DISMISSED_KEY, "1");
    } catch {
      // Storage can be disabled; dismissing for this render is still enough.
    }
  };
  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(IOS_APP_STORE_URL, { border: 1 }))}`;
  const rowClass =
    "flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-muted";

  return (
    <>
      <section
        aria-label="Get the omg apps"
        data-testid="get-apps-card"
        className="mx-2 mb-2 rounded-xl border border-border bg-card/70 p-1.5"
      >
        <div className="flex items-center gap-2 px-2 pb-1 pt-0.5">
          <OmgBrandMark className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">Get the apps</span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss the apps card"
            className="-mr-1 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        {canInstallHere ? (
          <button type="button" onClick={() => void action.act()} disabled={action.busy} className={rowClass}>
            <Download className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">Install on this computer</span>
          </button>
        ) : null}
        <Popover.Root>
          <Popover.Trigger
            render={
              <button type="button" className={rowClass}>
                <Smartphone className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">Use on your phone</span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
              </button>
            }
          />
          <Popover.Portal>
            <Popover.Positioner side="right" align="end" sideOffset={10} className="isolate z-[170] outline-none">
              <Popover.Popup
                data-testid="ios-app-popover"
                className="w-60 rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl outline-none"
              >
                <img src={qr} alt="QR code for omg.dev on the App Store" className="mx-auto size-40 rounded-lg bg-white p-1.5" />
                <p className="mt-2.5 text-center text-[13px] font-semibold">Use omg on your phone</p>
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  Scan with your iPhone camera to get the app. Then start and follow your sessions from anywhere.
                </p>
                <a
                  href={IOS_APP_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex h-8 items-center justify-center rounded-lg bg-secondary text-xs font-medium hover:bg-muted"
                >
                  Open the App Store
                </a>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </section>
      <InstallInstructions mode={mode} open={action.instructionsOpen} onOpenChange={action.setInstructionsOpen} />
    </>
  );
}
