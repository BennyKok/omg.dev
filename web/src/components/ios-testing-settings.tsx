import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Smartphone } from "lucide-react";
import { Button } from "./ui/button";

type Device = { udid: string; name: string };
export type IosTestingStatus = {
  supported: boolean;
  busy: boolean;
  connection: { appleId: string; teamId: string; teamName: string } | null;
  devices: Device[];
  profile: { uuid: string; expiresAt: number; deviceIds: string[] } | null;
  phase: "idle" | "signing-in" | "preparing" | "ready" | "error";
  error: string | null;
  access?: { signedIn: boolean; email: string | null };
  pendingExport?: { appId: string } | null;
  uploaded?: { appId: string; revision: number; expiresAt: number } | null;
};

export function IosTestingSettingsSection() {
  const [status, setStatus] = useState<IosTestingStatus | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appId, setAppId] = useState("");
  const [apps, setApps] = useState<Array<{ appId: string; name: string; bundleId: string | null }> | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/ios-testing", { credentials: "same-origin", signal });
    if (response.ok) setStatus(await response.json());
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!status?.access?.signedIn) return;
    const controller = new AbortController();
    void fetch("/api/ios-testing/apps", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((value) => setApps(value.apps)).catch(() => {});
    return () => controller.abort();
  }, [status?.access?.signedIn]);
  useEffect(() => {
    if (!status?.supported) return;
    // A native Terminal worker writes the safe local status projection.
    // Poll only while this Settings section is mounted and visible.
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh(controller.signal).catch(() => {});
    }, 2500);
    const onFocus = () => void refresh(controller.signal).catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [status?.supported, refresh]);

  if (!status?.supported) return null;
  const unavailable = working || status.busy;
  const profileReady = status.profile && status.profile.expiresAt > Date.now();
  async function act(path: string, body: unknown = {}) {
    setWorking(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/ios-testing/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "This step could not finish. Try again.");
      if (path === "devices") setDevices(result.devices);
      if (path === "login" || path === "prepare") setNotice("Continue in the Terminal window on this Mac.");
      if (path === "cloud/login") { window.location.assign(result.authorizeUrl); return; }
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "This step could not finish. Try again."); }
    finally { setWorking(false); }
  }

  return <section className="space-y-2" aria-labelledby="ios-testing-heading">
    <h2 id="ios-testing-heading" className="px-4 text-xs font-semibold text-muted-foreground">iOS testing</h2>
    <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">1. Apple Developer account</h3>
            <p className="mt-1 text-xs text-muted-foreground">{status.connection ? `${status.connection.teamName} · ${status.connection.appleId}` : "Connect your paid Apple Developer account on this Mac."}</p>
          </div>
          {status.connection && <Check className="size-4 text-success" aria-label="Apple account connected" />}
        </div>
        <p className="text-xs text-muted-foreground">Sign in through a local Terminal window. Your password goes directly to Apple.</p>
        <Button variant="outline" size="sm" disabled={unavailable} onClick={() => void act("login")}>{status.connection ? "Reconnect Apple" : "Connect Apple"}</Button>
      </div>
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">2. Your iPhone</h3>
            <p className="mt-1 text-xs text-muted-foreground">Connect your iPhone to this Mac with a cable.</p>
            {status.devices.map((device) => <p key={device.udid} className="mt-1 text-xs">{device.name} · {device.udid.slice(-8)}</p>)}
          </div>
          {status.devices.length > 0 && <Check className="size-4 text-success" aria-label="iPhone selected" />}
        </div>
        <Button variant="outline" size="sm" disabled={unavailable} onClick={() => void act("devices")}>Find iPhone</Button>
        {devices?.length === 0 && <p role="status" className="text-xs text-muted-foreground">No iPhone is connected. Connect the cable and try again.</p>}
        {devices && devices.length > 0 && <div className="flex flex-wrap gap-2">{devices.map((device) => <Button key={device.udid} variant="outline" size="sm" disabled={unavailable} onClick={() => void act("select-devices", { deviceIds: [...new Set([...status.devices.map((current) => current.udid), device.udid])].filter((id) => devices.some((connected) => connected.udid === id)) })}>Use {device.name} · {device.udid.slice(-8)}</Button>)}</div>}
      </div>
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">3. Testing profile</h3>
            <p className="mt-1 text-xs text-muted-foreground">{profileReady ? `Saved on this Mac. Expires ${new Date(status.profile!.expiresAt).toLocaleDateString()}.` : "Create a profile for the iPhones you selected."}</p>
          </div>
          {profileReady && <Check className="size-4 text-success" aria-label="Local testing profile ready" />}
        </div>
        <Button size="sm" disabled={unavailable || !status.connection || status.devices.length === 0} onClick={() => void act("prepare")}>{status.phase === "preparing" && status.busy ? "Preparing profile…" : profileReady ? "Update testing profile" : "Create testing profile"}</Button>
      </div>
      <div className="space-y-3 px-4 py-4">
        <div>
          <h3 className="text-sm font-medium">4. Save for app builds</h3>
          <p className="mt-1 text-xs text-muted-foreground">Allow omg to register your selected iPhones and save the signing key and profile for your app.</p>
          {status.uploaded && <p role="status" className="mt-2 text-xs text-success">Saved for {apps?.find((app) => app.appId === status.uploaded!.appId)?.name ?? "your app"}.</p>}
        </div>
        {!status.access?.signedIn ? <Button variant="outline" size="sm" disabled={unavailable} onClick={() => void act("cloud/login", { returnTo: window.location.pathname })}>Allow iOS signing access</Button> : <>
          <label htmlFor="ios-testing-app" className="block text-xs font-medium">App to test</label>
          <select id="ios-testing-app" value={status.pendingExport?.appId ?? appId} onChange={(event) => setAppId(event.target.value)} disabled={unavailable || !!status.pendingExport || !apps} className="h-9 w-full rounded-lg border border-input bg-input/30 px-3 text-sm">
            <option value="">Select your app</option>
            {apps?.map((app) => <option key={app.appId} value={app.appId}>{app.name}</option>)}
          </select>
          {apps?.length === 0 && <p className="text-xs text-muted-foreground">Build an app in omg to add it here.</p>}
          <Button size="sm" disabled={unavailable || !profileReady || !(status.pendingExport?.appId || appId.trim())} onClick={() => void act("upload", { appId: status.pendingExport?.appId ?? appId.trim() })}>{status.pendingExport ? "Retry prepared upload" : "Save for builds"}</Button>
          {status.pendingExport && <Button variant="outline" size="sm" disabled={unavailable} onClick={() => void act("upload", { appId: status.pendingExport!.appId, prepareNew: true })}>Review and prepare new upload</Button>}
        </>}
      </div>
    </div>
    {(error || status.error) && <p role="alert" className="px-4 text-xs text-destructive">{error ?? status.error}</p>}
    {notice && <p role="status" className="px-4 text-xs text-muted-foreground">{notice}</p>}
  </section>;
}
