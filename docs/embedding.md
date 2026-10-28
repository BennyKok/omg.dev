# Embedding the OMG application

Every release publishes four packages to npm under the `@omg-dev` scope:

| Package | What it is |
| --- | --- |
| `@omg-dev/protocol` | Shared wire types |
| `@omg-dev/client` | Authenticated HTTP and multiplexed live transport |
| `@omg-dev/react` | Smaller headless / session surfaces |
| `@omg-dev/app` | The exact full OMG application used by the standalone web UI |

```bash
npm install @omg-dev/app @omg-dev/client
```

The four are versioned in lockstep off the release tag and depend on each other
by exact version, so a release installs as one consistent set — `@omg-dev/client`
never resolves against a `@omg-dev/protocol` it did not ship with. Each tag's
tarballs stay attached to its GitHub release too, as the record of what shipped.

React hosts mount the full application with their own transport and asset
origin. OMG keeps its internal navigation in a memory router, so it does not
take over the host product's URL:

```tsx
import { createGrantTransport } from "@omg-dev/client";
import { OmgAppSurface } from "@omg-dev/app";
import "@omg-dev/app/styles.css";

<OmgAppSurface
  transport={createGrantTransport({
    baseUrl: "https://sessions.example",
    getGrant: mintSignedSessionGrant,
  })}
  assetBaseUrl="https://sessions.example"
/>
```

Standalone OMG and embedded hosts therefore render one visual component tree;
only authentication, API origin, and outer product navigation belong to the
host.

## Session navigation

Pass `sessionId` to open a conversation. Changes to this prop after mount use
that same session resolver. Clearing the prop returns to Home. The surface
keeps its router and app mounted, so navigation preserves loaded data and
unsent drafts. An unchanged prop does not override navigation within the app.

## Host slots

A host that embeds OMG as its whole surface has chrome of its own to place, and
nowhere obvious to put it: the embedded layouts suppress the app header, and
the rail's top row and the mobile island are already full.

The wrong answer is to float that chrome over OMG and reserve room for it. That
makes a width constant in the host's stylesheet the source of truth for the box
of a component in the host's tree, checked against a layout in *this* repo, with
the two shipping on independent release cycles. It drifts, and when it drifts
the two pieces of chrome overlap.

So OMG renders empty nodes at the points where it expects host chrome, and the
host portals into them:

| Slot | Where | Extra attributes |
| --- | --- | --- |
| `rail-footer` | Bottom of the desktop rail | `data-lfg-rail-collapsed="true"` when the rail is at 56px, so the host can stack vertically |
| `header-actions` | Inside the mobile header island, before the Pages menu | `data-lfg-host-settings="menu"` when the Pages menu is already offering your Settings, so your own control there is redundant. `data-lfg-host-drawer="footer"` when the phone navigation drawer offers a `drawer-footer` slot |
| `drawer-footer` | Footer of the phone navigation drawer, above Settings | Exists only while the drawer is open. Read `data-lfg-host-drawer="footer"` on `header-actions` to know it is available. A tap inside it closes the drawer |

### Keeping host toasts above the phone chat box

While the phone chat box is on screen, the surface sets `--lfg-host-toast-clear`
on `<html>`: the distance in pixels from the bottom of the screen to the top of
the chat box. It is removed when the chat box goes, and it has no stylesheet
default. A host that draws its own toasts keeps them at least this far up:

```css
bottom: max(var(--your-toast-offset), calc(var(--lfg-host-toast-clear, 0px) + 0.5rem));
```

### Tutorials on the Create page

`tutorials` puts the host's tutorials on the phone Create page, as cards below
the chat box. The surface draws the cards. The host owns the list, each run's
progress, and what Start or Continue does. The phone shows no starter row, so
`starterChips` appear only on the desktop chat box.

A surface can keep the props of its first render, so `tutorials` is a small
store, not a list:

```ts
tutorials={{
  getCards: () => cards,          // same array until the cards change
  subscribe: (onChange) => unsubscribe,
  onSelect: (id) => startOrContinue(id),
  onSeeAll: () => openTutorialsPage(),
}}
```

Each card is `{ id, title, imageUrl, detail, status: "start" | "continue", disabled? }`.

### The tutorial guide card

`composerGuide.card` hands the surface the guide's card. The surface draws it
(`web/src/components/tutorial-guide.tsx`); the host draws no guide chrome of
its own. The card is a block at the top of the composer it names, in the page
flow, so the chat above it gets shorter and nothing is drawn over the chat, the
preview card or the Create page. There is no floating fallback:

- the composer the card names (`surface`, and `sessionId` for a session) shows
  the card;
- the home composer, while the card names a session, shows one row back to it
  ("resume");
- every other composer shows nothing.

While the home composer holds the card, the Create page hides its tutorial
cards, and the getting-started list stays hidden while any card is open. What
to act on next (`focus`: the field, the mic or Send) is ringed in CSS on the
composer's own element (`[data-lfg-guide-focus]` in `index.css`).

```ts
composerGuide={{
  accepts, onDraft, onSent, newSession,
  card: {
    getCard: () => card,            // same object until it changes
    subscribe: (onChange) => unsubscribe,
    onAction: (id) => {},           // an action id, or "fill" | "stop" | "resume" | "hide" | "show"
    renderAvatar: (mood, size) => <Mascot mood={mood} size={size} />,
  },
}}
```

The host owns `collapsed`, because a hidden guide also frees Send. The surface
asks the person to confirm before it sends `"stop"`.

Two host callbacks address settings, and they are not interchangeable:

- `onOpenSettingsPage(page)` — the **machine's** settings pages, for deep links
  like the coding-agent picker.
- `onOpenHostSettings()` — **your own** settings root. This is what the Pages
  menu offers, and supplying it is what sets `data-lfg-host-settings="menu"`.

Wiring the general entry to the machine callback is how it ends up on a
per-computer page behind a machine selector, one back tap from where the person
meant to go.

## Machine switcher

A standalone box draws a machine switcher once it is signed in to omg Cloud:
the last row of the desktop rail, an icon at the top left of the mobile
header, and one menu listing every machine on the account. A host can draw
the same switcher over its own data by passing `machines`:

```tsx
<OmgAppSurface
  transport={transportFor(activeId)}
  machines={{
    machines: [
      { id: "cloud", name: "omg cloud", kind: "cloud", online: true },
      { id: bindingId, name: "MacBook", kind: "connected", online: false, status: "offline" },
    ],
    activeId,
    onSelect: (id) => setActiveId(id),
  }}
/>
```

The surface never reads the box's account under a host, and it never switches
by itself: `onSelect` reports the pick, the host re-renders with a new
`transport`, and the surface follows. Omit `machines` and no switcher is drawn.

```tsx
const slot = document.querySelector('[data-lfg-host-slot="header-actions"]');
if (slot) ReactDOM.createPortal(<YourChrome />, slot);
```

Three rules make this safe across versions:

- **Watch, don't query once.** The slot belongs to a React tree that mounts
  lazily, remounts on host changes, and unmounts entirely when the layout
  crosses a breakpoint. A `MutationObserver` is the honest answer.
- **Keep your fallback.** `querySelector` returns `null` on any OMG older than
  the slot. That is the signal to float chrome the way you did before, not an
  error.
- **An unfilled slot costs nothing.** `[data-lfg-host-slot]:empty` is
  `display: none`, so a host that never portals sees no empty box and no stray
  flex gap.

If a slot lets you stop floating, the clearance you were reserving
(`--lfg-host-top-inset`, `--lfg-host-bottom-inset`) is yours to zero — and
zeroing it belongs to you, not to OMG. OMG cannot know whether you adopted the
slot, and an older host floating over a zeroed inset is the same overlap from
the other side.

## Related

- [embed-host-protocol.md](./embed-host-protocol.md) — the iframe embed contract
  (`?embed=1`), for hosts that frame OMG rather than importing it.

Guide composer callbacks receive an optional third `sessionId` argument for
session inputs. A host must match that ID before filling or counting progress.
`registerFill` callbacks return `true` when a visible input was filled and
`false` for hidden or detached inputs. The `composer-top` session slot exposes
`data-composer-sid` for the same identity check. Session `onSent` fires after
the server accepts the request, before the response stream finishes.
