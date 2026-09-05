import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronLeft } from "lucide-react";

/** Full-screen auto-agent surface. Viewport geometry stays owned by the app's
 * visual-viewport bridge; no drawer drag or input-repositioning layer. */
export function AutoAgentPage({ onClose, title, footer, children }: {
  onClose: () => void;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[100] bg-background" />
        <Dialog.Popup
          data-auto-agent-page
          initialFocus={false}
          className="pointer-events-auto fixed inset-x-0 z-[100] flex flex-col overflow-hidden bg-background text-sm text-foreground outline-none"
          style={{
            top: "var(--lfg-visual-offset-top, 0px)",
            height: "var(--lfg-visual-height, var(--lfg-app-height, 100dvh))",
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <header className="shrink-0 border-b border-border pt-[env(safe-area-inset-top,0px)]">
            <div className="mx-auto flex w-full max-w-4xl items-center gap-2 px-4 py-2">
              <Dialog.Close aria-label="Back" className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
                <ChevronLeft className="size-5" />
              </Dialog.Close>
              <Dialog.Title className="min-w-0 truncate text-base font-semibold">{title}</Dialog.Title>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scroll-padding-block:1rem]">
            <div className="mx-auto w-full max-w-4xl px-4 py-4 pb-[max(var(--lfg-safe-bottom),1rem)] sm:px-6">
              {children}
            </div>
          </div>
          {footer ? (
            <footer className="shrink-0 border-t border-border pb-[var(--lfg-safe-bottom)]">
              <div className="mx-auto w-full max-w-4xl px-4 py-2 sm:px-6">{footer}</div>
            </footer>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
