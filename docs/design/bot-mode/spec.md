# Bot Mode — Phase 1 visual/interaction spec

Scope: the web UI slice of the [phase 1 implementation contract](../../bot-mode-design.md#phase-1-implementation-contract-agreed-2026-08-15-build-target) — Bots roster, bot chat, New/Edit Bot sheet, and the "driven by \<bot>" badge on session rows. No channels, no mentions, no proactive policy.

This spec is written against the **actual tokens and component idioms already in `web/src`** (audited from `web/src/index.css`, `web/index.html`, `web/src/components/ui/*`, and `web/src/App.tsx`), not a generic design system. Every value below either names the existing CSS variable/utility to reuse or gives the literal value when introducing something new. The companion `mockup.html` renders all four screens using this exact palette.

---

## 0. Design decisions (read this first)

1. **Bots is a new top-level page, not a rail section.** The left rail (`RailGroup`/`RailItem`) stays session-only. A roster with avatars + last-message previews reads as its own "list of relationships," not another grouping of sessions — mixing it into Pinned/Working/Idle would bury it. Precedent: `AutoManageView` ("Schedules") is already a dedicated page reached outside the rail, not a rail group.
2. **Reuse the existing Pages navigation, don't invent a tab bar.** The app has no persistent labeled tab strip — `PagesMenu` is a single dropdown (`⋮` trigger → radio group: Live, Notifications, Artifacts, Settings). Bots becomes a fifth radio item there. This keeps one navigation idiom in the app instead of two.
3. **"Next to Sessions" is delivered literally in the rail header**, not just via the menu three-dots — but as a text segmented toggle, not an icon button. The rail header gains a `Sessions | Chat` control stacked above the existing "New session" + collapse row, so switching to Bots is a single tap from the session list, and switching back is the same control, not a separate back-affordance. `PagesMenu`'s radio item is the fallback path on narrow/mobile layouts where the rail is hidden. See §2.1 for the control's spec and an open question on the label pair.
4. **Bot chat is not a new transcript component.** A bot's `sessionId` is a normal managed session; the chat view is the existing session transcript + composer, wrapping the message stream and `ComposerTextarea`/send-button chrome that every session already uses. What's new is the *header* (bot identity instead of session title/agent icons), that `omg_ship`-style close/fork actions are hidden (a bot session never closes), and that bot turns render inside a card/bubble instead of bare markdown on the canvas (§4.2) — a deliberate deviation from a normal task session's plain-markdown assistant turns, because a bot chat needs to read as talking to somebody, not reading a log.
5. **Bots get circular avatars; sessions keep their rounded-square agent icon.** `SessionAgentIcon` in the rail is `rounded-md` (a tool/agent glyph — "what kind of run"). A bot's emoji avatar is `rounded-full` (a face — "who"). This is the one deliberate shape break in the whole spec, and it's the signal that lets a glance tell a bot roster row from a session row even when both show an emoji. The same `rounded-full` avatar is reused at three sizes: `size-11` on the roster row (§3.2), `size-8` in the chat header (§4.1), and `size-[22px]` beside the first bubble of a run in the transcript itself (§4.2).
6. **The "driven by" badge is a pill, styled like the existing model badge, colored like the existing "open finding" badge.** Session rows already show a muted rounded-full pill for the model (`bg-muted text-muted-foreground`) and a tinted rounded-full pill for finding counts (`bg-primary/12 text-primary`). The bot badge borrows the tinted treatment (it's provenance worth noticing, like an open finding) but carries the bot's emoji + name instead of a count.

---

## 1. Tokens in play (from `web/src/index.css`)

Don't restate these in component CSS — reference the variables. Values here are for the mockup / for engineers without the running app open.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#f2f2f7` | `#000000` |
| `--card` | `#ffffff` | `#1c1c1e` |
| `--foreground` | `#000000` | `#ffffff` |
| `--muted` | `#f9f9fb` | `#2c2c2e` |
| `--muted-foreground` | `rgba(60,60,67,.6)` | `rgba(235,235,245,.6)` |
| `--primary` / `--brand` | `#007aff` | `#0a84ff` |
| `--success` | `#34c759` | `#30d158` |
| `--warning` | `#ff9500` | `#ff9f0a` |
| `--destructive` | `#ff3b30` | `#ff453a` |
| `--border` | `rgba(60,60,67,.12)` | `rgba(84,84,88,.35)` |
| `--radius` | `0.75rem` (base; `-sm` ×0.6, `-md` ×0.8, `-lg` ×1, `-xl` ×1.4, `-2xl` ×1.8, `-3xl` ×2.2, `-4xl` ×2.6 — buttons/badges use `-4xl`, i.e. fully round) |
| font | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Inter", system-ui, sans-serif` — body text 15px, row titles 13px, row subtitles 11–12px |
| motion | `--ease-ios: cubic-bezier(0.32,0.72,0,1)`; durations `--duration-quick 150ms`, `--duration-fast 250ms`, `--duration-medium 350ms` |

Reused component idioms (exact classes, for the React implementation):

- **Card row shell**: `rounded-xl border border-border bg-card px-3 py-2` — this is the `AutoManageView` schedule-row shell; the Bots roster row uses the same shell, and the bot chat bubble (§4.2) is a variant of it (same `border-border`/`bg-card` surface, taller `rounded-[18px]` corner for a chat-bubble feel).
- **Gradient field** (composer textarea, any single-line/multiline input): `.lfg-gfield` class — opaque `--lfg-field-fill` interior over a soft diagonal gradient border, warms to `--primary` on focus with a `0 0 0 3px` glow ring. Used verbatim for the composer and the New Bot sheet's Name/Persona fields.
- **Gradient border ring** (cards, CTA buttons): `.lfg-gborder` / `.lfg-gborder--brand` (brand variant tints the ring iOS-blue with a soft glow shadow).
- **Button variants** (`components/ui/button.tsx`): `default` (solid primary), `brand` (flat iOS-blue CTA fill, used for "Create"/"Save"), `tint` (quiet icon chip, `bg-foreground/[.06]`), `outline`, `ghost`, `destructive` (for "Delete bot"). Sizes: `sm` (h-8), `icon-sm` (8×8 square), `default` (h-9).
- **Badge shell** (`components/ui/badge.tsx`): `rounded-4xl h-5 px-2 text-xs font-medium`, `secondary` variant (`bg-secondary`) for neutral tags, custom `bg-primary/12 text-primary` treatment for the finding/driven-by tint.
- **BottomSheet / Drawer**: `vaul` drawer on mobile, centered dialog on desktop (≥768px) — same `<BottomSheet title="…">` wrapper used by every "New X" flow (`NewAutoAgentComposer`, `AgentEditorSheet`, fork sheet). New Bot uses it unmodified.
- **Status dot**: `SessionStatusDot` — busy = `animate-pulse bg-warning`; idle on an avatar renders **nothing** (idle is the resting state, not worth a mark); paused = warning pause-glyph badge. Bot working/typing state below extends this exact rule rather than inventing a new indicator.
- **Typing indicator**: `.typing-indicator` — `border border-border`, `bg-card` at 82% opacity, three breathing dots, `.typing-indicator-slot` grid-row height transition for mount/unmount. In bot chat this is nested inside the bot-bubble shell (§4.2) rather than shown as a standalone `rounded-full` pill — see §4.3.

---

## 2. Navigation

### 2.1 Rail header (desktop / wide layout)

The existing rail header row (`New session` button + collapse toggle) is unchanged in its own row, but the header now stacks a **text segmented toggle** above it — this replaces an earlier icon-button approach (a single unlabeled `Bot` glyph inserted before "New session"), which read as another tool button rather than a navigation switch and had no way to show which surface you were currently on:

```
[          Sessions   |   Chat          ]
[        + New session          C ]  [ ⤢ collapse ]
 flex-1 segmented control            32×32
```

- Toggle shell: two segments in a `flex gap-0.5 p-[3px] rounded-full bg-muted` track, each segment `flex-1 h-[26px] rounded-full text-xs font-semibold text-muted-foreground`. The active segment gets `bg-card text-foreground` plus the app's standard card shadow — the same "pill inside a track" idiom as any other segmented control in the app, applied here at rail-header scale.
- Labels: **Chat** | **Bot** — settled by Benny 2026-08-16: "Chat" is the ORIGINAL sessions surface (a session is a conversation you have with an agent), "Bot" is the new bots surface. Earlier drafts of this spec had "Sessions | Chat" (with "Chat" meaning the bots side); that reading is dead — do not resurrect it. The bots page `h1` ("Bots") and the `PagesMenu` entry may stay plural; the toggle segment stays singular "Bot" per Benny's wording.
- Unread indicator: a `size-1.5` `bg-primary` dot inline after the "Chat" label (there's no icon left to corner-badge), shown when any bot has an unread reply.
- Click **Chat** → navigates to the Bots page (`/bots`, `tab === "bots"`). Click **Sessions** → returns to the session rail (`tab === "live"`). The toggle is rendered — with the correct segment active — on both the Bots roster screen and the session rail itself, so the switch reads as one control with two states, not a one-way door out of Sessions.
- When the rail is collapsed to icon-only width, there isn't room for a legible two-word control; the toggle is hidden at that width and `PagesMenu` (§2.2) is the only path, same fallback it already is for mobile.

### 2.2 Pages menu (`PagesMenu`, mobile fallback + discoverability)

Add one `DropdownMenuRadioItem` between **Live** and **Notifications**:

```tsx
<DropdownMenuRadioItem value="bots">
  <Bot className="size-5 shrink-0 text-muted-foreground" />
  Bots
</DropdownMenuRadioItem>
```

No other change to `PagesMenu`.

### 2.3 Page identity

The Bots page (roster) and an open bot chat both live under the same `bots` tab (`/bots` roster, `/bots/:id` chat — mirrors how a session is `/` + a selected id, not two tabs). Selecting a bot does **not** leave the Bots tab; it's a master-detail push exactly like opening a session from the rail keeps you on `tab === "live"`.

---

## 3. Screen: Bots roster

Page shell matches `AutoManageView`: `mx-auto flex max-w-3xl flex-col gap-2` with `data-lfg-page-column`, a header block, then rows.

### 3.1 Header

```
Bots
Persistent agents you talk to, not tasks you launch.
```
- `h1`: `text-lg font-semibold leading-tight`
- subtitle: `text-sm text-muted-foreground`
- Top-right of the header row: `+ New bot` button, `variant="brand"` `size="sm"`, `<Plus className="size-3.5" /> New bot`.

### 3.2 Roster row (populated, default state)

Row shell: `flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5` — one row per bot, `gap-y-2` between rows, whole row is a `button` (click → open chat).

Anatomy, left to right:

1. **Avatar** — `size-11` (44px) `rounded-full bg-muted flex items-center justify-center text-[22px] leading-none`, containing the bot's `emoji` (fallback: lucide `Bot` icon at `size-5 text-muted-foreground` if no emoji was set). This is the shape break from §0.5 — every session-related avatar in the app is `rounded-md`; every bot avatar is `rounded-full`.
   - Working/typing state: a `size-3` dot, `bg-warning animate-pulse`, `absolute -right-0.5 -bottom-0.5 ring-2 ring-card` — same geometry and color as `SessionStatusDot`'s `variant="avatar"` busy state. No dot when idle (same "idle = no mark" rule).
2. **Name + preview column** — `min-w-0 flex-1 flex flex-col`:
   - Row 1: `<span class="truncate text-[13px] font-semibold">{name}</span>` + inline unread dot (`size-2 rounded-full bg-primary`, only if unread) immediately after the name.
   - Row 2: `<span class="truncate text-xs text-muted-foreground">{lastMessagePreview}</span>` — the last transcript line, truncated to one line. If the bot has never been messaged: `Say hi to get started.` in the same slot, same styling.
3. **Timestamp** — `shrink-0 text-[10px] tabular-nums text-muted-foreground/70`, right-aligned, e.g. `2h`, `Yesterday`, `Aug 12` (reuse the app's existing `relTime()` formatter verbatim).
4. **Chevron** — `ChevronRight` `size-4 text-muted-foreground/60`, far right, matching the settings-row disclosure chevron used elsewhere in the app.

Unread row gets one additional treatment: the name (row 1) goes from `font-semibold` (already the base) to also bumping the preview line from `text-muted-foreground` to `text-foreground/80` — unread previews read darker/sharper than read ones, same trick email clients use, no icon needed beyond the dot.

### 3.3 Disabled bot

- Avatar: `opacity-45 grayscale` (the emoji desaturates).
- Name + preview: `text-muted-foreground` throughout (no foreground-weight text anywhere in the row).
- Trailing badge before the chevron: `Badge` `variant="secondary"` reading `Disabled`.
- Row remains tappable — you can still open history and edit; only messaging is blocked. Opening a disabled bot's chat shows the composer replaced by an inline banner (see §4.4).

### 3.4 Empty roster

Single centered card, verbatim pattern from `AutoManageView`'s empty state:

```
┌───────────────────────────────────────────┐
│         No bots yet.                       │
│  Give a persona a name and a memory —      │
│  it'll be there next time you open this.   │
└───────────────────────────────────────────┘
```
`rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground`, two lines (first line can carry slightly more weight — `text-foreground font-medium` — the rest `text-muted-foreground`).

Below it, the dashed "create" affordance already used for `+ New schedule`:

```
- - - - - - - - - - - - - - - - - -
        ＋  New bot
- - - - - - - - - - - - - - - - - -
```
`flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:text-foreground`.

(Both the header's `+ New bot` button and this dashed row open the same sheet — the dashed row only renders when the roster is empty, exactly like `+ New schedule`.)

---

## 4. Screen: Bot chat

This is the existing session view, so only the delta from a normal task session is specified.

### 4.1 Header (replaces the normal session title bar)

```
[ ← ]  (●emoji)  Name                              [ ⚙ ]
                 persona snippet · idle/working
```

- Back chevron: standard `ChevronLeft`/back affordance, returns to the roster (not to the session rail).
- Avatar: same `rounded-full` emoji avatar as the roster row, `size-8` in the header (smaller than the roster's `size-11`).
- Title line: bot `name`, `text-[15px] font-semibold`.
- Subtitle line: first ~60 chars of `persona`, `text-xs text-muted-foreground truncate`, then `· idle` or `· working` status word (not a re-drawn dot — text is enough at header scale).
- Trailing gear icon (`Settings` lucide, `Button variant="tint" size="icon-sm"`) opens the same sheet as "New bot," pre-filled — this is the only edit entry point (no separate "Edit bot" screen).
- What's **not** here, on purpose: no fork button, no "ship" affordance, no close/archive control. A bot session cannot be closed from the UI in phase 1 — deleting the bot (from the edit sheet) is the only path that ends it, and that's a `destructive`-variant confirm, not a header icon.

### 4.2 Transcript

This is the one deliberate delta from a normal task session's transcript, and it's the point of Bot Mode: **bot turns get a card/bubble too**, not bare markdown on the canvas. A task session leaves assistant turns unbubbled because it reads as a log; a bot chat needs to read as a conversation with somebody, so both sides get a bubble now.

- **Bot bubble**: left-aligned, `rounded-[18px] border border-border bg-card px-3.5 py-2.5`, `text-[14.5px] leading-[1.55]` — the same surface-card idiom as the roster row and every other card shell in the app (§1, "Card row shell"), just with a taller corner radius so it reads as a chat bubble rather than a list row. Markdown renders inside it exactly as it does today (same `.markdown` formatting), now inside a surface instead of directly on the canvas. Max width ~84% of the stream, matching the existing assistant-turn cap.
- **Run grouping**: consecutive bot turns with no user turn in between are a "run." Only the **first** bubble in a run gets the bot's `rounded-full` emoji avatar (`size-[22px]` here — see §0.5) placed to its left, bottom-aligned with the bubble. Every subsequent bubble in the same run sits next to an equal-width invisible spacer instead of the avatar, so bubble left edges line up whether or not that particular bubble carries the avatar. Any new user turn starts a fresh run on the bot's next reply.
- **User bubble**: unchanged — the existing glass `.user-bubble.markdown` pill (blurred gradient-edge bubble, `rounded-[22px]`), right-aligned, no avatar.
- Still the same `chat-stream` component every session uses; the bubble/avatar/run-grouping behavior above is additive for the bot-chat context, not a new transcript implementation.

### 4.3 Bot typing / working state

The typing indicator moves **inside a bot bubble** instead of floating as a standalone pill. Same `TypingIndicator` three-breathing-dot animation (`.typing-indicator`), but now rendered inside the bot-bubble shell from §4.2 rather than as its own `rounded-full border border-border bg-card/82` pill — a "bubble is being composed" reads more like chat than a disconnected loading pill does. It follows the same run-grouping rule as any other bubble: avatar if this typing bubble starts a fresh run (the user just sent a message), spacer-only if the bot's last visible turn already opened the run. No new "bot is thinking" component — a bot turn is a session turn, and typing is just an in-progress bot turn using the same bubble.

### 4.4 Disabled bot banner

When the bot is disabled, the composer area is replaced (not disabled-and-grayed, replaced) with an inline banner using the same visual language as a failed/queued send state (`border-dashed`, muted fill):

```
┌──────────────────────────────────────────────┐
│  This bot is disabled. Re-enable it in       │
│  settings to keep talking to it.      [ ⚙ ]  │
└──────────────────────────────────────────────┘
```
`rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground`, trailing gear button opens the edit sheet. The transcript above stays fully visible and scrollable — history is never hidden.

### 4.5 Composer

Unmodified `.lfg-gfield` composer shell + send button, identical to a normal session's composer, wired to `POST /api/bots/:id/messages` instead of the session send endpoint. No agent/model/thinking picker row under the composer here — those are bot-level settings (edit sheet), not per-message choices, so that row is simply omitted for a bot chat (contrast with the fork sheet, which does show it, because a fork is choosing a new agent).

---

## 5. Screen: New Bot sheet (also used for Edit)

`BottomSheet` (`title="New bot"` / `"Edit bot"`), same drawer-on-mobile / centered-dialog-on-desktop behavior as every other sheet in the app. Structure mirrors `NewAutoAgentComposer` almost field-for-field.

### 5.1 Header row (inside the sheet, not the drawer chrome)

```
🤖  New bot                                    [ Create ]
```
- Leading icon: lucide `Bot`, `size-5 text-primary` (matches `NewAutoAgentComposer`'s `Sparkles` treatment).
- Title: `flex-1 text-[15px] font-semibold`.
- Trailing action: `Button variant="brand" size="sm"`, label `Create` (new) / `Save` (edit), `disabled` until `name` is non-empty.
- Edit mode only: a second trailing action, `Button variant="destructive" size="sm"` icon-only (`Trash2`), opens a `DoubleConfirmAction`-style confirm (component already exists: `double-confirm-action.tsx`) before calling `DELETE /api/bots/:id`.

### 5.2 Identity row

Avatar picker + name field share a row, avatar first:

```
( 🤖 )   [ Name ________________________ ]
 tap to
 change
```
- Avatar button: `size-14 rounded-full bg-muted flex items-center justify-center text-2xl`, tapping opens the platform's native emoji entry (a visually-hidden `<input>` focused programmatically — the same trick used for OS-level pickers elsewhere in the app; no custom emoji grid to build/maintain). Empty state shows a dashed `rounded-full border border-dashed border-border` with a small `Smile` glyph placeholder instead of the `Bot` fallback, so it visibly reads as "tap to pick."
- Name field: `.lfg-gfield rounded-2xl px-3 py-2`, single-line `<input>`, placeholder `"Bot name"`, `text-[15px] font-medium`, `autoFocus`.

### 5.3 Persona

```
Persona
[ multi-line gradient-field textarea, 4 rows,
  placeholder: "How this bot should think and talk…" ]
```
- Label: `text-xs font-semibold uppercase tracking-wide text-muted-foreground` (matches `RailGroup` label styling), `mb-1`.
- Field: `.lfg-gfield rounded-2xl px-3 py-2`, `SkillTextarea`-equivalent, `rows={4}`, `resize-none`.

### 5.4 Advanced (collapsed by default)

A `Collapsible` (component already exists: `components/ui/collapsible.tsx`) trigger row:

```
▸ Advanced                                    agent · model
```
- Collapsed trigger: `flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm`, chevron rotates 90° on open (`transition-transform duration-150`). Trailing muted text previews the current agent/model so power users don't have to open it to confirm what they picked.
- Expanded content, top to bottom:
  1. **Repo row** — identical to `NewAutoAgentComposer`'s repo row: `Folder` icon + label left, native `<select>` right, `flex items-center justify-between rounded-xl border border-border px-3 py-2`.
  2. **Agent / model / thinking row** — the existing `AgentModelRow` component, unmodified, reused verbatim (same one `NewAutoAgentComposer` and `AgentEditorSheet` already use). Default backend `aisdk` per the phase 1 `Bot` type.

### 5.5 Footer

None beyond the header's Create/Save — this sheet has no separate footer bar (contrast with sheets that pin a composer to the keyboard; there's no field here that needs keyboard-docked actions).

---

## 6. "Driven by \<bot>" badge on session rows

Applies to (a) a bot's own backing session, and (b) any session whose `parentSessionId` resolves to a bot's backing session — both carry `botId`/`botName` per the phase-1 contract's `Session` type extension.

### 6.1 Placement

In the session row's meta line (the row that already carries the model badge — see `App.tsx` around the `session.model` pill), inserted **before** the model badge:

```
🔭 Scout   ·   claude-sonnet-4.5   ·   2m
```

### 6.2 Styling

```
rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary
```
- Same shell as the existing "N open" finding pill (`bg-primary/12 text-primary`), signaling "notable provenance" with the same visual weight as an open finding — not neutral like the model pill (`bg-muted`), because who's driving a session is more load-bearing than which model it's on.
- Content: bot emoji (`14px` inline) + bot name, truncated at ~14 characters with an ellipsis for long names — the pill must never push the model/timestamp pills off a narrow row.
- Tapping the pill (desktop hover shows pointer cursor) navigates to that bot's chat — same affordance as tapping the model pill navigates to the model picker, i.e. the badge is a link, not decoration.

### 6.3 In the compact rail row (`RailItem`)

The rail row is narrower and already carries a title + relative time on one line — there's no room for a text pill. Instead, the bot's avatar (a small `rounded-full` emoji, `size-3.5`) replaces the ring-only status dot position when a session is bot-driven and idle: `absolute -right-0.5 -top-0.5 size-3.5 rounded-full ring-2 ring-card`, sitting exactly where `SessionStatusDot`'s avatar-variant dot would sit. When the session is also busy/paused, the status dot wins (it's the higher-urgency signal) and the bot mark is dropped — this is a rail row, glanceability beats completeness, and the full badge is always available in the expanded session view.

---

## 7. States checklist (for QA / handoff)

| State | Where | Spec section |
|---|---|---|
| Empty roster | Bots page | §3.4 |
| Roster row, read | Bots page | §3.2 |
| Roster row, unread | Bots page | §3.2 (unread variant) |
| Roster row, bot working | Bots page | §3.2 (working dot) |
| Roster row, disabled | Bots page | §3.3 |
| Bot chat, idle | Bot chat | §4.1–§4.3 |
| Bot chat, typing/working | Bot chat | §4.3 |
| Bot chat, disabled | Bot chat | §4.4 |
| New Bot sheet, collapsed advanced | Sheet | §5.4 |
| New Bot sheet, expanded advanced | Sheet | §5.4 |
| Edit Bot sheet (delete confirm) | Sheet | §5.1 |
| Session row, driven-by badge | Sessions list | §6.1–§6.2 |
| Rail row, bot-driven + idle | Rail | §6.3 |
| Light theme | All | tokens table, §1 |
| Dark theme | All | tokens table, §1 |

All of the above are rendered in `mockup.html`, switchable via the light/dark toggle in its top-right corner.
