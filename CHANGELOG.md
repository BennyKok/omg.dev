# Changelog

Recent product updates and deployment notes.

## September 2, 2026 - Custom instructions show in the inspect chip (v0.6.36)

- **The omg.dev instructions chip now shows your standing rules.** Custom
  instructions already went to the agent. The chip only showed the runtime
  contract, so they looked missing. Open the chip on an existing session and
  they are there. No new session is needed.

## September 2, 2026 - Claude Fable 5.1 for the SDK Claude agent too (v0.6.35)

- **The picker has two agents named "claude".** One is the Claude CLI harness.
  The other is the Agent SDK harness, which the interface also labels
  "claude". v0.6.34 added Claude Fable 5.1 to the CLI harness only, so most
  users did not see the new model.
- **Claude Fable 5.1 is now on both.** The Agent SDK accepts the same model
  strings as the CLI, aliases or full ids.

## September 2, 2026 - Claude Fable 5.1 is in the model picker (v0.6.34)

- **You can select Claude Fable 5.1 for a Claude session.** The picker shows it
  as `claude-fable-5-1`, next to the existing `fable` entry.
- **`fable` and `claude-fable-5-1` are different models.** The Claude CLI
  resolves the short alias `fable` to the current Fable release, which is
  Fable 5. There is no short alias for Fable 5.1 yet. The full model id is the
  only way to reach it.
- **A Fable 5.1 session now reports the correct model.** Before this change the
  session view collapsed every Fable id to `fable`. A Fable 5.1 session showed
  Fable 5 as the live model, and a resume moved that session to Fable 5.
- **Fable 5.1 costs more than Opus 5.** The rate is 10 USD for each million
  input tokens and 50 USD for each million output tokens. Thinking is always
  on. Select it for hard work. Do not use it as a default.

## September 1, 2026 - Agents can paste into the desktop browser (v0.6.33)

- **The Computer Use MCP has a new tool: computer_paste.** It puts text on
  the desktop clipboard and sends a real Ctrl+V to the agent's tab. Paste
  handlers fire. Fields that react to paste now work. Verification-code boxes
  that split digits are the common case. computer_type cannot fill them,
  because it never sends a paste event.
- **The text stays on the desktop clipboard.** A person watching the Computer
  tab can paste it again with Ctrl+V.
- **The clipboard write uses xclip, not the page.** No clipboard permission is
  granted to any page. Paste also works on plain-http pages. If xclip is not
  installed, the tool error says how to install it.

## September 1, 2026 - The transcript holds still while you type (v0.6.32)

- **Typing no longer moves the transcript.** The message box measures itself
  after every keystroke. That measurement collapsed the box to zero height for
  one layout pass, which made the transcript above it taller by the full height
  of the box. The browser then pulled the scroll position to the shorter
  maximum, and the transcript snapped back to the newest message. This is most
  visible on a phone, where the message box is a large part of the screen.
- **The measurement now stays inside the message box.** Nothing above the box
  moves while it measures. The box still grows and shrinks with your text.

## September 1, 2026 - The faces move to the right of the header (v0.6.31)

- **The faces are now where the assignee avatar used to be.** They sat under
  the session title. They now sit at the right end of the header, next to the
  model name, which is where people look to see who is on a session.
- **Tapping them still opens the list.** The list is unchanged. It names each
  person and says who owns the session.

## September 1, 2026 - Tap the faces to see who is in the session (v0.6.30)

- **The faces in the header now open a list.** Tap or click them. The list
  names each person and says who owns the session and who is a member. It also
  says who is typing.
- **The blue ring is gone.** The owner had a coloured ring on a 16 pixel face.
  The ring was a quarter of the circle, so it looked like a blue background
  instead of a highlight. The list says "Owner" in words instead.

## September 1, 2026 - The bot is named once in a header, not three times (v0.6.29)

- **A bot no longer appears three times in one session header.** The header
  already carries the bot as the title and as the "driven by" badge. The
  participant row listed it a third time, as a pill between the people. The row
  now shows people only.
- **The faces sit together again.** The bot pill was placed between the two
  people, so the group of faces was split apart. The people are now next to
  each other, and the person the session belongs to keeps the coloured ring.
- **A session with one person and a bot shows no faces.** One person is not a
  group, and the bot is named elsewhere in the same header.

## September 1, 2026 - Custom instructions for every session (v0.6.28)

- **Settings now holds your standing instructions.** Settings has a new "Custom
  instructions" row. It opens a page where you write your rules one time. Every
  new session then carries them, on every agent. Examples are "Ask before you
  push" and "Always run the tests before you say you are done".
- **Your rules do not clutter the session list.** The text travels with the
  omg.dev runtime contract, in front of your task. Session cards and titles
  still show the task that you asked for.
- **Repository files still win.** An AGENTS.md or a CLAUDE.md in the code that
  an agent edits overrules your standing rules, because those files are scoped
  to that code.

## September 1, 2026 - One set of faces on the session header (v0.6.27)

- **The assigned person is no longer drawn two times.** The session header
  showed them in the participant row under the title, and again as a separate
  avatar at the other end of the same bar. There is one group of faces now.
- **The faces overlap, and the assigned person has a coloured ring.** The ring
  carries what the second avatar used to say, so the header gives the same
  information in less space.

## September 1, 2026 - One keystroke, one action (v0.6.26)

- **Shift+E no longer opens two archive dialogs.** When two workspace surfaces
  were alive in the same window, each one handled the same key press. One
  Shift+E asked to archive the session two times, and one "c" started two new
  sessions. The surfaces now agree on one owner for each key press. The owner is
  the surface that you work in.
- **The keyboard picks the surface you touched.** The key press goes to the
  surface that holds the key target, or the focus, or your last touch. Every
  other surface ignores it. The single window app keeps its behavior.

## September 1, 2026 - Clear the findings feed in one action (v0.6.25)

- **Auto agent findings can now be cleared all at once.** The feed had no way
  to empty a backlog. Each finding had to be dismissed one at a time from its
  own sheet. The "Auto" group header now has a "Clear all" button. It asks for
  a second click before it runs, and it names the number it is about to clear.
- **Clearing dismisses. It does not delete.** Your agents still remember what
  you cleared, so they do not raise the same thing again on the next run, and a
  problem that comes back still escalates. High severity findings are never
  silenced this way, so a real outage still reaches you.
- **Clearing obeys the project filter.** When the list is scoped to one
  project, the button clears only the findings it shows you.

## August 31, 2026 - The version shown is the version running (v0.6.24)

- **A box that has downloaded an update no longer claims to be up to date.**
  The update status compared the files on disk against the newest release and
  never looked at the code actually running. So the moment an update was
  written, the box reported itself current while still serving the older
  version, and the person reading it had no way to tell. It now reports the
  version this process is running, and says "installed, starts after a restart"
  for the window in between.
- **The restart you need is offered.** When an update is on disk but not yet
  running, the update prompt appears with a restart rather than going quiet.
  Skipping a download no longer also silences the restart it turned out to
  need, because those are two different things to be told about.
- **The list of what is new stays visible until you restart.** It used to empty
  itself the moment an update landed on disk, hiding the release notes from the
  only person who still needed them.

## August 31, 2026 - Fast mode for Codex and Claude (v0.6.23)

- **Fast mode is now its own switch, for Claude as well as Codex.** Speed used
  to be tied to the Tibo service tier and was available to Codex alone. It is
  now an independent setting in the composer that Claude sessions can use too,
  and it no longer changes your reasoning effort as a side effect: the two are
  set separately.
- **Turn it on from the composer or from the chat.** Use the composer control,
  or type `/fast`, `/fast on` or `/fast off`. Only those exact commands are
  read as commands, so a message that merely begins with the word is still sent
  as a message.
- **Your choice is remembered per provider.** Codex and Claude keep their own
  preference, so turning it on for one does not change the other.
- **Codex offers it only where the model supports it.** The control appears for
  Codex sessions on the GPT-5.4, 5.5 and 5.6 models, and stays hidden elsewhere
  rather than offering a setting that would not apply.
- **Resumed sessions come back with the same setting.** Fast mode, thinking
  level and service tier are now stored with the session, so reopening one
  restores the mode it was running in.

## August 31, 2026 - See who else is in a session (v0.6.22)

- **A shared session now shows who is in it.** An ordinary coding session used
  to look identical whether you were working alone or with three other people.
  It now shows their faces in the header, draws each person's avatar and name
  beside the messages they wrote, and shows a live indicator while somebody
  else is typing. Your own messages are unchanged, and a session you are
  working on alone is unchanged too: with only one person there, no faces and
  no indicator appear at all.
- **A person typing is shown as a person, not as the agent working.** The
  typing indicator for a teammate is separate from the dots that mean the agent
  is producing an answer, so a half-written question from someone else can
  never be mistaken for the agent thinking.
- **Someone typing stays visible across a bot restart.** Presence now follows
  the conversation rather than the individual run behind it. Restarting a bot
  no longer clears everyone from the indicator, and two people looking at the
  same conversation through different runs can now see each other.
- **Faces appear on a self-hosted box, not only a hosted one.** Message avatars
  and the header roster now work the same way in both places. A box with a
  configured roster of users shows them; a box with no roster configured shows
  nothing, exactly as before.
- **Nobody gets the wrong face.** A message is only labelled when the box can
  say who sent it. If two people send the exact same words in one session, that
  turn is left unlabelled rather than guessed at, and a message the box cannot
  attribute renders as it always has.

## August 31, 2026 - Command details open again in the hosted app (v0.6.21)

- **Command details load instead of showing a browser error.** Opening a tool
  pill in the hosted app returned "The string did not match the expected
  pattern." for every command. The transcript no longer carries tool arguments,
  so the panel fetches them per command, and that one fetch used the browser's
  global fetch instead of the transport the host installs. It therefore asked
  the host page's own origin rather than the selected computer, received the
  web app's HTML in place of the answer, and printed Safari's parser message at
  the reader. The panel now uses the host transport like every other request.
  An answer that is not the expected data also reports as a response problem
  now, instead of quoting the browser.

## August 31, 2026 - Pictures hold their place in the transcript while they load (v0.6.20)

- **A picture no longer drops the message below it on top of the one above.**
  An image in the transcript occupied no height at all until it finished
  loading. The transcript only draws the rows you can see, and it places each
  one directly under the measured height of the row before it, so every row
  below a picture was placed against a card that was momentarily a single line
  tall. The moment the picture arrived, that card grew by its full height with
  the next row still inside it, and what that painted was your own message
  drawn over the tail of the reply above it. A picture now reserves the exact
  space it will occupy from the first frame, so nothing below it moves when it
  loads. Measured on a real session at phone width with the image cache off:
  the same row was 42 pixels tall before the picture arrived, and is 426 now.

## August 31, 2026 - An honest token usage inspector and a self-healing session page (v0.6.19)

- **Token usage no longer counts free space as used.** The inspector asked
  Claude for a context breakdown and charted the answer as-is. That answer is a
  layout of the whole context window, not a list of what fills it, so it also
  carries a "Free space" remainder, a reserved autocompact buffer, and tool
  schemas that are advertised but never loaded. All of it was drawn as
  consumption. A session that reported 317k of 1.0M listed categories adding up
  to 1.27M, with "Free space" as the largest single entry, and the bar divides
  by that total, so every proportion was wrong as well. The real Messages row,
  which was almost all of the context, showed as a quarter of the bar. The
  breakdown now counts only what occupies the window. Every one of the 585
  recorded snapshots on the development machine was affected.
- **The mobile transcript appears settled, not mid-move.** A session opened on
  the native app revealed its messages one frame after they arrived, but the
  list keeps correcting its position for up to three seconds, because rows
  mount in batches and an image has no height until it loads. On a real device
  that showed as a transcript parked mid-conversation, with one bubble drawn
  over the tail of the reply above it and the "New activity" pill still up. The
  app now waits for the list to go quiet before it reveals it. A session opened
  while a reply is streaming never goes quiet, so it reveals after 1.2 seconds
  instead of waiting. The opening spinner already covered this moment, so the
  cost is a slightly longer spinner.
- **The session page recovers from a failed code-split chunk.** Safari could
  show "Importing a module script failed." on a session, from the router error
  boundary, and the page stayed broken. Three parts of the session page loaded
  their code without the retry that the rest of the app uses: the chat engine,
  the assistant message renderer and the diff viewer. A chunk that fails to
  arrive now reloads once and recovers. The background warm-up of the chat
  engine no longer reports its own failure as an error, because the page
  re-requests that code when it renders.

## August 30, 2026 - A flat desktop workspace, agent account names, and remote access in Settings (v0.6.18)

- **The desktop workspace no longer draws cards around itself.** The session
  rail and the session stage each rendered as a rounded card with a border, a
  fill and a drop shadow, floating on the app background with a gap between
  them. On a full width window that is chrome around chrome. Both are flat now.
  A single divider line separates the rail from the stage, and the stage runs
  to the window edge. The session header on the stage is 44px instead of 60px,
  because it carries one line of title there. Phones and iPad portrait are not
  affected. They use a different layout that keeps its cards, and the card is
  what makes a stacked list of sessions readable.
- **Coding agents say which account they are signed in as.** Detection could
  only answer whether an account was connected. A machine with several agents
  under different logins looked the same as one machine with a single login,
  and multi-account Claude showed "Claude 1" and "Claude 2", which name
  nothing. Each agent now reads the credential file its own CLI already
  writes and shows the account. No credential material is copied. A profile
  appears only when you connected an account, so a platform API key never
  reports a login you did not make.
- **Settings shows how to reach this server from another device.** A new
  Remote access section gives the local URL, and the Tailscale state of the
  machine with the exact command to serve it over your tailnet.
- **The desktop app keeps scheduled work running after you quit.** The app
  used to attach to any healthy server on loopback and stop its own child on
  exit, which ended schedules with the window. It now owns an isolated
  embedded runtime that stays active after the window closes. A later launch
  reconnects to it. A package update replaces it with the new build.

## August 28, 2026 - A desktop app preview, unread marks for chats, and the DeepSeek Harness (v0.6.17)

- **A chat that landed a reply you have not read now carries a dot.** The
  roster could draw a session working, and it could draw nothing. "Nothing"
  meant finished a second ago, finished and already read, and finished last
  March, all at once, so the one state a person waits for had no mark. The dot
  is per person, so two identities on one box do not clear each other. It is
  held back while the session is working, because it means "ready for you" and
  a session in the middle of a turn is not. It clears when the transcript is
  actually on screen, not when a stored preference says a column is open. The
  row menu has "Mark as read", and the Chat tab carries the same dot that Bots
  already had.
- **An unread row is no longer tinted.** The dot, the tooltip and the screen
  reader label say it. The row tint said it a third time, and a list with a few
  unread sessions in it read as alarmed. Bot rows never had the tint, so the
  two kinds of row now match.
- **There is a desktop app preview for macOS and Linux.** It is a Bun-native
  Electrobun shell that contains the omg.dev web UI and server, so the packaged
  app needs no separate Bun or CLI install. It always starts and owns an
  isolated runtime, even when another omg.dev server is already running. The
  window is shown after its runtime and app are ready. Builds come from the
  `desktop-package` workflow as downloadable artifacts. They are not part of
  this release bundle.
- **DeepSeek Harness is available as a coding agent.** It is in the agent
  catalog, the setup script, and the coding agent adapters, like the other
  harnesses.
- **OpenCode reports the models and variants of your connected providers.**
- **A `codex exec` session is titled by its real prompt.** A non-interactive
  run records its prompt in a form the title scan dropped, so every exec
  rollout fell back to the directory name. A batch of runs in one directory
  produced identical rows in the Live roster and in resume history. The scan
  now falls back to the first user turn in the transcript, and it skips the
  wrapper blocks that Codex injects ahead of the real prompt.
- **A session row hides the assignee badge when it repeats what the row
  already says.**
- **The native iOS client gained the web app's list, session view and
  sign-in.** The subagent tree lines are aimed at the mark they descend from,
  the list can be scoped by folder, and the usage rings open. The client ships
  through TestFlight and EAS Update, not through this release bundle.

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
