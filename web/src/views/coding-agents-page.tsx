import { BROWSER_AUTH_KINDS } from "../lib/session-ui";
import type {
  AgentKind,
  ClaudeAccountInfo,
  CodingAgentInfo,
  PiProviderInfo,
  SetupCheckGroup,
} from "../App";
import { agentIconAlt, agentIconSrc } from "../lib/session-ui";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  Globe,
  KeyRound,
  Loader2,
  Play,
  RotateCcw,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

/**
 * The page used to print everything it knew about every agent at once: two
 * badges, every check with its resolved binary path, an instructions sentence,
 * an install command and a login command — per agent, times seven. The state
 * that actually matters is binary (does this work, is it in the composer), so
 * that is all a row shows now; the diagnostics live one tap down, where you
 * only go when something is wrong.
 */

/** A working agent says nothing; a broken one says what is missing. */
function statusNote(checks: { label: string; ok: boolean }[]): string | null {
  const failing = checks.filter((check) => !check.ok);
  if (!failing.length) return null;
  if (failing.length === 1) return `${failing[0].label} missing`;
  return `${failing.length} checks failing`;
}

function CheckList({ checks }: { checks: { label: string; ok: boolean; detail?: string }[] }) {
  return (
    <div className="space-y-1">
      {checks.map((check) => (
        <div
          key={check.label}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          {check.ok ? (
            <Check className="size-3.5 shrink-0 text-success" />
          ) : (
            <X className="size-3.5 shrink-0 text-destructive" />
          )}
          <span className="shrink-0">{check.label}</span>
          {check.detail ? (
            <span className="min-w-0 truncate text-muted-foreground/70">{check.detail}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Shared shell: an always-visible summary line that opens to its detail. */
function ExpandableRow({
  icon,
  title,
  note,
  ok,
  control,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  note: string | null;
  ok: boolean;
  control?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-border bg-background">
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{title}</span>
              {/* Green means nothing needs saying, so nothing is said. */}
              {!ok ? (
                <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
              ) : null}
            </span>
            {note ? (
              <span className="block truncate text-xs text-muted-foreground">{note}</span>
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground/60 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>
        {control}
      </div>
      {open ? <div className="mt-3 space-y-3 pl-11">{children}</div> : null}
    </div>
  );
}

/** One model provider pi can sign into, with its connect/disconnect control. */
function PiProviderRow({
  provider,
  onConnect,
  onDisconnect,
}: {
  provider: PiProviderInfo;
  onConnect: (provider: PiProviderInfo) => void;
  onDisconnect: (provider: PiProviderInfo) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-2.5 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{provider.label}</span>
        {provider.fromEnv ? (
          <span className="block truncate text-[11px] text-muted-foreground">
            From the environment
          </span>
        ) : null}
      </span>
      {provider.connected ? (
        <>
          <span className="text-[11px] text-success">Connected</span>
          {/* An env-provided key is not ours to delete. */}
          {!provider.fromEnv ? (
            <button
              type="button"
              onClick={() => onDisconnect(provider)}
              title={`Disconnect ${provider.label}`}
              aria-label={`Disconnect ${provider.label}`}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => onConnect(provider)}>
          {provider.method === "oauth" ? (
            <Globe className="size-3.5" />
          ) : (
            <KeyRound className="size-3.5" />
          )}
          Connect
        </Button>
      )}
    </div>
  );
}

export default function CodingAgentsPage({
  setupChecks,
  agents,
  onVisibleChange,
  onSetup,
  onLogin,
  onAddClaudeAccount,
  onRemoveClaudeAccount,
  onConnectPiProvider,
  onDisconnectPiProvider,
  onSetupCheck,
  onRefresh,
}: {
  setupChecks: SetupCheckGroup[];
  agents: CodingAgentInfo[];
  onVisibleChange: (kind: AgentKind, visible: boolean) => void;
  onSetup: (kind: AgentKind) => void;
  onLogin: (kind: AgentKind, claudeAccountId?: string) => void;
  onAddClaudeAccount: () => void;
  onRemoveClaudeAccount: (account: ClaudeAccountInfo) => void;
  onConnectPiProvider: (provider: PiProviderInfo) => void;
  onDisconnectPiProvider: (provider: PiProviderInfo) => void;
  onSetupCheck: (key: string) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (key: string) => setExpanded((current) => (current === key ? null : key));

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      toast.success("Coding agents refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh coding agents");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-3 pb-10" data-lfg-page-column>
      <div className="flex items-center justify-between px-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Coding agents
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className={cn("size-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {setupChecks.length ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
          {setupChecks.map((group) => (
            <ExpandableRow
              key={group.key}
              icon={<TerminalSquare className="size-4 text-muted-foreground" />}
              title={group.label}
              note={statusNote(group.checks)}
              ok={group.configured}
              open={expanded === `setup:${group.key}`}
              onToggle={() => toggle(`setup:${group.key}`)}
            >
              <CheckList checks={group.checks} />
              {group.instructions.map((instruction) => (
                <p key={instruction} className="text-xs text-muted-foreground">
                  {instruction}
                </p>
              ))}
              <Button
                size="sm"
                variant="outline"
                disabled={!group.canAutoSetup || group.running}
                onClick={() => onSetupCheck(group.key)}
                title={
                  group.canAutoSetup ? group.actionLabel : "Install a supported coding agent first"
                }
              >
                {group.running ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {group.running ? "Running…" : group.actionLabel}
              </Button>
            </ExpandableRow>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
        {agents.map((agent) => {
          const status = agent.status;
          const accounts = agent.key === "aisdk" ? (status.accounts ?? []) : [];
          const providers = status.providers ?? [];
          return (
            <ExpandableRow
              key={agent.key}
              icon={
                <img src={agentIconSrc(agent.key)} alt={agentIconAlt(agent.key)} className="size-5" />
              }
              title={agent.label}
              note={statusNote(status.checks)}
              ok={status.configured}
              open={expanded === `agent:${agent.key}`}
              onToggle={() => toggle(`agent:${agent.key}`)}
              control={
                <Switch
                  checked={agent.visible}
                  onCheckedChange={(visible) => onVisibleChange(agent.key, visible)}
                  aria-label={`${agent.label} visible in composer`}
                />
              }
            >
              <CheckList checks={status.checks} />

              {accounts.length ? (
                <div className="space-y-1.5">
                  {accounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-2.5 py-2"
                    >
                      <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <img src={agentIconSrc("aisdk")} alt="" className="size-4.5" />
                        <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[8px] font-bold text-background ring-1 ring-background">
                          {account.number}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{account.label}</span>
                        {/* A dead sign-in looks exactly like an account that was
                            never set up unless the row says otherwise. */}
                        {account.needsReconnect ? (
                          <span className="block truncate text-[11px] text-destructive">
                            Sign-in expired
                          </span>
                        ) : null}
                      </span>
                      {account.connected ? (
                        <>
                          <span className="text-[11px] text-success">Connected</span>
                          {/* Signing in again is the only repair for an account
                              whose token the CLI can no longer renew, so the
                              action stays reachable while it reads Connected —
                              a row that can only be deleted is a dead end. */}
                          <button
                            type="button"
                            onClick={() => onLogin(agent.key, account.id)}
                            title={`Sign in to ${account.label} again`}
                            aria-label={`Sign in to ${account.label} again`}
                            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                          >
                            <RotateCcw className="size-3.5" />
                          </button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onLogin(agent.key, account.id)}
                        >
                          <Globe className="size-3.5" />
                          {account.needsReconnect ? "Reconnect" : "Connect"}
                        </Button>
                      )}
                      {account.removable ? (
                        <button
                          type="button"
                          onClick={() => onRemoveClaudeAccount(account)}
                          title={`Remove ${account.label}`}
                          aria-label={`Remove ${account.label}`}
                          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {providers.length ? (
                <div className="space-y-1.5">
                  {providers.map((provider) => (
                    <PiProviderRow
                      key={provider.id}
                      provider={provider}
                      onConnect={onConnectPiProvider}
                      onDisconnect={onDisconnectPiProvider}
                    />
                  ))}
                </div>
              ) : null}

              {status.instructions.map((instruction) => (
                <p key={instruction} className="text-xs text-muted-foreground">
                  {instruction}
                </p>
              ))}

              {/* Copy-paste commands are a fix, so they only appear when
                  something is broken. A working agent has nothing to fix. */}
              {!status.configured &&
              (status.installCommand ||
                (status.loginCommand && !BROWSER_AUTH_KINDS.has(agent.key))) ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {status.installCommand ? (
                    <div className="truncate">
                      Install: <code>{status.installCommand}</code>
                    </div>
                  ) : null}
                  {status.loginCommand && !BROWSER_AUTH_KINDS.has(agent.key) ? (
                    <div className="truncate">
                      Login: <code>{status.loginCommand}</code>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                {status.canAutoSetup ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={status.setupRunning}
                    onClick={() => onSetup(agent.key)}
                    title="Run setup for this agent"
                  >
                    {status.setupRunning ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    {status.setupRunning ? "Running…" : "Install"}
                  </Button>
                ) : null}
                {/* pi has no agent-wide login — its sign-in is the provider rows
                    above — so the button that would always be disabled is gone. */}
                {status.canLoginInTerminal ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={status.setupRunning}
                    onClick={() =>
                      agent.key === "aisdk" && accounts.length
                        ? onAddClaudeAccount()
                        : onLogin(agent.key)
                    }
                    title={
                      agent.key === "aisdk" && accounts.length
                        ? "Add another Claude account"
                        : BROWSER_AUTH_KINDS.has(agent.key)
                        ? `Sign in to ${agent.label} in your browser`
                        : `Open terminal and run ${status.loginCommand}`
                    }
                  >
                    {BROWSER_AUTH_KINDS.has(agent.key) ? (
                      <Globe className="size-4" />
                    ) : (
                      <TerminalSquare className="size-4" />
                    )}
                    {/* Every listed account owns its own sign-in button, so this
                        one can only mean "another account". It used to say Login
                        while none of them were connected, and then signed into
                        the DEFAULT config dir — repairing account 1 by accident
                        and leaving the account the user meant still broken. */}
                    {agent.key === "aisdk" && accounts.length ? "Add account" : "Login"}
                  </Button>
                ) : null}
                <span className="text-[11px] text-muted-foreground/70">
                  {status.omgCapabilityAccess === "mcp" ? "OMG tools" : "OMG prompt only"}
                </span>
              </div>
            </ExpandableRow>
          );
        })}
      </div>
    </div>
  );
}
