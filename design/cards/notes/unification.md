# omg.dev UI unification — decisions behind this design system

Synced from the `lfg` repo (`design/` directory). Token values are extracted
from `web/src/index.css` and are the live production values, not aspirational
ones.

## The problem

Three surfaces grew three separate visual systems:

- **Settings** had the strongest spec: grouped `rounded-2xl` cards, 28px icon
  chips, uppercase section labels, chevron rows.
- **Dashboard (Live)** invented its own row shapes, and the sidebar carried a
  second "recently shipped" card style.
- **Notification Center and the Shipped page** were two destinations for one
  concept, each with its own row anatomy, its own read-state logic surface,
  and its own polling UI.

## The decisions

1. **Settings' grouped-list spec is promoted to the app-wide standard.**
   Every list on every surface is a `group-card` of `row`s:
   leading 28px chip (or avatar/dot) · title/subtitle body · one trailing
   element. No surface defines its own list shape.

2. **Notification Center + Shipped merge into one "Activity" surface.**
   Asks, shipped posts, and auto-agent findings share one row anatomy
   (see Patterns → Activity row). A segmented All/Asks/Shipped filter
   replaces separate destinations. Read state = title weight + right-rail
   dot. Media is one 52px trailing thumb, never a grid.

3. **The dashboard stops hosting feeds.** One bell with a count badge is the
   only notification chrome on Live. "Recently shipped" is two rows in a
   standard group card ending in "All activity".

4. **Three top-level tabs: Live, Activity, Settings.** Term, usage, storage,
   and other pages nest inside those three.

5. **One state vocabulary.** busy=warning pulse, idle=success ring,
   unread=primary, off=muted — the same tones drive status dots, metric
   bars, and badges. No fourth color.

## Iterating here

Edit cards in this project freely; the `design/` directory in the repo is the
build source (`bun design/build.ts` inlines `tokens.css` into `dist/`).
When a card design settles, port the change back into `web/src` — tokens map
1:1 onto the CSS variables in `index.css`.
