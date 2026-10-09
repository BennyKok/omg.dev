"use client"

import * as React from "react"
import {
  Sheet,
  SheetBackdrop,
  SheetContent,
  SheetOverlay,
  type SheetOverlayProps,
} from "react-aria-components/Sheet"
import { Heading } from "react-aria-components/Heading"
import { Text } from "react-aria-components/Text"

import { cn } from "@/lib/utils"
import { useExpandOnFocus } from "@/lib/expand-on-focus"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

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

type DrawerProps = {
  children: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  direction?: SheetOverlayProps["position"]
  snapPoints?: SheetOverlayProps["snapPoints"]
  dismissible?: boolean
  /** Responsive drawers become centered dialogs on desktop. */
  presentation?: "responsive" | "sheet"
  /** The entire portal shares this layer, including its gesture scroll area. */
  layer?: number
}

const DrawerContext = React.createContext<{
  desktop: boolean
  open: boolean
  setOpen: (open: boolean) => void
  direction: SheetOverlayProps["position"]
  snapPoints?: SheetOverlayProps["snapPoints"]
  dismissible: boolean
  layer: number
} | null>(null)
const DrawerPagedContext = React.createContext(false)

function useDrawer() {
  const context = React.useContext(DrawerContext)
  if (!context) throw new Error("Drawer parts must be inside a Drawer")
  return context
}

/** True while the surrounding drawer is a full-height page. */
function useDrawerPaged() {
  return React.useContext(DrawerPagedContext)
}

function Drawer({
  children, open, defaultOpen = false, onOpenChange, direction = "bottom",
  snapPoints, dismissible = true, presentation = "responsive", layer = 70,
}: DrawerProps) {
  const isDesktop = useIsDesktopDrawer()
  const desktop = presentation === "responsive" && direction === "bottom" && isDesktop
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isOpen = open ?? uncontrolledOpen
  const setOpen = React.useCallback((next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }, [open, onOpenChange])

  return (
    <DrawerContext.Provider value={{ desktop, open: isOpen, setOpen, direction, snapPoints, dismissible, layer }}>
      {desktop ? <Dialog open={isOpen} onOpenChange={setOpen}>{children}</Dialog> : children}
    </DrawerContext.Provider>
  )
}

function DrawerTrigger({ onClick, ...props }: React.ComponentProps<"button">) {
  const drawer = useDrawer()
  return <button type="button" data-slot="drawer-trigger" aria-haspopup="dialog" aria-expanded={drawer.open}
    {...props} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) drawer.setOpen(true) }} />
}

function DrawerClose({ onClick, ...props }: React.ComponentProps<"button">) {
  const drawer = useDrawer()
  return <button type="button" data-slot="drawer-close" {...props}
    onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) drawer.setOpen(false) }} />
}

type DrawerContentProps = Omit<React.ComponentProps<"section">, "role" | "ref"> & {
  role?: "dialog" | "alertdialog"
  ref?: React.Ref<HTMLDivElement>
  overlayClassName?: string
  expandOnFocus?: boolean
  page?: boolean
  /** Custom drawer flows keep their own surface and handle. */
  unstyled?: boolean
}

function DrawerContent({
  className, overlayClassName, children, expandOnFocus = true, page = false,
  unstyled = false, onPointerDownCapture, onFocusCapture, onBlurCapture, onKeyDown,
  style, ref, ...props
}: DrawerContentProps) {
  const drawer = useDrawer()
  const morph = useExpandOnFocus(expandOnFocus && !drawer.desktop && drawer.direction === "bottom")
  const paged = page || morph.paged

  if (drawer.desktop) {
    return (
      <DrawerPagedContext.Provider value={false}>
        <DialogContent data-slot="drawer-content" showCloseButton={false}
          overlayClassName={overlayClassName}
          className={cn("max-h-[85dvh] overflow-hidden", className)}
          innerClassName="flex h-full min-h-0 flex-col overflow-hidden p-4"
          style={style} onKeyDown={onKeyDown} {...props}>
          {children}
        </DialogContent>
      </DrawerPagedContext.Provider>
    )
  }

  return (
    <DrawerPagedContext.Provider value={paged}>
      <SheetOverlay isOpen={drawer.open} onOpenChange={drawer.setOpen}
        position={drawer.direction} snapPoints={drawer.snapPoints}
        preventDismissal={!drawer.dismissible}
        className="lfg-sheet-overlay" style={{ zIndex: drawer.layer }}
        // Base UI controls and dialogs also portal to body. Let that library
        // own interactions in its portals rather than dismiss the parent sheet.
        // Their data-react-aria-top-layer marker also preserves focus and
        // accessibility across the two overlay libraries.
        shouldCloseOnInteractOutside={(element) => !element.closest("[data-base-ui-portal]")}>
        <SheetBackdrop data-slot="drawer-overlay" swipeAnimation="lfg-sheet-backdrop"
          className={cn("bg-black/80", overlayClassName)} />
        <Sheet ref={ref} data-slot="drawer-content" data-paged={paged ? "true" : "false"}
          className={cn("lfg-aria-sheet group/drawer-content data-[position=bottom]:w-full data-[position=top]:w-full",
            !unstyled && "flex h-auto w-full flex-col bg-transparent p-4 text-sm before:absolute before:inset-2 before:-z-10 before:rounded-4xl before:border before:border-border before:bg-background data-[position=bottom]:max-h-[80dvh] data-[position=top]:max-h-[80dvh] data-[position=left]:h-full data-[position=left]:w-3/4 data-[position=right]:h-full data-[position=right]:w-3/4",
            paged && "lfg-sheet-page", className)} style={style}>
          <SheetContent {...props} className="lfg-sheet-dialog flex min-h-0 flex-col outline-none"
            render={(domProps) => <section {...domProps}
              onPointerDownCapture={(event) => { morph.onPointerDownCapture(); onPointerDownCapture?.(event) }}
              onFocusCapture={(event) => { morph.onFocusCapture(event); onFocusCapture?.(event) }}
              onBlurCapture={(event) => { morph.onBlurCapture(event); onBlurCapture?.(event) }}
              onKeyDown={(event) => {
                domProps.onKeyDown?.(event)
                onKeyDown?.(event)
                // Escape bubbles to React Aria's modal dismissal handler.
                if (event.key !== "Escape") event.stopPropagation()
              }} /> }>
            {!unstyled && <div aria-hidden="true" className="mx-auto mt-4 hidden h-1.5 w-[100px] shrink-0 rounded-full bg-muted group-data-[position=bottom]/drawer-content:block" />}
            {children}
          </SheetContent>
        </Sheet>
      </SheetOverlay>
    </DrawerPagedContext.Provider>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="drawer-header" className={cn("flex flex-col gap-0.5 p-4 group-data-[position=bottom]/drawer-content:text-center group-data-[position=top]/drawer-content:text-center md:gap-1.5 md:text-left", className)} {...props} />
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="drawer-footer" className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />
}

function DrawerTitle({ className, ...props }: React.ComponentProps<"h2">) {
  const { desktop } = useDrawer()
  const classes = cn("font-heading text-base font-medium text-foreground", className)
  return desktop
    ? <DialogTitle data-slot="drawer-title" className={classes} {...props} />
    : <Heading slot="title" data-slot="drawer-title" className={classes} {...props} />
}

function DrawerDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { desktop } = useDrawer()
  const classes = cn("text-sm text-muted-foreground", className)
  return desktop
    ? <DialogDescription data-slot="drawer-description" className={classes} {...props} />
    : <Text slot="description" elementType="p" data-slot="drawer-description" className={classes} {...props} />
}

export { Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription, useDrawerPaged }
