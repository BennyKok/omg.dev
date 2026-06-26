import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <div className="size-4 animate-pulse rounded-full bg-current/20" />
        ),
      }}
      offset={{
        bottom: "var(--lfg-above-orb)",
        top: "calc(env(safe-area-inset-top) + 1rem)",
      }}
      mobileOffset={{
        bottom: "var(--lfg-above-orb)",
        top: "calc(env(safe-area-inset-top) + 0.75rem)",
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-xl)",
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !rounded-2xl !bg-popover !text-popover-foreground !border-border font-sans",
          description: "hidden",
          success:
            "!bg-popover !text-success !border-success/30",
          error:
            "!bg-popover !text-destructive !border-destructive/30",
          actionButton:
            "!h-8 !w-8 !min-w-8 !rounded-full !p-0 !flex !items-center !justify-center !gap-0 !text-[0] [&>svg]:!h-4 [&>svg]:!w-4 [&>*:not(svg)]:!hidden",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
