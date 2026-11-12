import { useEffect, useRef, useState } from "react";
import { useDeviceReceiver } from "../lib/device-receiver";
import { DeviceNotifications, deviceNotificationPermission } from "../lib/device-notifications";

/** Mounted once in the app shell, so changing pages never hides incoming work. */
export function DeviceReceiverMonitor({ onOpen, showIndicator = true }: { onOpen: () => void; showIndicator?: boolean }) {
  const { state } = useDeviceReceiver();
  const notices = useRef<DeviceNotifications | null>(null);
  useEffect(() => {
    const owner = new DeviceNotifications();
    notices.current = owner;
    return () => { void owner.dispose(); notices.current = null; };
  }, []);
  useEffect(() => { void notices.current?.update(state); }, [state]);
  const count = state?.requests?.length ?? (state?.pending ? 1 : 0);
  if (!showIndicator || !state || (!count && !state.active)) return null;
  return <aside aria-label="Incoming device activity" className="fixed bottom-24 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background p-3 shadow-lg md:bottom-4">
    <p role="status" className="text-sm font-medium">{state.pending ? "Device request needs approval" : `${count} incoming request${count === 1 ? "" : "s"} · Access ${state.active ? "active" : "stopped"}`}</p>
    <button type="button" onClick={onOpen} className="mt-1 text-sm underline underline-offset-4">View incoming requests</button>
  </aside>;
}

export function DeviceNotificationSettings() {
  const [permission, setPermission] = useState(deviceNotificationPermission);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setPermission(deviceNotificationPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  return <div className="space-y-2 px-4 py-3 text-sm">
    <p>{permission === "granted" ? "Browser notifications are allowed" : permission === "denied" ? "Notifications are blocked. Allow them in this browser’s site settings." : permission === "unsupported" ? "This browser does not support notifications." : "Enable notifications on this computer"}</p>
    <p className="text-xs text-muted-foreground">Keep this computer’s local omg.dev UI open. Notifications work on other pages and in background tabs. A closed or suspended browser cannot show new requests. System notification settings can also silence alerts.</p>
    {permission === "default" && <button type="button" className="rounded-lg border border-border px-3 py-2" onClick={async () => {
      try { setError(null); setPermission(await Notification.requestPermission()); }
      catch { setError("Cannot enable notifications. Check this browser’s site settings."); }
    }}>Enable device notifications</button>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
