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

**Not independently re-verified live this session, and its providence is
unconfirmed** — stated plainly rather than re-asserted with confidence
nobody in this session chain actually checked:

- Attempted a live re-check via `app.omg.dev` (the deep-link target from
  `mobile/app/settings.tsx`). It resolved to **Benny's own real, logged-in
  session** (this very platform) rather than an isolated demo-account
  context — ego-browser reuses his login state by design, and there is no
  way to authenticate as the demo account without signing him out, which is
  off the table. Stopped before navigating to `/settings/delete-account` or
  clicking anything; zero state touched.
- The `403 DEMO_ACCOUNT_DELETION_DISABLED` live-verification claim (PR #120
  mobile Settings row + `vibes` PR #1433 backend cascade) predates every
  session transcript available to this one — carried forward as recovered
  context, not something any session in this chain personally re-ran.
- Lives at **Settings → Delete Account** in the app.

**Code-read analysis (read-only, no live account touched), done in place of
the live test above**, at `vibes` tip (`bd571983`,
`apps/auth/src/account-deletion.ts` +
`apps/web/src/components/settings/delete-account-screen.tsx`):

1. **What the demo account actually sees**: not a crash and not a generic
   error. The reviewer reaches the full "Permanently delete your account"
   screen, taps "Delete my account," confirms in the dialog, taps "Send
   confirmation email" — the request goes out normally. The server rejects
   it with HTTP 403 `DEMO_ACCOUNT_DELETION_DISABLED`, and the client
   pattern-matches that message and renders it verbatim as a visible inline
   error (`role="alert"`) under the button: **"This is a shared demo
   account, so it cannot be deleted."** Any other failure falls back to a
   generic "try again" message — only the demo-account case gets this copy.
2. **Server-side only, UI does not pre-gate**: the client never hides or
   disables the delete flow for the demo account ahead of time — it looks
   identical to a real account's flow right up until the confirmation
   request, which is the safer shape for a reviewer (reaching the button
   and being told why beats not finding the button at all).
3. **Is a human-readable message enough?** Already shipped, and close to
   word-for-word what would otherwise be recommended. No code change
   needed here.
4. **End-to-end test coverage, not just a unit claim**:
   `apps/auth/src/account-deletion-wired.test.ts` drives a real better-auth
   instance through its real router with a real session cookie — its own
   doc-comment explains this exists *because* an earlier unit-only test
   passed while the deployed endpoint still silently returned `200`
   (background-task-swallow bug, since fixed) — and asserts HTTP 403, `code:
   DEMO_ACCOUNT_DELETION_DISABLED`, the exact message text, and that no
   verification email was ever scheduled. A second test confirms a normal
   account's deletion still proceeds.

**Conclusion: the reviewer-rejection risk (5.1.1(v) failing because the demo
account can't complete deletion) does not require a code change.** The guard
protects the one shared account App Review depends on, it doesn't block the
reviewer from reaching or using the delete UI, and it explains itself in
plain language at the point of failure. The remaining gap is procedural, not
code: no session in this chain has personally exercised this live, for the
safety reasons above — that's a "needs Benny, or a safer test method" item,
not a "needs a fix" item.

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

## Legal entity — RESOLVED: individual/personal Apple Developer account

**Benny confirmed directly: the Apple Developer account is his personal,
individual account.** The legal entity is Benny Kok personally, not any
company. This resolves the open question below:

- **No D-U-N-S number is required or being looked for.** D-U-N-S is an
  organization-account requirement only; an individual account has no
  D-U-N-S and needs none.
- The "update your legal entity information" banner blocking the Paid Apps
  Agreement means completing **Benny's own personal legal name and
  address** in ASC's legal-entity form — not a company's.
- The individual non-US tax form ASC is expected to present is typically
  **W-8BEN** (individual — not W-8BEN-E, which is for entities). This needs
  to be confirmed against what ASC's flow actually asks for once reachable,
  not assumed in advance. **Never fill in tax or banking details** — that
  stays Benny's regardless of which form appears.

### "Machine Thinking Company" — context only, NOT the Apple entity

A predecessor session found HK Business Registration documents in Benny's
Dropbox under a name different from the original "Use Effect Limited"
assumption (which does not exist anywhere in Dropbox — zero filename or
content matches):

| Field | Value | Source |
|---|---|---|
| Name found | Machine Thinking Company | `Documents/20250401-BR-Machine Thinking Company.pdf` (HK BR Certificate) + `Documents/20250401-Form 1a-Machine Thinking Company.pdf` (the application) |
| Entity type | Individual/sole-proprietorship registration (Form 1(a)), proprietor Kok Chun Hung | same |
| BR Certificate No. | `57966774-000-04-25-9` | same |
| Registered address | 16 Sam Dip Tam, House 57, Lo Wai Village, Tsuen Wan, N.T., Hong Kong | same |
| Validity | Commenced 01/04/2025, **expired 31/03/2026** (lapsed as of today, 2026-08-17) | same |

**This is not the Apple entity and must not be entered into ASC's legal
entity form or referenced as the account holder.** It's kept here purely as
context on what exists in Benny's Dropbox, independent of Apple — the
individual Apple Developer account confirmation above supersedes it for
every ASC purpose. Do not renew this BR on Apple's behalf; it has no
bearing on the Apple side.

Not reported here: the proprietor's HKID/passport number visible on the Form
1(a) — irrelevant to Apple's requirements and not something to propagate.

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

1. **ASC login.** Confirmed dead account-wide as of this session (2026-08-17,
   later pass) — not a mac-chrome-vs-real-Chrome cookie conflict. Re-checked
   with `ego-browser` (his actual authenticated profile — confirmed via his
   live 1Password extension responding), and both
   `appstoreconnect.apple.com/apps/6800792515/appstore` and
   `developer.apple.com/account` redirect straight to Apple's sign-in page.
   This needs Benny to sign back into Apple; no tool-side workaround exists.
2. **Phone number** for App Review → Contact Information — now provided:
   `+852 67762685`. First `Benny` / Last `Kok` / Email `support@omg.dev` are
   ready to re-enter alongside it the moment ASC is reachable; this block
   validates all-or-nothing so all four go in together.
3. **Legal entity info + Paid Apps Agreement signature.** Now unblocked to
   proceed on the legal-entity side per the resolution above (individual
   account, Benny's own personal details, no D-U-N-S). Blocks selling all 4
   subscription tiers until resolved. **The agreement itself is not to be
   signed by any session** — binding contract, Benny's to execute personally.
4. Re-save **"Manually release this version"** and the **Guideline 4.8
   addition to App Review Notes** — both were typed in a prior session but
   the Save click failed because Contact Information (item 2) was empty and
   had just become a hard gate on saving anything else on that page; neither
   change persisted. Needs a full re-type once ASC + Contact Info are both
   in place.
5. **5.1.1(v) account deletion** — see the dedicated section above. No code
   change needed (verified by reading the guard + its wired test); the open
   item is procedural — no session in this chain has personally exercised
   the live flow, and the obvious way to do so (this session's browser
   access) resolves to Benny's own real account, not the demo one.

## What deliberately was not touched

- Screenshots / Media Manager — owned by a sibling session.
- Build 24 (external review) and Build 25's TE-only/no-external-review state.
- `eas credentials -p ios` — blind interactive menu, real risk of
  regenerating production signing credentials.
- Banking, tax, legal entity, agreement signature — Benny's identity, not
  ours to fill in.
- Anything requiring a guessed or fabricated fact (phone number, legal
  entity name, marketing claims not backed by the actual product).
