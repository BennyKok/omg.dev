import { type ReactNode } from "react";
import { useAsk } from "./ask-center";
import { MorphText } from "./ui/morph-text";
import { cn } from "../lib/utils";
import { haptic } from "../lib/haptics";

// Mobile Live uses the otherwise-empty span between the account controls and
// the screen edge as a small contextual surface. It begins as the familiar LFG
// mark, then expands into a personal status line. The welcome is the resting
// state; activity only interrupts it while work is genuinely in motion.
// Questions take precedence, but keep the same quiet plain-text treatment.
// Connection state is NOT shown here. The greeting used to turn into
// "Reconnecting…"; the ConnectionOverlay now owns saying that, once, for the
// whole app (Benny, 2026-10-07).
export function LiveHeaderContext({
  intro: requestedIntro,
  brand,
  viewerName,
  user,
  identity,
  busyCount,
  onOpenNotifications,
  folderName = null,
  onOpenFolders,
}: {
  intro: boolean;
  brand: ReactNode;
  viewerName?: string;
  user?: { name?: string };
  identity?: string | null;
  busyCount: number;
  onOpenNotifications: () => void;
  /** The folder the phone list is in. It replaces the welcome while set. */
  folderName?: string | null;
  /** Open Folders, to change or leave the folder. */
  onOpenFolders?: () => void;
}) {
  const { questions } = useAsk();
  const intro = requestedIntro;
  // Hosted identity is presentation-only and intentionally wins over the LFG
  // roster. omg Computers have no roster by design, so deriving this welcome
  // from session ownership would either say "Unassigned" or reintroduce the
  // rejected-user bug that roster-less hosted instances were built to avoid.
  // When nothing identifies the viewer at all — a roster-less host that passes
  // no viewer, or omg's signed-out preview — there is no name to greet, so the
  // greeting drops the name entirely. It must NOT fall through to shortUser()'s
  // "unassigned": that is a roster FILTER label ("show unowned sessions"),
  // never a person, and it rendered as "Welcome, Unassigned" in the preview.
  const rawName = viewerName?.trim() || user?.name?.trim() || (identity ? identity.split("@")[0] : "");
  const firstNamePart = rawName.split(/\s+/)[0] ?? "";
  const firstName = firstNamePart
    ? `${firstNamePart.charAt(0).toUpperCase()}${firstNamePart.slice(1)}`
    : "";
  const questionCount = questions.length;
  const showCard = intro;
  // The title names the page: the folder in view, or "Chats". It used to
  // rotate between a welcome, the folder and a count of working agents, so
  // the one fixed point of the header kept changing under the reader. The
  // working agents are already marked in the list below it.
  const pageTitle = folderName || "Chats";
  const headline = questionCount
    ? questionCount === 1
      ? firstName
        ? `${firstName}, an agent needs you`
        : "An agent needs you"
      : firstName
        ? `${firstName}, ${questionCount} agents need you`
        : `${questionCount} agents need you`
    : pageTitle;
  // A question still opens the Inbox. Otherwise, inside a folder, the title is
  // the way to the menu, where the folders are.
  const opensFolders = !!folderName && !questionCount && !!onOpenFolders;

  return (
    <div className="min-w-0 flex-1 overflow-hidden">
      <button
        type="button"
        onClick={() => {
          haptic("selection");
          if (opensFolders) onOpenFolders?.();
          else onOpenNotifications();
        }}
        aria-label={
          intro
            ? "omg.dev"
            : opensFolders
              ? `Folder: ${folderName}. Tap to change folder`
              : questionCount
                ? `${headline}. Tap to open notifications`
                : busyCount
                  ? `${pageTitle}. ${busyCount} agent${busyCount === 1 ? "" : "s"} working`
                  : pageTitle
        }
        title={intro ? "omg.dev" : opensFolders ? "Change folder" : "Open notifications"}
        className={cn(
          "relative flex h-11 items-center overflow-hidden rounded-full text-left transition-colors active:scale-[0.98]",
          intro ? "w-11" : "w-full",
          showCard && "glass-island",
          "text-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-300 ease-ios",
            intro ? "scale-100 opacity-100" : "scale-75 opacity-0",
          )}
        >
          {brand}
        </span>
        <span
          aria-live={questionCount ? "polite" : "off"}
          className={cn(
            "flex min-w-0 items-center px-1 transition-[opacity,transform] duration-300 ease-ios",
            intro ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100 delay-150",
          )}
        >
          <span className="min-w-0 leading-none">
            <MorphText
              className={cn(
                "block max-w-full truncate tracking-[-0.01em]",
                questionCount ? "text-[14px] font-semibold" : "text-[17px] font-semibold",
              )}
            >
              {headline}
            </MorphText>
          </span>
        </span>
      </button>
    </div>
  );
}
