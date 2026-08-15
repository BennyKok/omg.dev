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
Review, and this app currently cannot pass it. See the blocker below.

## Current state (VERIFIED)

| | |
|---|---|
| Latest build | `1.0.2 (20)`, EAS `93342e65`, finished 2026-08-15 07:52 |
| Submission | `16b600cb`, finished 2026-08-15 07:58, accepted by ASC |
| Export compliance | `ITSAppUsesNonExemptEncryption: false` in `app.json` — set, no per-build prompt |
| Privacy policy URL | `https://omg.dev/privacy` → 200 |
| Terms URL | `https://omg.dev/terms` → 200 |
| Support URL | `https://omg.dev/support` → **404**. Use `https://omg.dev/contact` |
| Waitlist gate | **OFF** (`waitlist_config.enabled = 0`, 0 rows parked) — strangers can sign up |
| New-account plan | `free` — 2 vCPU, 4 GB, 16 GB disk, 3 concurrent agents, not always-on |
| Purchase surface in app | none. `app/computers.tsx` says "Billing and plans live on the web" as **plain text, not a link** |

Two of those are quietly good news. The waitlist being off means a public-link
tester reaches the product instead of a holding page. The billing line being
plain text rather than a tappable outbound link keeps this clear of guideline
3.1.1, which is what usually bites an app that sells a subscription on the web.

## THE BLOCKER: the reviewer cannot sign in

`src/omg/auth.ts` offers exactly one way in: a 6-digit code emailed by
better-auth (`/email-otp/send-verification-otp` → `/sign-in/email-otp`). There
is no password, no Sign in with Apple, and a grep of `apps/auth/src` finds no
demo, reviewer or test-account bypass of any kind.

An App Review tester is handed an email address and a password in the Test
Information form. They cannot open `itechbenny@gmail.com`'s inbox, so they
cannot obtain the code, so they cannot get past the first screen. Apple rejects
this under App Review Guideline 2.1 as "we were unable to sign in", and it is
one of the most common beta rejections there is.

This blocks external testing entirely. It does not affect internal testing,
which is why it has not hurt yet.

**Nothing else on this list matters until this is solved.**

### Options, cheapest first

1. **A fixed code for one designated demo address.** In
   `sendVerificationOTP` (`apps/auth/src/auth.ts`), when the email equals a
   `DEMO_ACCOUNT_EMAIL` env var, write a static OTP to the `verification` row
   and skip the mail. Roughly ten lines, scoped to one address, removable by
   unsetting the variable. This is what most OTP-only apps ship for review.
   Note it deliberately weakens one account, so that account should own nothing
   and be reset after each review round.
2. **Give the reviewer a mailbox they can open.** Put a real inbox's web
   credentials in the review notes. No code change, but reviewers routinely
   fail at second-hop logins and it hands out live mail credentials.
3. **Sign in with Apple.** Correct long-term answer for an iOS app and removes
   the problem permanently. Much bigger than a TestFlight prep task.

Option 1 is the recommendation. It needs Benny's sign-off because it is a
change to production authentication, so it is not done here.

### The rate limit is a second-order risk

`SIGNUP_IP_WINDOWS` in `apps/auth/src/ratelimit.ts` caps sign-in codes at
**10/hr and 20/day per IP**, and the send reports success even when it refuses.
Distinct testers on distinct IPs are fine. Two things are not: a review team
behind one egress IP, and any burst of testers behind shared NAT. If option 1
lands, exempt the demo address from the limiter too, or the reviewer's second
attempt silently does nothing.

## Test Information to fill in

Required once for external testing, in App Store Connect → TestFlight → Test
Information. Draft copy, edit freely:

- **Beta app description:**
  > omg runs coding agents on your own computer, or on a cloud computer we host
  > for you. Start a session from your phone, watch it work, send it a follow
  > up, and pick it back up later. This beta is the iOS client for an account
  > you already have at omg.dev.
- **Feedback email:** an address that is actually read.
- **Marketing URL:** `https://omg.dev`
- **Privacy policy URL:** `https://omg.dev/privacy`
- **Sign-in required:** yes, plus the demo credentials from option 1 above.
- **Review notes:** say that the app needs a Computer, and that a new account
  gets a free cloud one automatically so the reviewer does not have to pair a
  machine. Without this they may sign in, see no computer, and call it broken.

## Order of operations, once unblocked

1. Ship the demo-account path and verify it end to end against
   `auth.omg.dev` from a device.
2. Fill in Test Information.
3. Create an **external** group in App Store Connect and attach build `1.0.2 (20)`
   (or whatever is current).
4. Submit for Beta App Review. Typically under 24h, and it is per build, though
   later builds of the same version usually pass automatically.
5. After approval, enable the public link on the group and set a tester cap.
   The cap is the only throttle on strangers arriving, so start it low.

## Things that will surprise you

**Beta App Review is per build, not per app.** The first external build is
reviewed. Subsequent builds usually inherit approval, but a version bump can
pull you back into review.

**The public link cannot be un-shared.** You can disable it or lower the cap,
but anyone who already installed keeps the build. Start the cap low.

**A public link makes free cloud Computers a real cost line.** Every tester who
signs up can start up to 3 concurrent agents on a 2 vCPU / 4 GB box on the free
plan. That is fleet load nobody is currently forecasting, and box-3 already
holds most of the snapshots. Worth a capacity look before the cap goes up, and
the waitlist kill-switch is the lever if it gets away from us.

**App Store Connect is not reachable from this box.** The session on the Mac's
Chrome profile is expired (`authResult=FAILED`) and re-login needs a password
and 2FA. The ASC API key on this machine, `FBPDXY9TD3`, belongs to a different
account and returns 401 against app `6800792515`. The key named in
`TESTFLIGHT.md`, `P37PJ5VSHN`, lives only on EAS servers, which will not export
a private key. So every step above that touches App Store Connect needs either a
human login or a freshly minted ASC API key with its `.p8` saved somewhere this
box can read. Minting one is the durable fix and makes the whole flow scriptable
against `/v1/betaGroups`.
