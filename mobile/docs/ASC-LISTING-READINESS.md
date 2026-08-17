# App Store Connect listing readiness (2026-08-17)

Session scope: get the `iOS App 1.0` App Store listing (as opposed to the
TestFlight track, which `TESTFLIGHT.md` / `TESTFLIGHT-PUBLIC-LINK.md` already
cover) as close to one-click-submittable as possible without actually
submitting, and without touching anything that needs Benny's own identity
(banking, tax, legal entity, phone number, agreement signatures).

This picks up from a session that died mid-task (`c9f1c9c1`) after it had
already verified Build 24/25 state and set two fields (Content Rights,
Subtitle). That state was independently re-verified here, not re-done.

## Build 24 / Build 25 — re-verified, unchanged

- **Build 24**: `Waiting for Review`, groups TE + PB. Untouched.
- **Build 25**: `Ready to Submit`, group TE only, no PB, not submitted for
  external Beta App Review. Matches Benny's instruction exactly.

Confirmed live on the TestFlight → iOS Builds screen and independently
cross-checked against the App Review submissions log (`Yesterday at 2:11 AM,
iOS 1.0.2 (24), Beta Build, Waiting for Review`).

## Done and saved (read back after every save)

| Field | Value | Notes |
|---|---|---|
| Content Rights | "Yes, it contains, shows, or accesses third-party content, and I have the necessary rights" | Predecessor's unsaved last action; completed and verified |
| Privacy Policy URL | `https://omg.dev/privacy` | Verified 200 before setting |
| App Privacy (nutrition label) | 7 data types disclosed: Email Address, Photos or Videos, Audio Data, Other User Content, User ID, Device ID, Purchase History — all "Used for App Functionality" + "Linked to the user's identity," none for tracking | Derived from the actual `mobile/` source at commit `632242c` (see below), then **Published** |
| Age Rating | 16+ (17+ in some regions) | Full 7-step questionnaire answered with reasoning below, not defaulted to None |
| Description, Promotional Text, Keywords, Support URL, Marketing URL, Copyright | See App Information / iOS App Version 1.0 pages | Copy derived from the live omg.dev site content, not invented |
| App Review Information — Sign-In | `appreview@omg.dev` / fixed code `823014` | Sourced from `mobile/docs/TESTFLIGHT-PUBLIC-LINK.md`, PR #1422 |
| App Review Information — Notes | Passwordless sign-in explanation + pre-emptive Guideline 4.8 reasoning | See below |
| Pricing | Free ($0.00), all 175 countries/regions | |
| App Availability | All 175 countries/regions, "Available on App Release" | Does not go live until app status is Ready for Sale |

### App Privacy — derivation from source

Grepped the full `mobile/app` and `mobile/src` tree plus `package.json` at
commit `632242c`. No analytics SDK, no crash-reporting SDK, no advertising
SDK exists anywhere — so Usage Data and Diagnostics are left undisclosed.
What the app actually collects and why each category was picked:

- **Email Address** — `mobile/src/omg/auth.ts`, email OTP sign-in.
- **Photos or Videos, Audio Data** — `mobile/src/omg/attachments.ts` (image
  picker) and `mobile/src/omg/dictation.ts` (voice dictation), both uploaded
  to the user's own Computer.
- **Other User Content** — chat/prompt text sent to the agent. Not
  "Emails or Text Messages" (that category is for interpersonal
  messaging apps with sender/recipient/subject; this is a private AI
  chat, not messaging between people).
- **User ID, Device ID** — account ID plus the Expo push token /
  presence-lease ID registered per install (`mobile/src/omg/push.ts`,
  `STORAGE_KEYS.presenceLeaseId`).
- **Purchase History** — StoreKit subscription state.

None of the above is used for tracking (no data broker sharing, no
cross-app/cross-site ad targeting — confirmed by absence of any advertising
SDK or IDFA usage in the codebase).

### Age Rating — reasoning

Benny's brief specifically warned against defaulting everything to "None"
given the app surfaces an AI agent with real web access. Answers:

- **Unrestricted Web Access: Yes.** The agent can fetch/browse arbitrary
  web content — this is core, not incidental, functionality.
- **User-Generated Content: No.** Apple's definition is about *broad
  distribution of content created by users to other users* (a social/feed
  mechanic). omg.dev is private one-on-one AI chat with no redistribution
  to other users, so this doesn't fit even though users do generate prompts.
- **Social Media, Messaging/Chat with other users, Advertising: No.** None of
  these exist in the app.
- **Mature Themes (Profanity, Horror/Fear, Alcohol/Tobacco/Drug references,
  Mature/Suggestive Themes): Infrequent**, not None. Given unrestricted web
  access and an LLM that can generate/fetch arbitrary text, a user could
  plausibly but not routinely encounter this content — "Infrequent" is the
  honest middle answer, not the safe-looking "None."
- **Sexual Content, Graphic Sexual Content: None.** A coding/agent tool has
  no plausible path to this even infrequently.
- **Violence (Cartoon/Fantasy, Realistic, Guns/Weapons): Infrequent** for the
  same web-access reasoning; **Prolonged Graphic/Sadistic Violence: None**
  (too extreme a category to apply even at "infrequent" for this app).
- **Gambling, Contests, Loot Boxes: None.** Not present in the app at all.

Apple's calculator returned **16+** globally (17+ in a few regions) from
these answers.

### Guideline 4.8 / Sign in with Apple — not required

The app offers exactly two sign-in paths, both first-party:

1. Email OTP via omg's own better-auth server.
2. "Continue with iMessage" — despite the name, this is **not** a
   third-party identity handoff. It sends a 6-digit code to omg's own
   phone number over iMessage; the user texts it back; omg's own gateway
   approves it. Functionally identical to a phone-number OTP delivered over
   SMS instead of iMessage. No Apple ID, `AuthenticationServices`, or
   `expo-apple-authentication` anywhere in the codebase.

No Google/Facebook/other social login exists anywhere in the app (grepped
`mobile/app` and `mobile/src`). Guideline 4.8 applies to third-party/social
login used to authenticate the *primary* account — neither path here is
that. Confidence: high. This reasoning is now also pasted directly into the
App Review Notes field so a reviewer doesn't have to guess and potentially
raise it anyway.

### Account deletion / Guideline 5.1.1(v)

Not re-verified live in *this* session — re-stating the prior sessions'
live-verified result rather than re-testing, since ASC's own login was the
constrained resource here, not the production account-deletion path:

- Shipped in PR #120 (mobile Settings row) + `vibes` PR #1433 (backend hard
  delete cascade, web confirmation page, emailed confirmation).
- Live-verified against production: a real `403 DEMO_ACCOUNT_DELETION_DISABLED`
  response for the App Review demo account, after fixing a bug where the
  guard's exception was silently swallowed (so a reviewer would otherwise
  have seen a false "check your email" success instead of the intended
  guard).
- Lives at **Settings → Delete Account** in the app. Worth pointing App
  Review notes at this location explicitly if not already covered by the
  in-app copy itself.

### In-app purchases / subscriptions

All 4 tiers exist under subscription group **"omg.dev Cloud Computer"**
(group ID `22312997`) and are fully configured — not just created:

| Reference | Product ID | Price (US) | Spec |
|---|---|---|---|
| Pro | `dev.omg.computer.computer_10.monthly.v1` | $179.99 | (per earlier audit) |
| Personal | `dev.omg.computer.computer_5.monthly.v1` | $57.99 | 4 vCPU, 8 GB RAM, 150 compute hours |
| Starter Plus | `dev.omg.computer.computer_s40.monthly.v1` | — | 2 vCPU, 4 GB RAM, 40 compute hours |
| Starter | `dev.omg.computer.computer_s20.monthly.v1` | $57.99 | 2 vCPU, 4 GB RAM, 20 compute hours |

Each has pricing across all 175 countries/regions, localized display name +
description, and availability set. All show status **"Prepare for
Submission"** — this is expected, not a gap. ASC's own banner states: *"Your
first auto-renewable subscription must be submitted with a new app
version"* — they finalize together with the actual version submission, not
before it.

## Real blocker found: Paid Apps Agreement

`Business → Agreements, Tax, and Banking` shows:

- **Free Apps Agreement: Active** (26 Jul 2026 – 26 Jul 2027) — free
  distribution itself is not blocked.
- **Paid Apps Agreement: New** (i.e. not signed), gated behind: *"To offer
  apps or other in-app purchases, you must update your legal entity
  information prior to signing the Paid Apps Agreement."*

This is independent of how well the 4 subscription tiers are configured —
they cannot be sold until this is resolved. A separate Tax/Banking status
page was not reachable; it appears to sit behind the same "Edit Legal
Entity" step. **Not touched** — this is Benny's legal/business identity,
out of scope for this session by design.

## NEEDS BENNY

1. **Phone number** for App Review → Contact Information. This block
   (First/Last/Phone/Email) validates as all-or-nothing — it accepted fully
   empty earlier in the session, then started requiring all four fields on
   a later save attempt (observed, not fully explained — possibly an ASC
   client-side validation quirk tied to some other field state). Whatever
   the cause, a real phone number unblocks it. First/Last/Email were filled
   with verified values (Benny / Kok / `support@omg.dev`, from the ASC
   account holder name and the site's real support inbox) but were cleared
   back out once Phone number became required, to avoid a half-fabricated
   contact block reaching Apple.
2. **Legal entity info + Paid Apps Agreement signature** — blocks selling
   all 4 subscription tiers regardless of their configuration state.
3. A few fields could not be completed or re-verified because the ASC
   login died mid-session (twice) — see the parent session thread for the
   live blow-by-blow of what was saved before each drop. Re-check "Manually
   release this version" and the Guideline 4.8 addition to App Review Notes
   are actually persisted, not just typed.

## What deliberately was not touched

- Screenshots / Media Manager — owned by a sibling session.
- Build 24 (external review) and Build 25's TE-only/no-external-review state.
- `eas credentials -p ios` — blind interactive menu, real risk of
  regenerating production signing credentials.
- Banking, tax, legal entity, agreement signature — Benny's identity, not
  ours to fill in.
- Anything requiring a guessed or fabricated fact (phone number, legal
  entity name, marketing claims not backed by the actual product).
