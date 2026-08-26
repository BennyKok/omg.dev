// Embed-only first-run gate.
//
// A framed LFG hides onboarding and settings (the host owns account UX), so a
// fresh box had no surface at all for connecting a coding agent. This card is
// that surface: a 2-question survey leads, then page one renders the
// browser-loginable agents, page two connects the tools those agents act
// through, and every click hands straight back to App's existing auth/setup
// handlers. Those drive the existing agent/connection endpoints and the same
// <CodingAgentAuthDialog> the Settings page uses. No credentials, no second
// auth path, no progress bar.
// Once opened, the card stays mounted through every page — survey included —
// so a successful agent login cannot make the tool step disappear underneath
// the user, and answering (or skipping) a survey question never remounts the
// card into a different route.
//
// The survey question data, page sequencing, and skip mechanics live in
// ../lib/onboarding-survey.ts — kept framework-free so it is testable without
// React or a DOM. This file only renders it and posts answers up to the
// embedding host as `lfg:analytics` (../lib/embed-host-signal.ts).
//
// This card renders inside a cross-origin iframe (see ../lib/embed.ts) on a
// per-Computer sandbox host — never track analytics from here directly. A
// same-origin tracker loaded in this frame would run on a hostname no
// allowlist covers, and mint a second Umami visitor/session that can never
// join the host's own activation events even if it did fire. Posting the
// event up and letting the host (which already runs a same-origin tracker)
// fire it is the only approach that lands in one dataset — see the header of
// ../lib/embed-host-signal.ts for the full story.
//
// Every survey question is skippable: a forced question here is exactly the
// "dead step is worse than no step" failure the tools-page skip below already
// guards against, just for a question instead of a broken connect row.

import { useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  Clock,
  Download,
  Github,
  Laptop,
  Layers,
  Palette,
  Repeat,
  Rocket,
  Share,
  Shuffle,
  Smartphone,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./ui/button";
import { BrandIcon } from "../lib/brand-icons";
import { InstallInstructions } from "./pwa-install";
import { usePwaInstall } from "../lib/pwa-install";
import { readLocationEmbedFlag } from "../lib/embed";
import { emitAnalyticsToHost } from "../lib/embed-host-signal";
import type { ConnectOption, ToolConnectOption } from "../lib/embedded-connect";
import { OmgBrandMark } from "./omg-brand-mark";
import { agentIconAlt, agentIconSrc } from "../lib/session-ui";
import {
  buildGateFlow,
  createSurveyAnalyticsLatch,
  EMPTY_SURVEY_ANSWERS,
  IDENTITY_OPTIONS,
  isSurveyPage,
  PAIN_OPTIONS,
  SHOWCASE_AGENT_KINDS,
  stepAfter,
  stepBefore,
  SURVEY_PAGES,
  surveyCompleteEvent,
  surveyQuestionEvent,
} from "../lib/onboarding-survey";
import type {
  ConnectPageId,
  GatePage,
  SurveyAnalyticsLatch,
  SurveyAnswers,
  SurveyIdentity,
  SurveyOption,
  SurveyPain,
} from "../lib/onboarding-survey";

/**
 * The agents shown on the closing screen. Real marks, not generic glyphs —
 * the whole point of the screen is "we take the account you already have",
 * and a person recognises the Claude sunburst faster than any sentence about
 * it. Same five that lead the picker (see DISCOVERABLE_AGENT_COUNT) and the
 * survey's AI-tools question — SHOWCASE_AGENT_KINDS in onboarding-survey.ts
 * is the single owner of that list now, so this and the survey question
 * cannot silently drift apart.
 */
const SHOWCASE_AGENTS = SHOWCASE_AGENT_KINDS;

// Icon lookup for survey options that aren't a real agent or brand mark.
// Values match the `icon` string on each SurveyOption in
// onboarding-survey.ts; an "agent:<kind>" icon is resolved via
// agentIconSrc/agentIconAlt (real agent marks, same as the showcase row
// below) and a "brand:<name>" icon via BrandIcon in ../lib/brand-icons.tsx
// (real product marks, monochrome so they sit in the same tinted badge as
// everything else here — see that file's header for why).
const SURVEY_ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  palette: Palette,
  sparkles: Sparkles,
  layers: Layers,
  clock: Clock,
  smartphone: Smartphone,
  shuffle: Shuffle,
  laptop: Laptop,
};

function SurveyOptionIcon({ icon, className }: { icon: string; className: string }) {
  if (icon.startsWith("agent:")) {
    const kind = icon.slice("agent:".length);
    return <img src={agentIconSrc(kind)} alt={agentIconAlt(kind)} className={className} />;
  }
  if (icon.startsWith("brand:")) {
    return <BrandIcon name={icon.slice("brand:".length)} className={className} />;
  }
  const Icon = SURVEY_ICONS[icon];
  return Icon ? <Icon className={className} /> : null;
}

// One tap, no keyboard: every survey question — single or multi select — is
// this same grid of icon+label cards. `selected` holds 0-1 values for a
// single-select question and 0-N for multi-select; the component doesn't
// care which, it just highlights whatever's in the list.
//
// An odd option count leaves one tile alone in the last row. Stretching it
// full width used to make it read as a different kind of object than its
// siblings — on the tools question that put a wide Slack tile directly above
// the wide Continue button, and the two looked like the same control. Instead
// it stays tile-sized and centres in its row, so every option in the grid is
// visually the same weight no matter how many there are.
//
// The tile and its icon badge both carry `transition-colors duration-150
// ease-ios` on purpose — they used to desync: the tile's border/fill eased in
// over 150ms but the badge (no transition class) snapped instantly, so a
// tile selected right before a screenshot showed a fully-blue badge sitting
// on a still-fading border, reading as "badge only, no border" next to an
// earlier selection that had time to settle. Same duration on both closes
// the seam.
function SurveyOptionGrid<V extends string>({
  options,
  selected,
  onToggle,
}: {
  options: readonly SurveyOption<V>[];
  selected: readonly V[];
  onToggle: (value: V) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((option, index) => {
        const isSelected = selected.includes(option.value);
        const lastOdd = index === options.length - 1 && options.length % 2 === 1;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center text-sm font-medium transition-colors duration-150 ease-ios ${
              isSelected
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-muted/40 text-foreground hover:bg-muted"
            } ${lastOdd ? "col-span-2 mx-auto w-[calc(50%-0.25rem)]" : ""}`}
          >
            <span
              className={`flex size-9 items-center justify-center rounded-lg transition-colors duration-150 ease-ios ${
                isSelected ? "bg-primary/15 text-primary" : "bg-foreground/5 text-foreground"
              }`}
            >
              <SurveyOptionIcon icon={option.icon} className="size-5" />
            </span>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// The same quiet skip link on every survey question — visible, but
// deliberately not styled like an action. See the file header: a forced
// question is a drop-off.
function SurveySkipLink({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
    >
      Skip
    </button>
  );
}

export function EmbeddedConnectGate({
  options,
  toolConnections,
  pendingKind,
  onConnect,
  onInstall,
  onConnectTool,
  onDone,
  onAnalyticsEvent,
}: {
  options: ConnectOption[];
  toolConnections?: ToolConnectOption[];
  /** Kind with an in-flight connect/install click, if any. */
  pendingKind?: string | null;
  onConnect: (kind: string) => void;
  onInstall: (kind: string) => void;
  onConnectTool: (key: ToolConnectOption["key"]) => void;
  onDone: () => void;
  onAnalyticsEvent?: (name: string, data?: Record<string, unknown>) => void;
}) {
  const [page, setPage] = useState<GatePage>("survey-identity");
  const [surveyAnswers, setSurveyAnswers] = useState<SurveyAnswers>(EMPTY_SURVEY_ANSWERS);
  const hasConnectedAgent = options.some((option) => option.configured);
  const pwa = usePwaInstall();
  const [installBusy, setInstallBusy] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);

  // Skip the tools page when nothing on it can actually be connected.
  //
  // The GitHub row has no install path of its own — unlike the agent rows,
  // which offer one when their CLI is missing — so on a Computer without the
  // `gh` binary it renders permanently disabled, reading "GitHub CLI is not
  // installed" with no way forward. A dead step in a first run is worse than
  // no step, so the flow steps over it until the binary is there. `undefined`
  // means still loading, which is NOT the same as unavailable — that case
  // keeps the page and shows its skeleton.
  const toolsUsable = toolConnections === undefined || toolConnections.some((t) => t.installed);
  // `page === "install"` keeps the page in the flow once the user is ON it —
  // a successful install flips `pwa.installed`, and that must not delete the
  // page out from under them (same stays-mounted rule as the agent login).
  const installable = (!pwa.installed && pwa.mode !== "none") || page === "install";
  const flow = buildGateFlow(toolsUsable, installable);
  const connectPages = flow.filter((p): p is ConnectPageId => !isSurveyPage(p));
  const installIsLastPage = flow[flow.length - 1] === "install";
  const goNext = () => setPage(stepAfter(flow, page));
  const goBack = () => setPage(stepBefore(flow, page));

  // Survey handlers. Selecting fires the per-question analytics event
  // (skipped questions never do — see the file header) and advances on its
  // own; both questions here are single-select. The completion event fires
  // exactly once, right after the last question — "survey-pain" is the last
  // entry in SURVEY_PAGES — whichever way it's left (answered or skipped).
  // "Exactly once" is enforced by a latch, not by the flow: see trackComplete.
  //
  // Delivery has two owners, never this frame's own tracker (see file
  // header): a host that mounts the native OmgAppSurface library wires
  // `onAnalyticsEvent` directly (same document, no postMessage needed) and
  // wins when present. Otherwise this renders inside the cross-origin
  // `?embed=1` iframe, so the only safe channel is `lfg:analytics` up to the
  // embedding host.
  const emitAnalytics = (event: string, props?: Record<string, string | number | boolean>) => {
    if (onAnalyticsEvent) {
      onAnalyticsEvent(event, props);
      return;
    }
    emitAnalyticsToHost(event, props, readLocationEmbedFlag());
  };
  // Fire-once rules live in ../lib/onboarding-survey (createSurveyAnalyticsLatch)
  // so they are testable without React. The short version: the connect page
  // after the survey has a Back button that lands back on "survey-pain", so an
  // unlatched completion event fires twice for one run and corrupts the funnel
  // denominator this file exists to produce.
  const latchRef = useRef<SurveyAnalyticsLatch | null>(null);
  if (!latchRef.current) latchRef.current = createSurveyAnalyticsLatch();
  const latch = latchRef.current;

  const trackQuestion = (question: "identity" | "pain", answer: string) => {
    if (!latch.shouldFireQuestion(question, answer)) return;
    const { event, props } = surveyQuestionEvent(question, answer);
    emitAnalytics(event, props);
  };
  const trackComplete = (answers: SurveyAnswers) => {
    if (!latch.shouldFireComplete()) return;
    const { event, props } = surveyCompleteEvent(answers);
    emitAnalytics(event, props);
  };
  const selectIdentity = (value: SurveyIdentity) => {
    setSurveyAnswers((prev) => ({ ...prev, identity: value }));
    trackQuestion("identity", value);
    window.setTimeout(goNext, 150);
  };
  const selectPain = (value: SurveyPain) => {
    setSurveyAnswers((prev) => ({ ...prev, pain: value }));
    trackQuestion("pain", value);
    trackComplete({ ...surveyAnswers, pain: value });
    window.setTimeout(goNext, 150);
  };
  const skipSurveyQuestion = () => {
    if (page === SURVEY_PAGES[SURVEY_PAGES.length - 1]) trackComplete(surveyAnswers);
    goNext();
  };

  // Cheap progress, never a percentage: the same small-dot bar as before,
  // just running over whichever leg of the flow is active — 4 dots across
  // the survey questions, then the existing per-page dots across
  // agents/tools/value. Two independent short sequences read better here
  // than one long one, and the connect pages' dot math is untouched from
  // before this survey existed.
  const onSurveyPage = isSurveyPage(page);
  const dotPages: readonly string[] = onSurveyPage ? SURVEY_PAGES : connectPages;
  const dotIndex = onSurveyPage
    ? SURVEY_PAGES.indexOf(page as (typeof SURVEY_PAGES)[number])
    : connectPages.indexOf(page as ConnectPageId);

  return (
    <div
      className="flex flex-col items-center overflow-y-auto overscroll-none bg-background px-6 text-foreground"
      style={{ height: "var(--lfg-app-height, 100dvh)" }}
    >
      {/* Fixed top offset, not `my-auto` centering. Centering re-measures
          the whole block's height on every page, and the survey questions
          don't have the same height as the connect pages that follow them —
          the pain question also carries an extra subtitle line the identity
          question doesn't. A centered block gets more top margin when it's
          short and less when it's tall, so the title itself visibly shifts
          the moment the page changes. Pinning the top here means the
          header/title sit at the same spot on every page; only the grid
          below grows or shrinks. */}
      <div className="mt-[8dvh] w-full max-w-sm pb-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <OmgBrandMark className="size-7 text-muted-foreground" />
          <div
            className="flex items-center gap-1.5"
            aria-label={
              onSurveyPage
                ? `Question ${dotIndex + 1} of ${dotPages.length}`
                : `Step ${dotIndex + 1} of ${dotPages.length}`
            }
          >
            {dotPages.map((id, index) => (
              <span
                key={id}
                className={`h-1.5 rounded-full transition-all duration-300 ease-ios ${
                  index === dotIndex
                    ? "w-5 bg-primary"
                    : index < dotIndex
                      ? "w-1.5 bg-primary/40"
                      : "w-1.5 bg-foreground/10"
                }`}
              />
            ))}
          </div>
        </div>
        {page === "survey-identity" ? (
          <>
            <h1 className="mb-5 text-xl font-semibold">Which best describes you?</h1>
            <SurveyOptionGrid
              options={IDENTITY_OPTIONS}
              selected={surveyAnswers.identity ? [surveyAnswers.identity] : []}
              onToggle={selectIdentity}
            />
            <SurveySkipLink onSkip={skipSurveyQuestion} />
          </>
        ) : page === "survey-pain" ? (
          <>
            <h1 className="text-xl font-semibold">What hurts most right now?</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">Pick the one that's true today.</p>
            <SurveyOptionGrid
              options={PAIN_OPTIONS}
              selected={surveyAnswers.pain ? [surveyAnswers.pain] : []}
              onToggle={selectPain}
            />
            <SurveySkipLink onSkip={skipSurveyQuestion} />
          </>
        ) : page === "agents" ? (
          <>
            <h1 className="text-xl font-semibold">Connect a coding agent</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">
              Sign in once and this Computer can start sessions. It opens the
              provider&rsquo;s sign-in page — nothing is stored here.
            </p>
            <div className="flex flex-col gap-2">
              {options.map((option) => {
                const pending = pendingKind === option.kind;
                const needsInstall = !option.installed;
                const blocked = needsInstall && !option.canAutoSetup;
                const providerLabel = option.provider === "claude"
                  ? "Claude"
                  : option.provider === "codex"
                    ? "ChatGPT"
                    : "xAI";
                return (
                  <div
                    key={option.kind}
                    className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{option.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.configured
                          ? "Connected"
                          : blocked
                            ? "CLI not installed on this Computer"
                            : needsInstall
                              ? "Install first, then sign in"
                              : `Sign in with ${providerLabel}`}
                      </span>
                    </span>
                    {option.configured ? (
                      <span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500" aria-label="Connected">
                        <Check className="size-4" />
                      </span>
                    ) : (
                      <Button
                        variant={option.provider === "claude" ? "brand" : "outline"}
                        size="sm"
                        disabled={pending || blocked}
                        onClick={() =>
                          needsInstall ? onInstall(option.kind) : onConnect(option.kind)
                        }
                      >
                        {pending ? (
                          <span className="size-2 animate-pulse rounded-full bg-current" />
                        ) : needsInstall ? (
                          "Install"
                        ) : (
                          "Connect"
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            {hasConnectedAgent ? (
              <Button variant="brand" className="mt-4 w-full" onClick={goNext}>
                Continue
              </Button>
            ) : null}
            <button
              type="button"
              onClick={goNext}
              className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {hasConnectedAgent ? "Connect another later" : "Skip for now"}
            </button>
          </>
        ) : page === "tools" ? (
          <>
            <h1 className="text-xl font-semibold">Connect your tools</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">
              Connect GitHub for private repos, pushes, and pull requests. You
              can always do this later from the Terminal.
            </p>
            <div className="flex flex-col gap-2">
              {!toolConnections ? (
                <div className="h-[58px] animate-pulse rounded-xl border border-border bg-muted/40" />
              ) : toolConnections.map((tool) => {
                const pending = pendingKind === tool.key;
                return (
                  <div
                    key={tool.key}
                    className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5">
                      <Github className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{tool.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {!tool.installed
                          ? "GitHub CLI is not installed"
                          : tool.connected
                            ? "Connected for private repos and PRs"
                            : tool.detail}
                      </span>
                    </span>
                    {tool.connected ? (
                      <span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500" aria-label="Connected">
                        <Check className="size-4" />
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending || !tool.installed}
                        onClick={() => onConnectTool(tool.key)}
                      >
                        {pending ? (
                          <span className="size-2 animate-pulse rounded-full bg-current" />
                        ) : (
                          "Connect"
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <Button variant="brand" className="mt-4 w-full" onClick={goNext}>
              Continue
            </Button>
            <button
              type="button"
              onClick={goBack}
              className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Back
            </button>
          </>
        ) : page === "value" ? (
          <>
            {/* The selling beat, and the only screen here that sells rather
                than asks. Two things, because two is what someone remembers
                from a first run: this Computer runs the agent account you
                already pay for, and it can run work while you are not looking.
                Everything else is discoverable later. */}
            <h1 className="text-xl font-semibold">Two things worth knowing</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">
              Your Computer is ready. Here is what makes it different.
            </p>

            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <div className="mb-3 flex items-center gap-1.5">
                  {SHOWCASE_AGENTS.map((agent, index) => (
                    <span
                      key={agent}
                      // Staggered so the row assembles itself rather than
                      // appearing — it reads as "these all plug in here".
                      className="flex size-9 items-center justify-center rounded-xl border border-border bg-background shadow-sm animate-in fade-in-0 zoom-in-75 duration-300 ease-out [animation-fill-mode:backwards]"
                      style={{ animationDelay: `${index * 60}ms` }}
                    >
                      <img src={agentIconSrc(agent)} alt={agentIconAlt(agent)} className="size-5" />
                    </span>
                  ))}
                </div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Repeat className="size-4 shrink-0 text-primary" />
                  Bring your own coding agent
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Claude Code, Codex, Grok, Cursor and OpenCode all run here on
                  your own account — switch between them per task, and add more
                  than one account of the same agent.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <div className="mb-3 flex items-center gap-1.5">
                  {["9:00", "13:00", "18:00"].map((time, index) => (
                    <span
                      key={time}
                      className="flex h-9 flex-1 items-center justify-center rounded-xl border border-border bg-background text-[11px] font-medium tabular-nums text-muted-foreground shadow-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out [animation-fill-mode:backwards]"
                      style={{ animationDelay: `${300 + index * 80}ms` }}
                    >
                      {time}
                    </span>
                  ))}
                </div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <CalendarClock className="size-4 shrink-0 text-primary" />
                  Put work on a schedule
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Agents can run on their own — every morning, every hour — and
                  bring you the result. No prompt needed once it is set up.
                </p>
              </div>
            </div>

            <Button
              variant="brand"
              className="mt-4 w-full"
              onClick={installIsLastPage ? goNext : onDone}
            >
              {installIsLastPage ? "Continue" : "Open my Computer"}
            </Button>
            <button
              type="button"
              onClick={goBack}
              className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Back
            </button>
          </>
        ) : (
          <>
            {/* Last step, and optional by construction: "Open my Computer"
                is always right below the install action, so this page can
                never gate the product. Install lived inside a signup wizard
                once and walled iOS users with no skip control — the ask only
                works AFTER the product, over a machine that is already set
                up. See buildGateFlow for why it is last. */}
            <h1 className="text-xl font-semibold">Add omg to your home screen</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">
              One tap back to your Computer — its own icon and window, no
              browser tabs in the way.
            </p>
            {pwa.installed ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium">
                <span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                  <Check className="size-4" />
                </span>
                Added
              </div>
            ) : (
              <Button
                variant="brand"
                className="w-full"
                disabled={installBusy}
                onClick={() => {
                  if (pwa.mode !== "native") {
                    setInstallHelpOpen(true);
                    return;
                  }
                  if (installBusy) return;
                  setInstallBusy(true);
                  void pwa.install().finally(() => setInstallBusy(false));
                }}
              >
                {pwa.mode === "ios" ? (
                  <Share className="size-4" />
                ) : (
                  <Download className="size-4" />
                )}
                {pwa.mode === "native" ? "Install omg" : "Add to Home Screen"}
              </Button>
            )}
            <Button
              variant={pwa.installed ? "brand" : "outline"}
              className="mt-3 w-full"
              onClick={onDone}
            >
              Open my Computer
            </Button>
            <button
              type="button"
              onClick={goBack}
              className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Back
            </button>
            <InstallInstructions
              mode={pwa.mode}
              open={installHelpOpen}
              onOpenChange={setInstallHelpOpen}
            />
          </>
        )}
      </div>
    </div>
  );
}
