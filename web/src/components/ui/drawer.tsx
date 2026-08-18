"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"
import { useExpandOnFocus } from "@/lib/expand-on-focus"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// On desktop we present these surfaces as a centered dialog instead of a
// bottom-sheet drawer — a slide-up sheet reads as a mobile affordance and
// wastes horizontal space on wide viewports. On mobile (coarse pointer /
// narrow width) we keep the vaul drawer with its drag handle. All callers use
// the same <Drawer>/<DrawerContent>/<DrawerTitle> API, so switching here flips
// every "app drawer" (new session, finding sheet, notepad) at once.
function useIsDesktopDrawer() {
  const query = "(min-width: 768px)"
  const [isDesktop, setIsDesktop] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  )
  React.useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setIsDesktop(mq.matches)
    onChange()
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return isDesktop
}

const DrawerDesktopContext = React.createContext(false)

// Page mode is owned by DrawerContent now, but the sheet's own body often has
// to react to it (bottom-anchoring its content, dropping a height cap). This
// carries the state down instead of making every caller re-derive it.
const DrawerPagedContext = React.createContext(false)

/** True while the surrounding drawer wears `.lfg-sheet-page`. */
function useDrawerPaged() {
  return React.useContext(DrawerPagedContext)
}

function Drawer({
  // vaul-only props that base-ui's Dialog root doesn't understand — pull them
  // off so they don't leak onto the dialog path.
  repositionInputs: _repositionInputs,
  shouldScaleBackground: _shouldScaleBackground,
  snapPoints: _snapPoints,
  fadeFromIndex: _fadeFromIndex,
  direction: _direction,
  handleOnly: _handleOnly,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  const isDesktop = useIsDesktopDrawer()

  if (isDesktop) {
    const { open, defaultOpen, onOpenChange, modal, children } = props
    return (
      <DrawerDesktopContext.Provider value={true}>
        <Dialog
          open={open}
          defaultOpen={defaultOpen}
          onOpenChange={onOpenChange}
          modal={modal}
        >
          {children}
        </Dialog>
      </DrawerDesktopContext.Provider>
    )
  }

  return (
    <DrawerDesktopContext.Provider value={false}>
      <DrawerPrimitive.Root data-slot="drawer" {...props} />
    </DrawerDesktopContext.Provider>
  )
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  const isDesktop = React.useContext(DrawerDesktopContext)
  if (isDesktop) return <DialogTrigger data-slot="drawer-trigger" {...props} />
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  const isDesktop = React.useContext(DrawerDesktopContext)
  if (isDesktop) return <DialogClose data-slot="drawer-close" {...props} />
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-[70] bg-black/80 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  overlayClassName,
  children,
  expandOnFocus = true,
  page = false,
  bleed = false,
  onPointerDownCapture,
  onFocusCapture,
  onBlurCapture,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & {
  overlayClassName?: string
  /** Opt out of the focus-driven drawer → page morph. On by default: a
   *  content-sized bottom sheet always loses to the mobile soft keyboard, so
   *  every sheet with a field in it wants this. See lib/expand-on-focus.ts. */
  expandOnFocus?: boolean
  /** Force page mode regardless of focus, for callers that drive it. */
  page?: boolean
  /**
   * In page mode, go edge to edge instead of staying a card.
   *
   * Page mode only ever changed the HEIGHT: the content is still a rounded
   * panel inset 8px on every side with its own padding and a drag handle, so a
   * form that fills the screen still reads as a sheet resting on top of one.
   * For a surface that IS the screen for as long as it is open — creating a
   * bot — the card edge is a frame around nothing.
   *
   * Phone only. Above 768px `.lfg-sheet-page` is a centred 85dvh dialog and the
   * card edge is exactly what makes it one.
   */
  bleed?: boolean
}) {
  const isDesktop = React.useContext(DrawerDesktopContext)
  // Desktop is a centered dialog with its own height cap and no soft keyboard,
  // so the morph is a no-op there; skip the listeners entirely.
  const morph = useExpandOnFocus(expandOnFocus && !isDesktop)
  const paged = page || morph.paged

  if (isDesktop) {
    return (
      <DrawerPagedContext.Provider value={false}>
      <DialogContent
        data-slot="drawer-content"
        showCloseButton={false}
        overlayClassName={overlayClassName}
        // Cap height so tall content scrolls inside the dialog instead of
        // overflowing the viewport; callers already carry their own inner
        // scroll containers.
        className={cn("max-h-[85dvh] overflow-hidden", className)}
        // h-full rather than a second max-height: the wrapper fills the popup
        // instead of growing past it, so the caller's height class stays
        // authoritative and footers can't be pushed out of reach.
        innerClassName="flex h-full min-h-0 flex-col overflow-hidden p-4"
        {...(props as React.ComponentProps<typeof DialogContent>)}
      >
        {children}
      </DialogContent>
      </DrawerPagedContext.Provider>
    )
  }

  return (
    <DrawerPagedContext.Provider value={paged}>
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay className={overlayClassName} />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        data-paged={paged ? "true" : "false"}
        className={cn(
          "group/drawer-content fixed z-[70] flex h-auto flex-col bg-transparent p-4 text-sm before:absolute before:inset-2 before:-z-10 before:rounded-4xl before:border before:border-border before:bg-background data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[80vh] data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=left]:sm:max-w-sm data-[vaul-drawer-direction=right]:sm:max-w-sm",
          paged && "lfg-sheet-page",
          paged &&
            bleed &&
            "max-md:p-0 max-md:before:inset-0 max-md:before:rounded-none max-md:before:border-0",
          className
        )}
        // All three handlers, always: a missing one breaks fold-back. Caller
        // handlers still run — they are chained, not replaced.
        onPointerDownCapture={(e) => {
          morph.onPointerDownCapture()
          onPointerDownCapture?.(e)
        }}
        onFocusCapture={(e) => {
          morph.onFocusCapture(e)
          onFocusCapture?.(e)
        }}
        onBlurCapture={(e) => {
          morph.onBlurCapture(e)
          onBlurCapture?.(e)
        }}
        {...props}
      >
        {/* The handle says "drag me down"; a full-screen surface has no
            in-between position to drag to, and on desktop this drawer is a
            dialog. Keep it everywhere else — it is the affordance that makes a
            card dismissable without hunting for a close button. */}
        <div
          className={cn(
            "mx-auto mt-4 hidden h-1.5 w-[100px] shrink-0 rounded-full bg-muted group-data-[vaul-drawer-direction=bottom]/drawer-content:block",
            paged && bleed && "max-md:!hidden",
          )}
        />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
    </DrawerPagedContext.Provider>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-left",
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  const isDesktop = React.useContext(DrawerDesktopContext)
  if (isDesktop) {
    return (
      <DialogTitle
        data-slot="drawer-title"
        className={cn(
          "font-heading text-base font-medium text-foreground",
          className
        )}
        {...(props as React.ComponentProps<typeof DialogTitle>)}
      />
    )
  }
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  const isDesktop = React.useContext(DrawerDesktopContext)
  if (isDesktop) {
    return (
      <DialogDescription
        data-slot="drawer-description"
        className={cn("text-sm text-muted-foreground", className)}
        {...(props as React.ComponentProps<typeof DialogDescription>)}
      />
    )
  }
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  useDrawerPaged,
}
