import { useEffect, useState, type ReactNode } from "react";
import { useRuntimeAvailability, runtimeStatusText } from "../lib/runtime-availability";
import { useAsk } from "./ask-center";
import { MorphText } from "./ui/morph-text";
import { cn } from "../lib/utils";
import { haptic } from "../lib/haptics";

// Mobile Live uses the otherwise-empty span between the account controls and
// the screen edge as a small contextual surface. It begins as the familiar LFG
// mark, then expands into a personal status line. The welcome is the resting
// state; activity only interrupts it while work is genuinely in motion.
// Questions take precedence, but keep the same quiet plain-text treatment.
export function LiveHeaderContext({
  intro: requestedIntro,
  brand,
  viewerName,
  user,
  identity,
  busyCount,
  onOpenNotifications,
}: {
  intro: boolean;
  brand: ReactNode;
  viewerName?: string;
  user?: { name?: string };
  identity?: string | null;
  busyCount: number;
  onOpenNotifications: () => void;
}) {
  const { questions } = useAsk();
  const availability = useRuntimeAvailability();
  const { loading, retry } = availability;
  const connectionText = runtimeStatusText(availability);
  const intro = requestedIntro && !connectionText;
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
  const actionInMotion = busyCount > 0;
  const [showAmbientStatus, setShowAmbientStatus] = useState(false);
  const ambientContext = `${busyCount} agent${busyCount === 1 ? "" : "s"} building`;
  const welcomeMessage = firstName ? `Welcome, ${firstName}` : "Welcome";
  const headline = connectionText ?? (questionCount
    ? questionCount === 1
      ? firstName
        ? `${firstName}, an agent needs you`
        : "An agent needs you"
      : firstName
        ? `${firstName}, ${questionCount} agents need you`
        : `${questionCount} agents need you`
    : actionInMotion && showAmbientStatus
      ? ambientContext
      : welcomeMessage);

  useEffect(() => {
    if (connectionText || intro || questionCount || !actionInMotion) {
      setShowAmbientStatus(false);
      return;
    }

    // Let the personal welcome breathe. Activity gets a shorter cameo, then
    // yields back to the welcome instead of competing with it equally. The
    // swap itself is a letter morph (MorphText), so there is no exit/enter
    // choreography to run here: flipping the text is the whole transition.
    const dwellMs = showAmbientStatus ? 2800 : 8000;
    const dwellTimer = window.setTimeout(() => {
      setShowAmbientStatus((current) => !current);
    }, dwellMs);

    return () => window.clearTimeout(dwellTimer);
  }, [actionInMotion, connectionText, intro, questionCount, showAmbientStatus]);

  return (
    <div className="min-w-0 flex-1 overflow-hidden">
      <button
        type="button"
        onClick={() => {
          haptic("selection");
          if (connectionText) {
            if (!loading) retry();
          } else {
            onOpenNotifications();
          }
        }}
        aria-label={
          connectionText
            ? `${connectionText}${loading ? "" : " Tap to retry"}`
            : intro
            ? "omg.dev"
            : questionCount
              ? `${headline}. Tap to open notifications`
              : actionInMotion
                ? `${welcomeMessage}. ${ambientContext}`
                : welcomeMessage
        }
        title={connectionText ? loading ? connectionText : "Retry connection" : intro ? "omg.dev" : "Open notifications"}
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
            "absolute inset-0 flex items-center justify-center transition-all duration-300 ease-ios",
            intro ? "scale-100 opacity-100" : "scale-75 opacity-0",
          )}
        >
          {brand}
        </span>
        <span
          aria-live={connectionText || questionCount ? "polite" : "off"}
          className={cn(
            "flex min-w-0 items-center px-1 transition-all duration-300 ease-ios",
            intro ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100 delay-150",
          )}
        >
          <span className="min-w-0 leading-none">
            <MorphText
              shimmer={!connectionText && !questionCount && actionInMotion && showAmbientStatus}
              className={cn(
                "block max-w-full truncate tracking-[-0.01em] transition-[font-size] duration-300 ease-ios",
                connectionText
                  ? "text-[14px] font-medium text-muted-foreground"
                  : questionCount
                  ? "text-[14px] font-semibold"
                  : actionInMotion && showAmbientStatus
                    ? "text-[12px] font-medium"
                    : "text-[16px] font-semibold",
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

