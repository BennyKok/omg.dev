// Embed-only first-run gate.
//
// A framed LFG hides onboarding and settings (the host owns account UX), so a
// fresh box had no surface at all for connecting a coding agent. This card is
// that surface: page one renders the browser-loginable agents, page two
// connects the tools those agents act through, and every click hands straight
// back to App's existing auth/setup handlers. Those drive the existing
// agent/connection endpoints and the same <CodingAgentAuthDialog> the Settings
// page uses. No credentials, no second auth path, no progress bar.
// Once opened, the card stays mounted through both pages so a successful agent
// login cannot make the tool step disappear underneath the user.

import { useState } from "react";
import { CalendarClock, Check, Github, Repeat } from "lucide-react";
import { Button } from "./ui/button";
import type { ConnectOption, ToolConnectOption } from "../lib/embedded-connect";
import { LFG_SMALL_ICON_PATH } from "../lib/icon-assets";
import { agentIconAlt, agentIconSrc } from "../lib/session-ui";
import { omgAssetUrl } from "../lib/omg-client";

/**
 * The agents shown on the closing screen. Real marks, not generic glyphs —
 * the whole point of the screen is "we take the account you already have",
 * and a person recognises the Claude sunburst faster than any sentence about
 * it. Same five that lead the picker (see DISCOVERABLE_AGENT_COUNT); listing
 * them here rather than deriving keeps this a fixed piece of art instead of
 * something that reshuffles with whatever this box happens to have.
 */
const SHOWCASE_AGENTS = ["aisdk", "codex-aisdk", "grok", "cursor", "opencode"] as const;

type Page = "agents" | "tools" | "value";

export function EmbeddedConnectGate({
  options,
  toolConnections,
  pendingKind,
  onConnect,
  onInstall,
  onConnectTool,
  onDone,
}: {
  options: ConnectOption[];
  toolConnections?: ToolConnectOption[];
  /** Kind with an in-flight connect/install click, if any. */
  pendingKind?: string | null;
  onConnect: (kind: string) => void;
  onInstall: (kind: string) => void;
  onConnectTool: (key: ToolConnectOption["key"]) => void;
  onDone: () => void;
}) {
  const [page, setPage] = useState<Page>("agents");
  const hasConnectedAgent = options.some((option) => option.configured);

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
  const pages: Page[] = toolsUsable ? ["agents", "tools", "value"] : ["agents", "value"];
  const stepIndex = Math.max(0, pages.indexOf(page));
  const goNext = () => setPage(pages[Math.min(stepIndex + 1, pages.length - 1)]!);
  const goBack = () => setPage(pages[Math.max(stepIndex - 1, 0)]!);

  return (
    <div
      className="flex flex-col items-center overflow-y-auto overscroll-none bg-background px-6 text-foreground"
      style={{ height: "var(--lfg-app-height, 100dvh)" }}
    >
      <div className="my-auto w-full max-w-sm py-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <img
            src={omgAssetUrl(LFG_SMALL_ICON_PATH)}
            alt="omg"
            className="size-7 shrink-0"
          />
          <div
            className="flex items-center gap-1.5"
            aria-label={`Step ${stepIndex + 1} of ${pages.length}`}
          >
            {pages.map((id, index) => (
              <span
                key={id}
                className={`h-1.5 rounded-full transition-all duration-300 ease-ios ${
                  index === stepIndex
                    ? "w-5 bg-primary"
                    : index < stepIndex
                      ? "w-1.5 bg-primary/40"
                      : "w-1.5 bg-foreground/10"
                }`}
              />
            ))}
          </div>
        </div>
        {page === "agents" ? (
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
        ) : (
          <>
            {/* The closing beat, and the only screen here that sells rather
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

            <Button variant="brand" className="mt-4 w-full" onClick={onDone}>
              Open my Computer
            </Button>
            <button
              type="button"
              onClick={goBack}
              className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
