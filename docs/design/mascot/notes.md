# Mascot direction notes

Companion to `concepts.html`. Starting point: the current mark is a minimal
one-eyed cream orb (big off-white circle, single dark pupil upper-right) on a
warm-brown gradient rounded tile — a semi-mascot, not yet a character. Bot
Mode gives every bot an avatar; the ask is to evolve the orb into something
with enough range to carry expression across four+ product surfaces without
turning into a generic rounded-square icon. Four directions below, each
explored as a full system (expressions, working state, favicon scale,
per-bot variation) in `concepts.html`.

---

## A — The orb grows a body

**Rationale.** The smallest possible step from what already ships: same
cream orb, same pupil logic, plus two small feet peeking out from underneath.
It reads as a creature standing on the tile rather than a glyph filling it,
which is what "mascot" needs that "icon" doesn't — something that can be
imagined walking into a room. The feet are the only new geometry; everything
else (fill, flatness, proportions) is inherited from the current mark, so
existing brand recognition carries over almost entirely.

**Where it appears.** App icon (feet can be dropped at the outermost crop —
see tradeoffs) and favicon; bots roster empty state and per-row avatars,
where the standing posture reads well at 44px; a loading/404 page where the
body can be given a subtle idle sway; typing indicator as a tiny bouncing
version of itself. Less suited to the in-chat "working" pill, which is
usually a flat row — the feet add height that a one-line chat UI doesn't
have room for.

**Tradeoffs.** Honest cost: the feet are the first "body part" this mark has
ever had, and body parts invite more body parts — arms next, then a mouth,
and two years from now it's a generic blob-with-limbs mascot indistinguishable
from a dozen other startups'. It also complicates the tile edge: the current
icon fills its rounded-square almost edge to edge, and feet either have to
overlap the orb (reads a little cramped at 16px, confirmed in the favicon row)
or shrink the orb to make room (loses presence). Accessories (monocle,
headset) for per-bot variation work well but add visual noise at the smallest
sizes — reserve accessories for 44px+ contexts and fall back to color/pupil-
only variation for favicon-scale bot avatars.

---

## B — Pure eye, pure expression

**Rationale.** The opposite bet: no body, ever. Everything the character
feels — happy, thinking, asleep — comes from the pupil, the lids, and
squash/stretch of the orb's own outline (flattened for a blink, squashed
wide for happy, stretched tall for thinking). This is the direction closest
in spirit to the current mark, which makes it the lowest-risk evolution: it's
legible as "the same mascot, more expressive" rather than "a new mascot."
It's also the one direction that was built, in the concept sheet, to
demonstrate it survives 16px — because it has no extra geometry to lose,
it's the strongest performer at favicon scale of the four.

**Where it appears.** Everywhere the current icon already lives (app icon,
favicon, browser tab) with no compositional change, so it's the safest
default avatar and the best fit for the "driven by ⟨bot⟩" badge in the
session rail, which is small and needs to stay legible next to text. Also the
natural fit for the typing indicator — a squash-stretch "breathing" loop
between neutral and a slightly squashed state reads as alive without adding
motion complexity.

**Tradeoffs.** It's the least distinctive of the four *as a character* —
without a body, it's harder to build merchandise, spot-illustrations, or a
"the bot is thinking" full-scene moment out of it later. Squash/stretch also
depends entirely on implementation quality; done in CSS transforms (as in the
concept sheet) it's cheap, but sloppy timing makes it read as a rendering bug
rather than personality. Per-bot variation is necessarily subtle (pupil shape
and orb tint only), which is a feature for a professional product but a
limit if bots are meant to feel more individually ownable.

---

## C — The orb as a screen / terminal

**Rationale.** Reframes the eye as content displayed on a device rather than
a face — a rounded-square bezel that echoes the app-icon tile shape, a dark
screen, and the eye rendered in a glowing phosphor color with a CRT stand.
This is the direction that ties most literally to "agent," "computer," and
"terminal" — the actual domain — rather than to a generic cute-creature
trope. The idle state stops being sleep/zzz and becomes a blinking text
cursor on a dark screen, which is a much more on-brand idiom for a coding
agent than a cartoon "asleep" gag, and doubles as a loading-state motif for
free.

**Where it appears.** Strongest fit for the per-bot default avatar (each bot
is legitimately "a terminal with a personality," and phosphor-color variation
— amber/green/cyan — gives instant, meaningful differentiation, like classic
terminal color schemes) and for a 404/loading screen, where a "screen with a
blinking cursor" is a natural empty state. Weaker fit for the app icon itself
— it now competes with the *actual* rounded-square tile shape the app icon
already uses, so the mascot and the icon frame start to look like two nested
devices, which reads busy at 16–24px (confirmed in the favicon row: legible
but the ring-in-a-screen-in-a-tile nesting loses definition faster than
A, B, or D as size drops).

**Tradeoffs.** Most novel of the four relative to the current mark, so it
carries the most brand-recognition risk — regular users of the product may
not immediately connect it to "the eye." It's also the most literal skeuomorph
in the set (CRT stand, scanlines, bezel) at a moment when the rest of the
product is a flat iOS-style UI; it works as a deliberate genre shift but
needs to be used consistently everywhere or it'll feel like a mismatched
one-off. Cheapest of the four to keep "on" as an ambient idle state, since
the cursor blink is a single CSS animation with no dependency on chat state.

---

## D — Gradient spin, tied to the lfg brand mark

**Rationale.** Everything else in this set stays in the warm-brown family the
current icon already uses; this direction asks what the mascot looks like if
it borrowed the *other* half of the brand instead — the blue→cyan gradient
from the `lfg` wordmark tile (`web/public/icon.svg`). Structurally it's the
same pure-eye body as B (no body, squash/stretch), but the tile carries the
brand gradient and, as the signature move, the pupil itself is gradient-
filled rather than flat ink — a small but legible echo of the wordmark's
color identity living inside the character's eye.

**Where it appears.** Proposed as the *system* mascot rather than a
per-bot skin: the default avatar for bots that haven't been customized, the
mark used in first-run/onboarding and marketing contexts where the product's
blue is doing the talking, and anywhere the mascot sits next to the `lfg`
wordmark and needs to visually belong to the same family instead of clashing
warm-vs-cool. Per-bot instances rotate the gradient hue (violet→pink,
teal→lime) while keeping the two-stop-gradient identity, so a whole roster of
"branded" bots reads as one species distinct from the warm-brown default
bots.

**Tradeoffs.** Runs directly into the fact that the *existing* one-eyed orb
is deliberately warm brown, matched to a dark, almost-analog palette that
reads calmer than the brighter iOS blue used everywhere else in the UI
chrome. Making the mascot brand-blue risks it disappearing into the rest of
the interface — buttons, links, and focus rings are already that exact blue,
so a same-colored mascot has less contrast to be *noticed* by against its own
app. Best used deliberately as the minority/system case (one blue mascot
among many warm ones, marking "this one is special/default") rather than as
the universal default, which would flatten the visual hierarchy it's meant to
create.

---

## E — The living dot

**Rationale.** Every other direction treats the mascot as an avatar that sits
*next to* the product name. This one collapses that distance to zero: the
"." in the `omg.dev` wordmark isn't a period next to the mascot, it *is* the
mascot, drawn at exactly the size and position a period would occupy. The
character only becomes legible as separate from the type when it wants to —
a "detach" beat where the dot lifts off the baseline, squashes/stretches
through a mid-air anticipation pose, and lands standing as the full
character. This is the one direction whose novelty isn't in the body at all
(it deliberately reuses B's pure-eye anatomy unchanged, per the brief) — the
idea is entirely structural: mascot-as-typography rather than mascot-next-
to-typography. It's the most literal answer to "make the wordmark feel
alive" of anything in this set.

**Where it appears.** The wordmark lockup is the header/marketing use: any
place `omg.dev` is set in text at a large enough size for the dot's pupil
offset to register (confirmed down to ~22px cap-height in the concept sheet
— below that it degrades gracefully to reading as a plain period, which is
the correct fallback, not a failure). The detach sequence is a motion-only
asset — a loading transition, an empty-state animation, a first-run
moment — not a static UI element; it has no home as a still image. Once
detached, the character is just Direction B, so it inherits all of B's
placements (app icon, favicon, "driven by" badge, typing indicator) — this
direction spends its effort entirely on the *transition into* B rather than
building a competing static system.

**Tradeoffs.** The wordmark lockup is a real typographic commitment: it only
works if the mascot always sits inside "omg.dev" set in *this* typeface at
*this* weight, which means any wordmark redesign (a licensed display face
for marketing, a condensed lockup for a tight nav bar) forces a re-fit of
the dot's size and baseline offset, or the trick breaks. It's also the
direction hardest to keep consistent across surfaces that don't render the
literal string "omg.dev" — a bots roster row, a per-bot avatar, a favicon
tab — those all have to fall back to being "just Direction B," so the
signature idea (the wordmark relationship) never appears in the majority of
the product's actual UI, only in headers, marketing, and loading states.
The detach animation is also the most implementation-fragile asset in this
whole document: it's convincing as 4 hand-tuned keyframes in a static sheet,
but a sloppy real easing curve (wrong timing on the squash, a linear
instead of anticipation-eased lift) will read as a layout bug — text
reflowing — before it reads as a character animation, which is a worse
failure mode than a bad squash-stretch loop on an idle icon (B's equivalent
risk) because a wordmark is something users have implicit pixel-perfect
expectations about.

---

## F — The eye shows what it's watching

**Rationale.** Every other direction (including the per-bot variation
mechanics in A/B/C/D) puts individuality on the *outside* — an accessory,
a squash amount, a bezel color, a hue. This direction asks what happens if
individuality lives *inside* the pupil instead: the pupil becomes a
porthole, and what's rendered through it — a radar sweep, an envelope, a
terminal cursor, code brackets, a filing drawer — is a small live-feeling
scene that tells you what the bot is actually for, not just that it's been
assigned a color. It's the most literal answer to "the bot is watching
something" of anything explored here, and it's the only direction where a
glance at the pupil alone (not the body, not the tile) answers "what kind
of agent is this." The working state (code lines scrolling past inside the
porthole) and idle state (the porthole dims to a plain ember) are the same
mechanic applied to *time* instead of role — the porthole shows what the
bot is doing right now, not just what it does in general.

**Where it appears.** Strongest wherever a bot's role is the thing worth
signaling at a glance and the avatar is rendered large enough to carry it —
the bots roster row (`size-11`, 44px, per `bot-mode/spec.md` §3.2) and the
bot chat header (`size-8`, 32px) are both comfortably above the ~20px floor
where the scene reads. Weakest exactly where every other direction is
strongest: the favicon. The concept sheet's own 16px row is the honest
verdict on this — porthole detail does not survive to 16px, so the
direction ships with an explicit, designed fallback (a plain tinted pupil,
no scene) for anything at favicon scale, rather than pretending the detail
holds up. That fallback needs the base per-role *tint* to already exist
independent of the scene content, which the concept sheet builds in as a
first-class property of each role rather than an afterthought.

**Tradeoffs.** This is the most expensive direction to keep looking
intentional: five hand-designed scene glyphs (and growing — every new bot
role is a new miniature illustration problem, not a hue rotation or an
accessory swap like every other direction's variation mechanic) plus a
"working" animation that has to be built once per scene style, since a
scrolling-code motif that reads as "processing" for an Ops/Builder bot
doesn't obviously mean the same thing rendered inside an Archivist's
drawer-icon pupil. It's also the direction most likely to fight the "one
species" instinct from the role-trait matrix below — if the pupil is
already carrying a fully custom illustration per role, the temptation to
let the *body* vary per role too (Grok Bot's approach) will keep coming up,
and holding the line that the orb stays identical while only the porthole
changes is a discipline call that has to be re-litigated every time a new
role is proposed, not something the geometry itself enforces.

---

## Role-trait matrix — one species, individual traits

**Rationale.** This is a deliberate counter-design, not a fifth direction.
Grok Bot (and most competitor "AI team" products) gives every role a
different silhouette — a wrench-shaped coder, a magnifying-glass-shaped
researcher — which reads as a sticker sheet: recognizable per-icon, but the
set doesn't cohere as one character with different jobs, and it doesn't
scale past however many silhouettes someone was willing to draw. The matrix
takes the opposite bet: every role sits on the *exact same orb silhouette*
(Direction B's body, unmodified) and is told apart using only the three
trait axes this document already proved out piecemeal — pupil geometry
(B's ring/diamond pupils), tint family (C's phosphor colors, D's hue
rotation), and an idle-behavior description (every direction's sleep/idle
state, reframed as a one-line caption instead of an animation). Naming six
archetypes (scout, builder, ops, archivist, inbox, guard) against those
three axes in one grid is the argument made concrete: the system already
had enough range to do per-role identity without a body redesign, it just
hadn't been assembled into one place before.

**Where it appears.** This is the recommended mechanic for *any* screen that
has to represent many bots as a set and needs them to stay legible as
members of one family — the bots roster (multiple rows, same silhouette,
scannable by tint+geometry), a bot-picker/assignment UI, or a settings
screen listing role presets. It is explicitly not a replacement for
Direction F: the matrix is a *body*-level system (silhouette + pupil
geometry + tint), F is a *content*-level system (what's rendered inside
the pupil). They compose — a scout bot could use F's radar-sweep porthole
content *and* the matrix's ring-pupil-geometry/green-tint framing at
different sizes, the ring geometry being what survives down to 16px once
the porthole detail (F's own documented weak point) has degraded away.

**Tradeoffs.** Six geometric pupil shapes is already pushing what reads
cleanly at small sizes — the 16px row in the concept sheet shows tint doing
most of the actual disambiguation work at that size, with geometry as a
secondary confirm once you're looking for it, not the primary signal the
larger sizes suggest it is. That's an honest limit, not a bug: it means tint
is the load-bearing trait for glanceability and geometry is the load-bearing
trait for "this is deliberate, not just a color," and losing either one
weakens the set. It also caps out around six-to-eight roles before shapes
start repeating or getting too fussy (a heptagon reads as "slightly wrong
hexagon," not as a seventh distinct thing) — worth confirming with product
whether six archetypes is actually the ceiling or just the current list,
because the matrix's whole pitch is "one species, N traits," and it quietly
stops being true once N exceeds what six-ish simple polygons can carry.
Guard's shield tint (`#ff453a`) is drawn directly from the product's
existing `--destructive` token rather than a new color choice — worth
keeping that mapping intentional (guard = the one role allowed to borrow
the "danger" red) rather than incidental if this ships.

---

## Cross-direction call

If forced to ship one now: **B for the base system, C for per-bot default
avatars.** B is the lowest-risk evolution of the existing mark and the only
one proven to hold up cleanly at 16px, so it should own the app icon,
favicon, and "driven by" badge — the places brand recognition matters most.
C's phosphor-color variation is a genuinely better "species" mechanic than
anything else explored here for giving individual bots a distinct, ownable
identity without asking users to make a design decision, so it's worth
reserving for the bots roster and bot chat header specifically, even though
it's the least safe choice for the app icon itself. A and D are both strong
enough to prototype further but read as *variants of B* rather than fully
separate systems — A when the product wants more personality (marketing,
empty states), D when it wants to borrow the brand's blue for a system/
default distinction.

---

## G — Morphing pure eye (see motion.html)

Benny's picked direction, taken into motion in `motion.html`. Same
one-eyed anatomy as B (cream orb, dark pupil, no body parts), but each
bot's identity is a distinct home *silhouette* — circle, squircle,
teardrop, pebble, hexagon — and the silhouette continuously, organically
morphs rather than sitting static. The eye is the constant; the body
shape is the individual; the movement is the personality. See
`motion.html` for the live prototype: idling home shapes, a state theater
(idle/thinking/working/error/sleeping as pure deformation), a shape-to-
shape morph demo, mouse-tracking pupils, and a small-size survivability
check.

**Design review fixes (2026-08-16).** A senior design pass on the
prototype found four high-severity issues and four medium ones; all eight
are fixed in `motion.html`. Sleeping's puddle radii were rebuilt so the
body reads as one bottom-heavy resting mound instead of two lobes pinched
at both poles ("mitosis, not sleep"). Light theme gets a warm outline
stroke on the body silhouette (dark theme untouched) since the cream fill
was ~1.07:1 against a white card. Reduced-motion state changes now force
one immediate re-render of the body path and pupil — previously only
lid/tilt updated because nothing was driving the (deliberately paused)
rAF loop. Hexagon, teardrop, and pebble were reworked (crisper vertex
amplitude, a narrower/aligned teardrop point, a genuinely irregular
pebble array) plus a global Catmull-Rom tension tweak (6 → 8) and a
lower home-row idle wobble (0.05 → 0.03) so silhouette identity survives
the smoothing/wobble that was swamping it. Error is now a sustained,
trembling "distressed" hold instead of a 230ms blink-and-miss, and its
recovery `setTimeout` is tracked and cleared on any state change instead
of racing a later click. The scroll listener behind `refreshCenters` is
gone (cached page coordinates are scroll-invariant, so it was pure
layout thrash); load/resize caching is unchanged. `Creature` now has a
`destroy()` (clears its blink timer, drops it from the tick registry) as
groundwork for a reusable component, noted in the footer credits.

**Correction round (2026-08-16).** Benny rejected the naked-on-page look:
every creature in `motion.html` now sits on the same warm brown/orange
gradient rounded tile as `concepts.html` and `omg-icon.png` (`#7a4127` ->
`#150b08`, ~23%-of-width corner radius), sized to the SVG's full padded
viewBox so spring-overshoot and the error spike stay clear of the tile
edge; the tile is a static backdrop, only the body morphs. The light-mode
`.c-body` outline stroke and `.plain16-body` border from the prior fix
round are removed — the fixed-color tile carries contrast in both themes
without a theme-specific override.

**Colorway support (2026-08-16).** Added a five-colorway system (Warm/Brand/Violet/Forest/Midnight — tile gradient + body + pupil, following `concepts.html`'s blue→cyan/violet→pink/teal→lime/phosphor precedents) applied via `cw-*` classes: the home-shapes row now shows shape × color as combined identity, and the morph demo gets clickable swatches that recolor the creature live without disturbing the running shape morph.
