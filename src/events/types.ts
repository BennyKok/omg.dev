// Event hooks: the shapes every part shares.
//
//   SOURCE  ──events──►  BUS (src/events/bus.ts)  ──batch──►  ACTION
//
// A source looks at something (a script, GitHub) and returns what is there
// now, each item with a stable `key`. The bus keeps the keys it has seen, so
// only new items become events. An action does something with a batch of new
// events (start an agent session, push a notification, run a script).
//
// Sources and actions never import each other. A new kind is one new file in
// sources/ or actions/ plus one line in its registry. The core does not change.

/**
 * An agent ends anything it posts outside (a GitHub comment, for example) with
 * this line. Sources skip items that carry it, so an agent's own reply does not
 * wake it again.
 */
export const OMG_AGENT_MARKER = "<!-- omg-agent -->";

export type OmgEvent = {
  id: string;
  hookId: string;
  /** Stable for the same item, so a source can return the same item every poll. */
  key: string;
  /** For example "github.comment" or "script". */
  topic: string;
  /** One line for people. */
  title?: string;
  url?: string;
  /** What the source saw. Untrusted: it can contain text that strangers wrote. */
  data: unknown;
  at: number;
};

export type NewEvent = Omit<OmgEvent, "id" | "hookId" | "at">;

export type KindConfig = { kind: string; [field: string]: unknown };

export type EventHook = {
  id: string;
  name: string;
  enabled: boolean;
  /** 5-field cron for when the source is checked, in the box's time zone. */
  schedule: string;
  source: KindConfig;
  action: KindConfig;
  /** Most action runs in any hour. New events wait for the next check past this. */
  maxRunsPerHour: number;
  /** Session that saved the hook, when an agent did. */
  createdBy?: string;
  createdAt: number;
  lastRunAt?: number;
  lastEventAt?: number;
  lastError?: string;
};

export type Validated<C> = { ok: true; config: C } | { ok: false; error: string };

export interface Source<C extends KindConfig = KindConfig> {
  kind: string;
  /** Turn untrusted input into a config, or explain what is wrong. */
  validate(input: Record<string, unknown>): Validated<C>;
  /** Return what is there now. The bus finds what is new. Throw on failure. */
  collect(config: C, ctx: { hookId: string }): Promise<NewEvent[]>;
}

export interface Action<C extends KindConfig = KindConfig> {
  kind: string;
  validate(input: Record<string, unknown>): Validated<C>;
  /** Handle a batch of new events. Return one short line for the log. Throw on failure. */
  run(events: OmgEvent[], config: C, hook: EventHook): Promise<string>;
}
