# Opening TestFlight to a public link

Prep review done 2026-08-15 against the live account, the live auth box and the
live EAS project. Everything marked VERIFIED was read off the running system,
not off Apple's docs.

## What a public link actually requires

A public link is a property of an **external** test group. That is a different
pipeline from the internal testing that ships today, and the difference is the
whole job:

| | Internal (today) | External + public link (goal) |
|---|---|---|
| Testers | up to 100 ASC users | up to 10,000 strangers |
| Beta App Review | **not required** | **required, per build** |
| Test Information | optional | required |
| Reviewer must sign in | never happens | **yes, every review** |

So the work is not "flip a switch in App Store Connect". It is passing Beta App
Review.

## Current state (VERIFIED)

| | |
|---|---|
| Latest build | `1.0.2 (20)`, EAS `93342e65`, finished 2026-08-15 07:52 |
| Submission | `16b600cb`, finished 2026-08-15 07:58, accepted by ASC |
| Export compliance | `ITSAppUsesNonExemptEncryption: false` in `app.json` — set, no per-build prompt |
| Privacy policy URL | `https://omg.dev/privacy` → 200 |
| Terms URL | `https://omg.dev/terms` → 200 |
| Support URL | `https://omg.dev/support` → **404**. Use `https://omg.dev/contact` |
| Waitlist gate | **OFF** (`waitlist_config.enabled = 0`) — strangers can sign up |
| New-account plan | `free` — 2 vCPU, 4 GB, 16 GB disk, 3 concurrent agents, not always-on |
| Purchase surface in app | ⚠️ **This row was wrong — see "The assessment that was wrong" below.** At HEAD: no purchase CTA (`#114` removed both). In **build 24, the binary Apple is reviewing**: TWO tappable external links — a "Plan & billing" settings row, and "Fix this on omg.dev" on the blocked-Computer screen. |
| Demo account | **live**, with a cloud Computer provisioned — see below |

The waitlist being off is good news: a public-link tester reaches the product
instead of a holding page.

The billing claim above was **false**, and it is worth understanding how, because
the mistake is easy to repeat and this document made it look settled.

## The assessment that was wrong

This file used to state that the app had no purchase call to action, and
concluded it was "clear of guideline 3.1.1". That conclusion was reached by
surveying **one screen** — `app/computers.tsx`, where the billing sentence really
is plain text — and generalising to the whole app. `app/settings.tsx` had a
tappable row the entire time:

```ts
// mobile/app/settings.tsx @ c7774c7 (2026-08-15 13:17 UTC)
const WEB_PAGES = [
  { label: "Plan & billing", path: "/settings/billing" },   // ← rendered by
  ...                                                        //   WEB_PAGES.map
];                                                           //   with onPress
const open = (path) => void Linking.openURL(`https://app.omg.dev${path}`);
```

Guideline 3.1.1(a) prohibits "buttons, external links, or other calls to action
that direct customers to purchasing mechanisms other than in-app purchase" in
every storefront except the United States. omg ships outside the US, so the
exception does not cover it, and that row is the clearest possible example of
what the rule names.

**Timeline, traced to commits rather than inferred from dates:**

| when (UTC) | what |
|---|---|
| 2026-08-13 | the "Plan & billing" row is added |
| 2026-08-15 13:17 | `c7774c7` — last `settings.tsx` change before submission; row present and tappable |
| 2026-08-15 18:11 | **build 24 submitted for external Beta App Review** (per the release session) |
| 2026-08-16 09:48 | `#114` removes the row — **sixteen hours too late for that binary** |

So the build under review contains it. The decision was to let build 24 run
anyway: a beta rejection is not penalising, nothing better existed to submit,
and pulling it would have traded a probable rejection for a certain empty queue.

### The second exposure, found by the check rather than by reading

There were **two**, and the doc originally recorded neither. The first was found
by tracing the settings row. The second was found by *running the enumeration
below* — nobody had looked at that screen — and it is the stronger case.

`app/computers.tsx` at `c7774c7`:

```tsx
{cloudBlocked ? (
  <Row onPress={() => void Linking.openURL("https://app.omg.dev/")}>
    <Text ...>Fix this on omg.dev</Text>
```

gated on:

```ts
// mobile/src/omg/computer-picker.ts @ c7774c7
const BLOCKED_CLOUD_STATUSES = new Set(["upgrade_required", "recycled"]);
```

`upgrade_required` is *"Included computer time is used up"*. So build 24 offers an
external web link **at the moment the user is being asked for money** — which is
what 3.1.1(a) is actually aimed at. The settings row was a link that happened to
reach billing; this one is a paywall exit. It is also the screen a reviewer hits
first on an exhausted demo account.

`#114` fixed it by splitting the question in two, and the distinction is the point:

```ts
// at HEAD
const BLOCKED_CLOUD_STATUSES   = new Set(["upgrade_required", "recycled"]); // can't select
const WEB_FIXABLE_CLOUD_STATUSES = new Set(["recycled"]);                   // may link out
```

Blocked is not the same question as fixable-on-the-web. `recycled` is account
management, so the link survives there; `upgrade_required` is billing, so it does
not. Build 25 is clean on both counts.

### The method failure, which is the reusable part

A survey of one screen was written up as a property of the app. It then sat here
for a day *actively reassuring* everyone who read it — worse than no assessment,
because it stopped anyone looking again.

If you are re-assessing 3.1.1 (or any guideline) here, **do not read a screen.
Enumerate the binary.**

The obvious way to do that DOES NOT WORK, and it is worth knowing why before you
trust it:

```bash
# ✗ MISSES IT. At c7774c7 this prints only bare hosts.
grep -rhoE "https://[a-zA-Z0-9./_-]+" mobile/app mobile/src | sort -u
#   https://app.omg.dev
#   https://auth.omg.dev
#   https://backend.omg.dev
```

No destination appears, because the URL is composed — `https://app.omg.dev${path}`
— with the paths in a separate constant. A grep for literal URLs cannot see a
link assembled at runtime, which is precisely how this one hid.

What works is enumerating the call sites AND the path literals that feed them:

```bash
# ✓ CATCHES BOTH. Verified against the submitted commit.
grep -rnE 'openURL|path: "' mobile/app mobile/src
#   settings.tsx:43:   { label: "Plan & billing", path: "/settings/billing" }       ← exposure 1
#   settings.tsx:125:  const open = (path) => Linking.openURL(`https://app.omg.dev${path}`)
#   computers.tsx:144: <Row onPress={() => Linking.openURL("https://app.omg.dev/")}> ← exposure 2
```

Exposure 2 is the one nobody had read. It surfaced purely because the check has no
opinion about which screen matters, which is the whole argument for running it
instead of reviewing screens.

Two rules that come with it:

1. **Run it against the commit that was submitted, not your working tree.** Use
   `git show <sha>:<file>`, not `git checkout` — a checkout with local edits can
   silently refuse and leave you reading HEAD while believing you are reading the
   build. That happened while writing this section.
2. **Test the check itself against a known-bad commit** before trusting it. The
   first version of this advice was the grep above that misses everything; it
   looked authoritative and would have re-certified the same false conclusion.

## The demo account (was the blocker, now shipped)

The only way into this app is a 6-digit code emailed by better-auth. An App
Review tester is handed an email address and cannot open its inbox, so they
could never obtain the code and would reject under Guideline 2.1 ("we were
unable to sign in"). That blocked external testing entirely, which is why
internal testing has never hurt.

Fixed in `BennyKok/vibes` PR **#1422** (`apps/auth/src/demo-account.ts`),
deployed to `auth.omg.dev` on 2026-08-15 and verified live:

| | |
|---|---|
| Email | `appreview@omg.dev` |
| Code | `823014` — **fixed**, never expires into something else, never mailed |

How it behaves: that one address gets a constant sign-in code instead of a
random one, and its code is never sent to any inbox. Everything else is
untouched — verification still runs through better-auth's normal storage,
expiry and 5-attempt path, so a wrong code is still rejected. It is off unless
both `DEMO_ACCOUNT_EMAIL` and `DEMO_ACCOUNT_OTP` are set, and they live in
`/opt/vibes-auth/shared.env` on the auth box (not in the repo, not in the
deploy workflow).

It is also exempt from the two things that would otherwise strand a reviewer
mid-review:

- **The signup rate limiter.** Verified live: 12 rapid sends for the demo
  address all returned 200 while a non-demo address from the same IP got a 429.
  Without this a reviewer retrying behind one corporate egress IP spends the
  10/hr budget and then hits a send that reports success while doing nothing.
- **The waitlist.** That switch is the capacity lever we would pull when a
  public link overloads the fleet, which is exactly when a review of the next
  build is in flight. Parking the reviewer on a waitlist would fail the build
  meant to fix the overload.

**Operational contract.** The account must own nothing of value. Rotate
`DEMO_ACCOUNT_OTP` after each review round and restart the auth service. Unset
either variable to switch the whole thing off.

**Known side effect.** Demo requests still increment the per-IP counter even
though they are not enforced against it, so a burst of demo sign-ins consumes
the budget of anyone else on that IP. Irrelevant for Apple's reviewers; worth
knowing if you test heavily from an office.

### The demo account needs a Computer, and does not get one by itself

Worth being precise about, because the obvious assumption is wrong. Signing in
is not enough. Checked live with the demo account's own token, against the two
calls the app makes on launch:

    listComputerBindings → {"bindings":[]}
    getCloudComputer     → {"status":"none", ..., "plan":"free"}

A new account has **no** computer. The free plan entitles it to a cloud one, but
the box is only created when something calls `getOrProvisionCloudComputer` —
which the app does on demand, not on sign-in. A reviewer who signs in and pokes
around could easily read that empty state as a broken app.

So one has been provisioned for `appreview@omg.dev` ahead of review:

    status live · instance 0851f402ca71 · free plan · 2 vCPU, 4 GB, 16 GB

`alwaysOn` is false, so it hibernates when idle and wakes on the next visit.
That path is handled (a 425 shows as "waking", not as an error), but it means
the reviewer's first open may take a few seconds. **Check `getCloudComputer`
still reports `live` before each review round**, and re-provision if the
instance has been recycled.

## Test Information to fill in

Required once for external testing, in App Store Connect → TestFlight → Test
Information:

- **Beta app description:**
  > omg runs coding agents on your own computer, or on a cloud computer we host
  > for you. Start a session from your phone, watch it work, send it a follow
  > up, and pick it back up later. This beta is the iOS client for an account
  > you already have at omg.dev.
- **Feedback email:** an address that is actually read.
- **Marketing URL:** `https://omg.dev`
- **Privacy policy URL:** `https://omg.dev/privacy`
- **Sign-in required:** yes. Email `appreview@omg.dev`, code `823014`.
- **Review notes:** say the code is fixed and does not arrive by email, so the
  reviewer does not sit waiting for a message that will never come. Also say the
  account already has a cloud Computer attached and they do not need to pair a
  machine of their own, and that opening it may take a few seconds while it
  wakes.

## Order of operations

1. ~~Ship a way for the reviewer to sign in~~ — **done**, PR #1422, verified live.
2. Fill in Test Information (above). **Needs App Store Connect.**
3. Create an **external** group and attach build `1.0.2 (20)` or later.
4. Submit for Beta App Review. Usually under 24h, and it is per build, though
   later builds of the same version usually pass automatically.
5. After approval, enable the public link and set a tester cap. Start it low.

## Things that will surprise you

**Beta App Review is per build, not per app.** The first external build is
reviewed. Subsequent builds usually inherit approval, but a version bump can
pull you back into review.

**The public link cannot be un-shared.** You can disable it or lower the cap,
but anyone who already installed keeps the build. Start the cap low.

**A public link makes free cloud Computers a real cost line.** Every tester who
signs up can start up to 3 concurrent agents on a 2 vCPU / 4 GB box on the free
plan. That is fleet load nobody is currently forecasting, and box-3 already
holds most of the snapshots. Worth a capacity look before the cap goes up. The
waitlist kill-switch is the lever if it gets away from us, and the demo account
is now exempt from it, so pulling it will not break a review in flight.

**App Store Connect is not reachable from this box.** The session on the Mac's
Chrome profile is expired (`authResult=FAILED`) and re-login needs a password
and 2FA. The ASC API key on this machine, `FBPDXY9TD3`, belongs to a different
account and returns 401 against app `6800792515`. The key named in
`TESTFLIGHT.md`, `P37PJ5VSHN`, lives only on EAS servers, which will not export
a private key. So steps 2 to 5 need either a human login or a freshly minted
ASC API key with its `.p8` saved somewhere this box can read. Minting one is the
durable fix and makes the rest scriptable against `/v1/betaGroups`.
