import type { ReceiverState } from "./linked-devices";

export function deviceNotificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Use the existing app worker and its notification-click route. No cloud push enrolment. */
export class DeviceNotifications {
  private seen = new Map<string, string>();
  private native = new Map<string, Notification>();
  private latest: ReceiverState | null = null;
  private chain = Promise.resolve();
  private disposed = false;

  update(state: ReceiverState | null) {
    this.latest = state;
    this.chain = this.chain.then(() => this.sync()).catch(() => {});
    return this.chain;
  }

  dispose() {
    this.disposed = true;
    // Worker notices belong to this origin, which may have other tabs open.
    for (const notice of this.native.values()) notice.close();
    this.native.clear();
    return this.chain;
  }

  private async sync() {
    if (this.disposed) return;
    const state = this.latest;
    const requests = new Map((state?.requests ?? []).map((r) => [r.id, r.status]));
    if (state?.pending && state.pending.expiresAt > Date.now()) requests.set(state.pending.request.id, "waiting-approval");
    const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
    const notices = await registration?.getNotifications().catch(() => []);
    if (this.disposed || state !== this.latest) return;
    for (const [id] of this.seen) {
      if (requests.has(id) && requests.get(id) !== "running") continue;
      this.native.get(id)?.close(); this.native.delete(id); this.seen.delete(id);
    }
    for (const notice of notices ?? []) {
      if (notice.tag.startsWith("omg-device-") && (!requests.has(notice.tag.slice(11)) || requests.get(notice.tag.slice(11)) === "running")) notice.close();
    }
    if (this.disposed || deviceNotificationPermission() !== "granted") return;
    for (const [id, status] of requests) {
      if (status === "running") continue;
      const phase = status === "waiting-approval" ? "approval" : "request";
      if (this.seen.get(id) === phase || (this.seen.has(id) && phase === "request")) continue;
      const options: NotificationOptions = {
        body: phase === "approval" ? "Review this request on this computer. No answer means deny." : "Open Linked devices to review incoming activity and access.",
        tag: `omg-device-${id}`, data: { url: "/devices?receive=1" },
      };
      const title = phase === "approval" ? "Device request needs approval" : "Incoming device request";
      if (registration?.active) await registration.showNotification(title, options);
      else {
        this.native.get(id)?.close();
        const notice = new Notification(title, options);
        notice.onclick = () => { window.focus(); window.location.assign("/devices?receive=1"); notice.close(); };
        this.native.set(id, notice);
      }
      this.seen.set(id, phase);
    }
  }
}
