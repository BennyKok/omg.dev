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
| `header-actions` | Inside the mobile header island, after the Pages menu | — |

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
