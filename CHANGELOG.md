# Changelog

Recent product updates and deployment notes.

## August 27, 2026 - The native iOS client, native push, and a matched dark theme (v0.6.16)

- **The native omg.dev client for iOS now lives in this repository.** The
  `mobile/` directory held a todo prototype while the real client was developed
  on a branch. The real client is now on `main`: sign-in, sessions, transcript
  and composer, dictation, the Bots roster and bot chat, shared Computers, and
  the plan screen. It ships through TestFlight and EAS Update, not through this
  release bundle.
- **The dark theme is softer, and an installed app's status bar now matches
  it.** The background moved from pure black to #141414, and body text moved
  from pure white to a warm off-white. The chrome of an installed app kept its
  own copies of the old colour, so an iPhone home-screen app painted a black
  status bar above a lighter page. The theme colour, the splash, the safe-area
  strips, the boot-failure page, and the web manifest now all use the same
  value.
- **The server can send push notifications to the native app.** Delivery goes
  through Expo and APNs, and it is fanned out from the same path as every other
  notification, so existing callers inherit it with the same user scoping. The
  payload is deliberately redacted: it carries a per-kind title and a project
  name, and never the question text. Delivery needs a native build and an APNs
  key.
- **The usage summary now arrives in one request.** `/api/usage/summary` groups
  sources by kind, averages clamped windows by label, keeps the soonest reset,
  and excludes accounts that did not report. A remote client no longer pays one
  round trip per account. The per-account routes remain available.
- **Batch dictation now picks a provider that can perform it.** The fallback
  matched any provider that defined a transcribe function, which included the
  hosted relay. That relay is realtime-only and always answers 503, so a
  workspace with a working ElevenLabs or OpenAI key still failed. Batch-capable
  providers are now marked, and only they are selected.
- **A session row falls back to the local placeholder when an avatar cannot
  load.** The fallback chain ended at Gravatar, which always returns a URL. On a
  box that cannot reach gravatar.com, every row rendered a broken image. The
  configured identity now stays visible without a network.

## August 27, 2026 - Session sharing, pinned chats sync, and env-token Claude accounts (v0.6.15)

- **A Claude login held in `CLAUDE_CODE_OAUTH_TOKEN` now counts as a connected
  account.** A box authenticated only through that variable showed the default
  Claude account as disconnected, and the Coding Agents page asked for a login
  that was not needed. Sessions launched from such a box worked the whole time,
  so the page disagreed with the runtime. The account row now reads "From
  CLAUDE_CODE_OAUTH_TOKEN", and the re-login button is hidden there, because the
  variable outranks anything a browser sign-in stores. An isolated account no
  longer inherits the variable, so accounts cannot all run on one login.
- **Hosted sessions show who they are shared with.** The session list carries an
  assignee avatar, and a user filter menu narrows the list to one person.
- **Pinned chats now follow your account instead of one browser.** Pins are held
  by the server, so a session pinned on one device appears pinned on the others.
- **The thread rail shows project favicons.** Each project in the rail carries
  its own icon, and the activity marks beside it are simpler to read.
- **Voice failures now explain what to fix.** Batch dictation no longer goes
  silent when a provider rejects a key, runs out of API credit, rate limits a
  request, or cannot be reached. The server returns a stable safe error code,
  and the composer shows an actionable message without exposing the provider's
  response body. The mic also reports its starting and transcribing states to
  assistive technology.
- **Long-press uses the native iPhone selection controls again.** A user can
  select and adjust any part of a message, while the separate copy button
  remains available for copying the whole message in one tap.
- **Swipe between chats is now optional per device.** The new switch under
  Settings > More > This device disables only the horizontal chat-switching
  gesture. Vertical scrolling, native text selection, and other gestures keep
  working normally.
- **Opening the keyboard no longer scrolls the newest message away.** A
  transcript pinned to the latest turn stays pinned when the soft keyboard
  opens or closes.
- **Headings in an answer are no longer smaller than the text they introduce.**
  A rule written for the user bubble was applying to every assistant reply, so
  H1, H2 and H3 all rendered at 14px against 17px body text. The rule is now
  scoped to the user bubble.
- **Computer Use refuses a debugging port that another process already holds.**
  Before, a box that already had a browser on port 9222 reported a successful
  start while Chrome had in fact exited. The desktop stayed empty and every
  Computer Use call went to the other browser. The start now fails and says so.
- The onboarding survey is cut to two questions, and its analytics are posted to
  the embedding host rather than sent from the sandboxed frame, where every
  event was being dropped.
- **Deployment note:** pi resolves its proxy base from `OMG_AI_URL` when
  `ANTHROPIC_BASE_URL` is unset. There is no behavior change while infra still
  injects `ANTHROPIC_BASE_URL`, which keeps priority. This release must be
  rebaked into the agent template before the infra side stops injecting the
  vendor-named variable.

## August 25, 2026 - OpenCode Go models appear without a Claude account (v0.6.14)

- **An OpenCode Go key alone now unlocks OpenCode's paid models.** If OpenCode
  was the only agent signed in on a box, the picker showed the free Zen tier
  and nothing else — even with a Go key connected and every `opencode-go/*`
  model already discovered. The box was being treated as anonymous because the
  "is someone signed in here" check counted only Claude and Codex. Anyone
  paying for OpenCode Go and using nothing else was being billed for models the
  picker hid from them.
- The check that stops a *Claude* account from unlocking OpenCode's paid
  providers is unchanged. A box whose OpenCode was never signed into still gets
  the free tier, because offering models that fail at launch is worse than
  offering fewer.

## August 25, 2026 - Pin a bot to a specific Claude account (v0.6.13)

- **The bot editor now lets you choose which Claude account a bot runs on.**
  Open Edit bot, then Advanced. The agent row lists Claude - Auto and every
  connected account, the same picker sessions and routines already had. Before,
  a bot always fell back to the automatic account pick.
- Claude - Auto keeps the old behavior. It picks the connected account with the
  most headroom at launch.
- Changing the account is a launch setting, so the bot reads "Update available"
  after you save. The new account applies when you press Apply changes.
- A pinned account that is removed or signed out falls back to Claude - Auto.
  The bot still starts.
- A bot created by another bot inherits that bot's account, the same way it
  already inherits the repo and the owner.

## August 25, 2026 - Tagging a bot with @ now reaches the bot (v0.6.12)

- **An `@` tag in a session chat delivers the message to that bot.** Before,
  the tag was only text and routed nowhere. The tag carries the bot identity,
  so renaming a bot or having two bots with the same name cannot send the
  message to the wrong one.
- The tagged bot joins the conversation from the point it was tagged. It does
  not read the earlier history of that session.
- A tag for a bot that is unknown, disabled, or restarting is reported instead
  of being dropped without a word.
- **Note:** the tagged bot answers in its own chat. Its reply does not appear
  in the session that tagged it.

## August 25, 2026 - Tag a bot with @ in the composer (v0.6.11)

- **Typing `@` in the message box opens a bot picker.** Search your bots by
  name, then press Enter or Tab to insert the tag. The picker is available in
  every composer, including chat and the new-session box.
- The picker skips bots that are disabled, because a disabled bot cannot
  accept a message. It does not open on an email address such as
  `name@example.com`.
- The tag is text in the message. It does not notify or route to the bot yet.

## August 25, 2026 - Mobile chat stays focused and Grok thoughts stay private (v0.6.10)

- **Grok reasoning no longer appears as an assistant answer while it streams.**
  The live protocol now keeps thinking and answer text as separate typed data.
  The fix does not inspect Grok text or depend on provider-specific markers.
- **Mobile chat keeps the hardware keyboard ready after send.** The composer
  retains focus without reopening the software keyboard.
- **Live transcript motion is faster and the keyboard gap is gone.** New chat
  activity reaches the bottom sooner, and the composer no longer leaves an
  empty inset after the mobile keyboard closes.

## August 25, 2026 - Switch bar says Schedules (v0.6.9)

- **The Chat / Bots / Schedules toggle now says Schedules.** The page heading
  already used that word. The third segment was still labeled Scheduled.

## August 25, 2026 - Chat streams more smoothly (v0.6.8)

- **Assistant markdown now uses Streamdown 2.6.** Word-by-word streaming
  animation stays on one timeline, so sibling sections no longer fade in on
  top of each other. The renderer also picks up the 2.6 accessibility and
  download fixes. Long code and tables stay full height, so the transcript
  layout model still matches what you see.
## August 24, 2026 - Bot roster status is quieter (v0.6.7)

- **Unread is one small dot on its conversation row.** Unread rows no longer
  use a blue outline or stronger text. Idle bots no longer show a status chip.
  Working bots use one spinner and keep their latest message preview visible.

## August 24, 2026 - Bot unread state stays quiet (v0.6.6)

- **Unread is now one clear dot.** The highlighted row and stronger text keep
  unread conversations easy to scan without a label that crowds the bot name.
  Working, Idle, and Disabled remain explicit and separate from unread state.

## August 24, 2026 - Bot status and recent conversations stand out (v0.6.5)

- **Bot state is explicit.** Each roster row now labels the bot as Working,
  Idle, or Disabled. Unread conversations have a larger badge, stronger text,
  and a highlighted row. Activity and unread state stay separate, so a bot can
  show both Working and Unread at the same time.
- **The newest bot conversation is first.** The desktop rail and mobile Bots
  page now use the same recency order. Bots with no conversation stay at the
  end.
- **Schedule names have more room on mobile.** The name now has its own line
  instead of sharing a cramped row with the enable switch.

## August 24, 2026 - Chat updates glide instead of jumping (v0.6.4)

- **New messages, tool calls, and the working indicator now move the chat
  smoothly.** A time-based spring follows the live bottom of the transcript.
  Streamed text and tool-status updates no longer cancel that motion and snap
  the view. Changing sessions also no longer paints a provisional transcript
  height that makes the layout flicker before it settles.
- **Computer control now follows the input device.** There is one Take control
  toggle. A mouse points directly, while touch acts like a trackpad. A tap no
  longer blocks the next drag, and agent browser input no longer shows a
  desktop-wide lock that did not protect a shared resource.

## August 24, 2026 - Hosted onboarding answers reach analytics (v0.6.3)

- **The hosted onboarding survey now sends answers through the host.** The
  embedded package previously expected an analytics account at package-build
  time. Release builds do not own one, so the survey event code compiled to a
  no-op. The host now supplies the analytics handler that already identifies
  the signed-in user. Role, friction, daily-tool, AI-tool, completion, and skip
  results can reach the hosted product's existing analytics account.

## August 24, 2026 - The Computer on a phone, and Schedules as a real list (v0.6.2)

- **The Computer survives a restart.** Its lifecycle used to live only in the
  server's memory, so a deploy or a crash left the desktop running with nobody
  holding it: the screen stayed up while the tab went dead, and the next start
  failed because the ports were still taken. A restarted server now reattaches
  to a healthy desktop instead of orphaning it, so a deploy is invisible to
  whoever is watching and to an agent mid-task.
- **Touch works properly.** Dragging moves the pointer by offset, the way a
  trackpad does, instead of teleporting it to wherever your finger landed --
  which on a touchscreen put the target under your own hand. A tap clicks where
  the cursor is. There is a keyboard button, because a canvas cannot take focus
  on iOS and there was previously no way to raise the soft keyboard at all.
- **Opening the Computer starts it.** The Start button is gone: opening the
  page was already the decision, and the progress indicator covers the wait.
- **Schedules is a list you can work.** The enable switch moves to the right
  edge where a thumb already is, the agent icon becomes a quick switch, each
  schedule fits on one line, and the findings banner is gone -- findings have
  their own surface, and a banner about them was the loudest thing on a page
  meant to be a list of schedules.
## August 24, 2026 - Fix the release bundle (v0.6.1)

- **The v0.6.0 release bundle failed to build.** The Computer pulls in noVNC,
  which ships top-level await, and the embedded-library build targeted a browser
  set that predates it. The app build had already been raised; this config was
  missed, so the app was fine and only the release bundle broke.

## August 24, 2026 - The Computer: a desktop you and your agents share (v0.6.0)

- **This box now has a screen you can watch and take over.** The Computer is a
  real desktop -- a window manager, a panel, a file manager, a terminal, and a
  browser -- streamed into the app and controllable from it. Open it from the
  Pages menu, press Take control, and you have the pointer and keyboard. On a
  phone or tablet the usual gestures work: tap to click, two-finger tap for a
  right click, drag to move, two-finger drag to scroll, pinch to zoom.
- **Agents drive the browser on that same screen.** A new Computer Use MCP gives
  them navigate, click, type, press, read and screenshot. Because they work in a
  visible window on the desktop you are watching, you see what they do as they
  do it, rather than reading about it afterwards.
- **Chrome runs headful, not headless.** Headless Chrome announces itself in the
  user agent and is trivially fingerprinted. This is an ordinary browser that
  happens to have no monitor, with a persistent profile, so a site you sign into
  stays signed in and an agent can pick up where you left off.
- **It costs nothing until you ask for it.** No part of the desktop is installed
  by setup, and nothing starts until you press the button. The screen reaches
  the browser over the existing websocket -- no extra proxy process and no new
  runtime dependency.
- **The Computer Use MCP is off by default and separate from the omg MCP.** It
  drives a screen that only exists where the desktop is installed, so it is its
  own catalog with its own switch, next to the omg.dev MCP on the Coding agents
  page rather than buried in Settings.

## August 24, 2026 - Scrolling does what you tell it (v0.5.1)

- **The transcript no longer scrolls itself.** Following the newest message was
  decided by measuring the distance to the bottom on every scroll event. That
  works only while the total height is stable, and it stopped being stable when
  the transcript started keeping only the visible rows in the page: a row that
  comes into view replaces its estimated height with its real one, the total
  moves, and the view could re-pin itself with no new message and no input from
  you. Following is now a stored state that only a real gesture can change.
  Scroll away and it stays away. Scroll back to the bottom, or press New
  activity, and it follows again. A re-measure cannot change it. Nor can a
  prepend, or the page correcting its own position. Keyboard scrolling counts
  as a gesture now, which it did not before.
- **Tool calls send less over the wire.** The arguments of a tool call are no
  longer streamed with the transcript. The name and the count are, which is all
  a collapsed pill shows, and the arguments load when you open one. Measured on
  real sessions this cuts a transcript load by 13 to 31 percent. The trade is
  that opening a pill now waits for one small request.
- **Connection diagnostics are recorded again.** The browser posted five kinds
  of websocket event to a route that had been deleted as unused, so every one
  returned 404 and the client half of the connection record was lost. The route
  is back. Only the browser knows the close code and the retry count, so the
  server could not stand in for it.

## August 24, 2026 - A transcript that stays fast, and can be searched (v0.5.0)

- **Tool-heavy sessions are readable again.** The transcript asked the server for
  80 raw messages, but the screen shows collapsed rows, and one run of tool calls
  collapses into a single pill. A session that was mostly tool work therefore
  arrived as three rows on an otherwise empty screen, and it could not page back,
  because the page did not overflow and the backfill only ran when it did.
  Paging is now measured in rows, so a page always carries enough to read. The
  row rule has one definition that the server and the browser share.
- **A find bar for the transcript.** Virtualization keeps only the rows near the
  viewport in the page, so the browser find command can only see those. Search
  now runs on the server, over the whole session, and jumps to the row that
  matched. It reports how many matches exist, walks forward and backward, and
  keeps loading older pages while it hunts for a match that is not loaded yet.
  It does not take over Control+F, because that would be a hostile default.
- **Sending a message during a reply no longer doubles the reply.** The chat
  library appends a new copy of a message when the incoming update does not
  match the end of the list. Sending mid-reply moved the reply away from the
  end, so a second copy appeared, and the two drew on top of each other. The
  live turn is now kept at the end, and an older copy of it is dropped.
- **Images no longer reload when you scroll back to them.** Off-screen rows are
  removed from the page, so returning to an image used to download it again and
  show the loading pulse again. Images and video now load in the element itself,
  so the browser cache serves them. Video also seeks properly now, instead of
  downloading the whole file first. The hosted surface keeps the previous path,
  because it authenticates with a header.
