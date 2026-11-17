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
    // Not requests, but notices the person must act on: an agent asks for more
    // time, or access stops within ten minutes. A new end gives a new key, so
    // Extend closes the old notice.
    if (state?.extension && state.extension.expiresAt > Date.now()) requests.set(state.extension.id, "extension");
    const ending = state?.active ? endingNotice(state) : null;
    if (ending) requests.set(ending.key, ending.status);
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
      const phase = status === "waiting-approval" ? "approval" : status === "extension" || status.startsWith("ending") ? status : "request";
      if (this.seen.get(id) === phase || (this.seen.has(id) && phase === "request")) continue;
      const notice = noticeText(phase, state);
      const options: NotificationOptions = { body: notice.body, tag: `omg-device-${id}`, data: { url: "/devices?receive=1" } };
      const title = notice.title;
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

const ENDING_NOTICE_MS = 10 * 60_000;

/** The notice for access that stops within ten minutes, by its hard end or its idle stop. */
export function endingNotice(state: ReceiverState, now = Date.now()): { key: string; status: string } | null {
  const grant = state.grant;
  const endsAt = grant?.endsAt ?? state.endsAt;
  if (!endsAt) return null;
  const idleAt = grant?.idleEndsAt ?? null;
  if (idleAt !== null && idleAt < endsAt && idleAt - now <= ENDING_NOTICE_MS && idleAt > now) return { key: `idle-${idleAt}`, status: "ending-idle" };
  if (endsAt - now <= ENDING_NOTICE_MS && endsAt > now) return { key: `end-${endsAt}`, status: "ending" };
  return null;
}

function noticeText(phase: string, state: ReceiverState | null): { title: string; body: string } {
  const minutesTo = (at: number | null | undefined) => Math.max(1, Math.ceil(((at ?? Date.now()) - Date.now()) / 60_000));
  if (phase === "approval") return { title: "Device request needs approval", body: "Review this request on this computer. No answer means deny." };
  if (phase === "extension") {
    const m = state?.extension?.minutes ?? 0;
    const length = m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`;
    return { title: `An agent asks to extend access by ${length}`, body: "Allow or deny it in Agent access on this computer. No answer means no." };
  }
  if (phase === "ending") return { title: `Access ends in ${minutesTo(state?.grant?.endsAt ?? state?.endsAt)} min`, body: "Open Agent access to extend it." };
  if (phase === "ending-idle") return { title: `Access stops in ${minutesTo(state?.grant?.idleEndsAt)} min if idle`, body: "Open Agent access to extend it or change the idle stop." };
  return { title: "Incoming device request", body: "Open Agent access to review incoming activity and access." };
}
