// Share a result or a challenge link: the phone's share sheet when there is
// one (navigator.share), otherwise copy to the clipboard. Tracks `share` once
// for each success. Shows a short toast for a copy.
import { challengeUrl, type Challenge } from "../game/challenge";
import { toast } from "./toast";
import { track, type TrackEvents } from "./track";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** The page address without query or hash: the base of every share link. */
export function pageUrl(): string {
  return `${location.origin}${location.pathname}`;
}

export function challengeLink(c: Challenge): string {
  return challengeUrl(pageUrl(), c);
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no clipboard permission: a hidden text area and execCommand.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export async function share(
  { text, url, title }: { text: string; url: string; title?: string },
  kind: TrackEvents["share"]["kind"],
): Promise<ShareOutcome> {
  const data = { title, text, url };
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      track("share", { kind, method: "share" });
      return "shared";
    } catch (e) {
      // The player closed the share sheet: not an error, and nothing to copy.
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  if (await copy(`${text}\n${url}`)) {
    track("share", { kind, method: "copy" });
    toast(kind === "result" ? "Result copied. Paste it anywhere." : "Link copied. Send it to a friend.");
    return "copied";
  }
  toast("Could not share on this device.");
  return "failed";
}
