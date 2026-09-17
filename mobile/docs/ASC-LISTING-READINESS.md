# App Store Connect listing readiness (2026-08-17)

> **THIS REPOSITORY IS PUBLIC. DO NOT WRITE SECRETS OR PERSONAL DETAILS HERE.**
>
> No sign-in codes, no passwords, no API keys, no personal phone numbers or
> addresses. App Store Connect is the source of truth for all of it, and a
> value copied here is a value published to the internet.
>
> This is not hypothetical. Two leaks were removed from these files on
> 2026-09-17: Benny's mobile number, and the App Review demo account's fixed
> sign-in code. The code had been public since 2026-08-15 and still worked
> when it was found. Both arrived the same way, as a helpful note in a
> status table.
>
> Record *where* a value lives, never the value.

Session scope: get the `iOS App 1.0` App Store listing (as opposed to the
TestFlight track, which `TESTFLIGHT.md` / `TESTFLIGHT-PUBLIC-LINK.md` already
cover) as close to one-click-submittable as possible without actually
submitting, and without touching anything that needs Benny's own identity
(banking, tax, legal entity, phone number, agreement signatures).

This picks up from a session that died mid-task (`c9f1c9c1`) after it had
already verified Build 24/25 state and set two fields (Content Rights,
Subtitle). That state was independently re-verified here, not re-done.

## Build 24 / Build 25 — re-verified

- **Build 24**: now **`Approved`** (was `Waiting for Review` earlier the same
  day) — Apple's own review team moved this state; no session in this chain
  touched build status, groups, or submission on either build. Groups still
  TE + PB, unchanged.
- **Build 25**: `Ready to Submit`, group TE only, no PB, not submitted for
  external Beta App Review. Matches Benny's instruction exactly, unchanged.

Confirmed live on the TestFlight → iOS Builds screen (screenshot taken this
session) in a later pass the same day as the initial re-verification below.

## Done and saved (read back after every save)

| Field | Value | Notes |
|---|---|---|
| Content Rights | "Yes, it contains, shows, or accesses third-party content, and I have the necessary rights" | Predecessor's unsaved last action; completed and verified |
| Privacy Policy URL | `https://omg.dev/privacy` | Verified 200 before setting |
| App Privacy (nutrition label) | 7 data types disclosed: Email Address, Photos or Videos, Audio Data, Other User Content, User ID, Device ID, Purchase History — all "Used for App Functionality" + "Linked to the user's identity," none for tracking | Derived from the actual `mobile/` source at commit `632242c` (see below), then **Published** |
| Age Rating | 16+ (17+ in some regions) | Full 7-step questionnaire answered with reasoning below, not defaulted to None |
| Description, Promotional Text, Keywords, Support URL, Marketing URL, Copyright | See App Information / iOS App Version 1.0 pages | Copy derived from the live omg.dev site content, not invented |
| App Review Information — Sign-In | `appreview@omg.dev`, plus a fixed code held only in App Store Connect | The code is deliberately not in this repository, which is public. Read it from the version's Sign-In Information field |
| App Review Information — Notes | Passwordless sign-in explanation + pre-emptive Guideline 4.8 reasoning | See below |
| Pricing | Free ($0.00), all 175 countries/regions | |
| App Availability | All 175 countries/regions, "Available on App Release" | Does not go live until app status is Ready for Sale |
| App Review Information — Contact Information | First `Benny`, Last `Kok`, Email `support@omg.dev` | The block that gated saving anything else on the page, twice, across two prior sessions. Filled, saved, and confirmed by a **hard page reload** reading the same four values back from the server, not just client state. **The phone here was wrong until 2026-09-17** (recorded as `...2685`, actually `...2586`). Benny confirmed the App Store Connect value is the correct one. So the reload "confirmation" above did not actually compare digits, it compared a memory of them. Re-read this row from the field before quoting it |
| App Store Version Release | "Manually release this version" | Radio confirmed checked after the same hard reload |
| App Review Information — Notes, 4.8 addition | **SUPERSEDED IN ASC, AND THIS ROW WAS WRONG ABOUT IT.** Appended: "iMessage sign-in is a first-party phone-number OTP delivered over iMessage — the user texts a code to omg's own number, approved by omg's own gateway. The app integrates no third-party or social login." | Was confirmed present, verbatim, after the same hard reload. The quoted text describes a build that no longer exists. **It is no longer in the live field**: read directly out of the `notes` textarea in App Store Connect on 2026-09-17, the live note now says "the sign-in screen offers Sign in with Apple, Sign in with Google, and a first-party email one-time code ... Sign in with Apple is offered as an equivalent option alongside Google, per 4.8." Somebody corrected it and did not update this row. Nothing further is needed here. (One in-flight mistake caught before saving: a first attempt via the wrong input helper typed the literal string "@1425" into the field instead of the note text — caught via a value read-back, fixed with a direct DOM value-set + `input`/`change` events, re-verified, then saved.) |

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

### Guideline 4.8 / Login Services — IN SCOPE, and satisfied

Re-verified against the code and against Apple's current 4.8 text on
2026-09-17. **The previous version of this section was wrong on every
point and had been pasted into the live App Review Notes field.** Read the
correction note at the end before trusting anything here.

What the app offers today (`mobile/app/sign-in.tsx` and
`mobile/src/omg/onboarding-signin-drawer.tsx`, both calling
`mobile/src/omg/social-sign-in.ts`):

1. Email OTP via omg's own better-auth server.
2. Sign in with Apple (`expo-apple-authentication`).
3. Google Sign-In (`@react-native-google-signin/google-signin`).

Google Sign-In sets up and authenticates the primary account, so 4.8
applies. It is satisfied, not avoided: 4.8 requires an equivalent option
that limits collection to name and email, lets the user keep the email
private, and does not collect in-app interactions for advertising without
consent. Sign in with Apple meets all three and ships in the same two
places as Google.

One deployment caveat, because it decides whether a reviewer sees the
Google button at all: `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` is inlined at
bundle time and lives only in the `eas.json` build profiles. A bundle
built without it renders no Google button. `.github/workflows/mobile-ota.yml`
carries it into OTA bundles and asserts on it for exactly this reason.

**Correction note.** Until 2026-09-17 this section stated that the app
offered "exactly two sign-in paths, both first-party", that the second was
"Continue with iMessage", and that there was "No Apple ID,
`AuthenticationServices`, or `expo-apple-authentication` anywhere in the
codebase" and no "Google/Facebook/other social login ... anywhere". Every
one of those is now false. Apple and Google sign-in landed in `1861b8f29`
on 2026-09-03; iMessage sign-in is gone entirely (`grep -rn iMessage
mobile/app mobile/src` returns one unrelated comment about bubble
animation). The section was never revisited after that commit, and its
text had already been copied into the App Review Notes field in App Store
Connect, where it still asserts that the app "integrates no third-party or
social login" while the binary ships an Apple button.

**The live field was already fixed by somebody, and this document did not
know.** Read directly out of App Store Connect on 2026-09-17 over CDP
against the Chrome profile at `/home/dev/.omg/computer/chrome-profile`
(port 9222), the `notes` textarea is 1741 characters and contains no
"third-party or social login" sentence and no mention of iMessage. It
names Sign in with Apple, Google and the email code, and states the 4.8
position correctly.

**The lesson is the one already written at the top of this file, and it
was ignored anyway.** An earlier pass of this very session told Benny the
live field was wrong and asked him to change it, on the strength of this
document rather than the field. Read the field. This document is a cache,
and it has now been stale in both directions.

### Export compliance and app icon — confirmed live in ASC, not just locally

Local check against `mobile/app.json` / `mobile/eas.json` at branch
`feat/mobile-omg-foundation` tip, then cross-checked live once ASC was
reachable again:

- **Export compliance**: `ios.infoPlist.ITSAppUsesNonExemptEncryption:
  false` is set locally. **Live-confirmed**: Build 25's own Build Metadata
  page in ASC (TestFlight → Build 25 → Build Metadata) shows **"App Uses
  Non-Exempt Encryption: No"** — Apple parsed this straight out of the
  binary's `Info.plist`, exact match. No manual export-compliance question
  is being asked because the binary already declares the answer.
- **App icon**: `icon: "./assets/icon.png"` → `mobile/assets/icon.png`
  exists, 1024×1024, PNG color type 2 (truecolor RGB, **no alpha
  channel** — Apple bounces icons with transparency at submission).
  `eas.json` has no icon override in any build profile. **Live-confirmed**:
  screenshotted the TestFlight → iOS Builds list — the real black/white
  circular omg icon renders correctly next to Builds 25, 24, and 21, not a
  broken-image placeholder. Resolves into the binary automatically via the
  Expo/EAS build; no separate ASC upload needed.

### Demo account, driven end to end

Done on 2026-09-17 on the pinned iPhone 17 Pro simulator
(`2DDC0F84-B433-49C6-8675-87E7A98CB60E`) against a Metro bundle of `main`.
This closes an item that earlier sessions recorded as unreachable. It was
never unreachable: the credentials are in `TESTFLIGHT-PUBLIC-LINK.md` and
the app signs in with them. What blocked the previous attempt was trying to
reach the account through a browser that reuses Benny's own login, not the
account itself.

**The fixed code needs a send first.** The code on its own is rejected with
`INVALID_OTP`. Call `/api/auth/email-otp/send-verification-otp` first (which
is what tapping Continue does) and the same code is then accepted. So the
review note must tell the reviewer to tap Continue and NOT to wait for an
email, or they will sit on a screen waiting for a message that never
arrives.

**What passed**: onboarding 01 to 03, the sign-in drawer, email plus fixed
code, the data-and-AI-providers consent screen, home, composer, and a real
session. The box woke from hibernation and `opencode/ling-3.0-flash-fin-free`
answered with an actual repo listing.

**What failed, and is now fixed.** The session list rendered EMPTY. Three
real sessions were on the box, one of them answered minutes earlier, and
the app showed none of them. A reviewer would have signed in, seen an empty
app, started a task, and watched it vanish — and empty is the worst
available failure here, because it is indistinguishable from a new account.

Cause: a repo carries two names. `name` is the label a person sees and can
rename; `project` is the key the box stamps on every session. The picker
filtered on `name`, and `Repo` dropped `project` on the way in. The demo
account's repo is labelled `personal` and lives in `/home/user/project`, so
the two strings differ and every comparison went false. Fixed in
`4f07b3016` (`mobile/src/omg/project-filter.ts`, checked against the demo
account's own `/api/bootstrap` response), and shipped as an OTA on runtime
1.0.10, update group `a5d57d13-824e-4aaf-a839-49d0d99297d2`. Build 1.0.10 in
App Store Connect picks it up on first launch, because `mobile/src/omg/ota.ts`
reloads into a fetched update rather than waiting for the next cold start.

**Box state, re-read live rather than carried forward.** `getCloudComputer`
for `appreview@omg.dev` returns `status: live`, `runtime.state: ready`,
instance `1b86b701bb2e`, plan `computer_s20`. `TESTFLIGHT-PUBLIC-LINK.md`
still says instance `0851f402ca71` on the free plan; that is stale. Re-read
this before each review round rather than trusting either number.

**Still open, and a product decision rather than a bug.** The task a
reviewer types in step 03 is discarded. The demo account has a computer, so
it counts as `established`, so `mobile/src/omg/onboarding-gate.ts` skips
steps 04 to 06 and nothing consumes the stashed prompt. That is what the
gate is written to do. Benny has been asked whether the prompt should
survive sign-in. Do not answer it by special-casing the review account:
2.3.1 forbids behaviour that exists only for App Review.

### Account deletion / Guideline 5.1.1(v)

**Not independently re-verified live this session, and its providence is
unconfirmed** — stated plainly rather than re-asserted with confidence
nobody in this session chain actually checked:

- An earlier session attempted a live re-check via `app.omg.dev` (the
  deep-link target from `mobile/app/settings.tsx`). It resolved to **Benny's
  own real, logged-in session** rather than an isolated demo-account
  context, because ego-browser reuses his login state by design. It stopped
  before navigating to `/settings/delete-account`; zero state touched. That
  session concluded there was "no way to authenticate as the demo account
  without signing him out". **That conclusion was too broad and is now
  retired**: the iOS app signs into the demo account directly with the
  credentials in `TESTFLIGHT-PUBLIC-LINK.md`, which is how the end-to-end
  run above was done. What is genuinely unavailable is a *browser* session
  for that account, which is what the deletion screen needs.
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
5. **Server-side only, UI does not pre-gate**: the client never hides or
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

### Live in ASC: entity was already on file, one validation error was the actual blocker

Opened `Business → Agreements → Edit Legal Entity` once ASC was reachable.
Benny's personal legal entity was **already on file**, not empty:

| Field | Value |
|---|---|
| Name | `Chun Hung Kok` |
| Type | `Individual` (already correctly set — independently confirms the individual-account fact above) |
| Address | `40 Sam Dip Tam Hse 57 Lo Wai Village Tsuen Wan N.T.` / `Tsuen Wan` / `0000` / `Hong Kong` |
| Phone | Set at account level, and a different number from the App Review contact. Both are deliberately not recorded here; read them from App Store Connect. Not touched |
| Territories | 175 countries/regions |

No tax ID field appears anywhere in this dialog — just Name, Type, Address.
**The entire "update your legal entity information" gate was one field
validation error: Address 1 read "This value is too long."** Split the
existing address text across Address 1 / Address 2 — identical content, line
break only, nothing invented — and the error cleared.

Saving triggered Apple's own account-level 2FA ("a message with a
verification code has been sent to your devices"), which only Benny could
see or enter. Rather than guess, retry, or attempt any workaround, the task
space was handed back to him directly (`handOffTaskSpace`) so he could type
the code himself. **Confirmed saved and accepted** on the next pass: the
banner text changed from *"you must update your legal entity information
prior to signing..."* to *"you must sign the Paid Apps Agreement"* (the
entity clause is gone, only the signature clause remains), and the
"Edit Legal Entity" affordance is no longer shown next to the entity name —
Apple only removes that once entity info is accepted.

### "Machine Thinking Company" — CONFIRMED BY BENNY NOT his company. Do not act on it, or its address, for any purpose.

A predecessor session found HK Business Registration documents in Benny's
Dropbox under a name different from an earlier "Use Effect Limited"
assumption (which does not exist anywhere in Dropbox — zero filename or
content matches):

| Field | Value | Source |
|---|---|---|
| Name found | Machine Thinking Company | `Documents/20250401-BR-Machine Thinking Company.pdf` (HK BR Certificate) + `Documents/20250401-Form 1a-Machine Thinking Company.pdf` (the application) |
| Entity type | Individual/sole-proprietorship registration (Form 1(a)), proprietor Kok Chun Hung | same |
| BR Certificate No. | `57966774-000-04-25-9` | same |
| Registered address | **16** Sam Dip Tam, House 57, Lo Wai Village, Tsuen Wan, N.T., Hong Kong | same |
| Validity | Commenced 01/04/2025, **expired 31/03/2026** (lapsed as of today, 2026-08-17) | same |

**Benny has now explicitly confirmed: Machine Thinking Company is NOT his
company, has no relationship to this app or this Apple account, and is not
the entity referenced anywhere in this doc.** His actual active company —
relevant only to the future Organization-conversion path discussed below,
not to anything filed so far — is **Use Effect Limited**.

**Address disambiguation, since the two look similar and it matters:** the
Apple legal entity / W-8BEN address on file is **`40` Sam Dip Tam Hse 57 Lo
Wai Village Tsuen Wan N.T.** (confirmed live in ASC, split across Address
1/2, and pre-filled correctly onto the W-8BEN tax form). The Machine
Thinking Company BR document above says **`16`** Sam Dip Tam — a different
house number, same village. **The `16` address belongs to Machine Thinking
Company and has never been entered anywhere in ASC.** Nobody reading this
doc later should treat the `16` BR document, its address, or its expired
certificate as relevant to Apple, this app, or any tax/bank filing — it is
retained here solely as a record of what one Dropbox search turned up, nothing more.

Not reported here: the proprietor's HKID/passport number visible on the Form
1(a) — irrelevant to Apple's requirements and not something to propagate.

## Paid Apps Agreement — SIGNED by Benny. Not yet Active — banking and tax are the new gate.

Before signing, this session walked right up to the signature and stopped:
`Business → Agreements` showed *"To offer apps or other in-app purchases,
you must **sign** the Paid Apps Agreement,"* and opening "View and Agree to
Terms" (viewed, read, closed via Cancel — nothing agreed to that pass)
showed the full Schedule 2 text of an amendment to the Apple Developer
Program License Agreement — *"By clicking to agree to this Schedule 2, ...
You agree with Apple to amend..."* — Section 1, "Appointment of Agent and
Commissionaire," appoints Apple as Benny's agent for marketing and
delivering paid apps/IAP to end users in listed territories. Reported that
exact commitment to Benny before he clicked anything.

**Benny then signed it himself.** Independently re-verified with a fresh
page reload (not taking his word or the reporting session's word for it):

| Agreement | Status | Effective Date |
|---|---|---|
| Paid Apps Agreement | **`Pending User Info`** (was `New`) | `16 Aug 2026 - 26 Jul 2027` |
| Free Apps Agreement | `Active`, unchanged | `26 Jul 2026 - 26 Jul 2027` |

`Pending User Info` confirms the signature landed — Apple only assigns an
effective date and moves the status once a signature is recorded — but it
is **not** `Active` yet. Signing unlocked two new, separate requirements
that block it from becoming Active:

### Bank Accounts — not started

New "Bank Accounts" section, empty. Banner: *"To receive payments from
Apple, you must add a bank account."* **Not touched** — real banking
details, entirely Benny's.

### Tax Forms — questionnaire done, actual forms not submitted

Answering ASC's initial "U.S. Tax Questionnaire" (that's the one Benny
finished) resolved into two specific named filings, both still outstanding:

| Tax form | Status | Date submitted |
|---|---|---|
| U.S. Certificate of Foreign Status of Beneficial Owner | **Missing Tax Info** | `-` |
| U.S. Form W-8BEN | **Missing Tax Info** | `-` |

(These read as two labels/artifacts of the same underlying W-8BEN filing —
an individual non-US developer's standard form, as anticipated earlier in
this doc — not two unrelated documents. Both independently still show
not-submitted, so both are being treated as outstanding.) Clicked "Add Tax
Info" once to see the form's shape; control passed back to Benny before
anything rendered, so **no content from that form was seen, and nothing was
filled in or submitted.**

### Can the 4 tiers sell yet? No.

The agreement is signed, but `Pending User Info` — explicitly gated on the
bank account (not started) and the W-8BEN/Certificate filing (questionnaire
done, forms not submitted) above — means Apple cannot process payments yet.
**None of the 4 subscription tiers can take money until both are
complete.** This is expected next-step friction, not a problem with the
signature itself, but it needs to be said plainly: signing was necessary,
not sufficient.

### Subscription tiers — re-verified, unchanged

All 4 tiers under group "omg.dev Cloud Computer" (`22312997`) still show
**"Prepare for Submission"**, same as before the agreement was signed —
Pro, Personal, Starter Plus, Starter, same product IDs, same 1-month
duration. Group-level banner unchanged: *"Your first subscription group
must be submitted with a new app version."* Confirms the agreement/banking
status has no bearing on submission-readiness configuration — that part
was already done and remains done; only actual *selling* is blocked by
the banking/tax gate above.

## App transfer to an organization later — verified against Apple's live documentation, not assumed

Benny shipped as an individual on the plan that moving to "Use Effect
Limited" later stays possible. That claim was previously unsourced. Checked
directly against `developer.apple.com` — and it turns out there are **two
different paths**, not one, with materially different requirements:

### Path A: Convert this same account to an Organization (no app transfer at all)

Per [Apple's own account-membership documentation](https://developer.apple.com/help/account/membership/updating-your-account-information/):
submitted via `Membership Details → Convert to Organization` (a form at
`/contact/request/migrate-individual-account`), only the Account Holder can
submit it. Requires: being the founder/cofounder of the organization, the
organization's **D-U-N-S Number**, and business verification documents.
Third-party integrator docs describing the same Apple flow report that
**the Apple ID, Team ID, certificates, and existing apps stay intact — only
the seller name changes** (not independently confirmed on an
apple.com page, flagged as such). Apple's own docs carry one real, sourced
warning: **changing the organization name resets `identifierForVendor`
(IDFV) for existing users on their next update**, can make existing users
read as new installs to a Mobile Measurement Partner, and **this cannot be
undone**.

**This path has no released-version prerequisite** — it converts the
account in place rather than moving the app anywhere.

### Path B: Transfer the app to a separate Organization account

Per [Apple's App Transfer Criteria](https://developer.apple.com/help/app-store-connect/transfer-an-app/app-transfer-criteria)
and [App Transfer Overview](https://developer.apple.com/help/app-store-connect/transfer-an-app/overview-of-app-transfer)
— this is the path if "Use Effect Limited" is (or becomes) its own,
separate Apple Developer enrollment, distinct from Benny's individual one:

- **The app must have at least one version released to the App Store.**
  This is the assumption Benny shipped on — **confirmed correct for this
  path specifically**, sourced from Apple's own criteria page.
- App can't be in `Processing for Distribution`, `Waiting for Review`, `In
  Review`, `Accepted`, `Pending Developer Release`, or `Pending Apple
  Release` at transfer time; can't be available for pre-order.
- **TestFlight must be fully wiped before initiating transfer**: all builds
  removed, all testers removed, all Test Information cleared for every
  localization. Given the app currently has live TE + PB TestFlight groups
  with real testers, this is a real, non-trivial prerequisite step, not a
  formality.
- Xcode Cloud project/settings must be removed first.
- In-App Purchase product IDs on the app can't collide with product IDs
  already in the recipient account.
- Auto-renewable subscriptions need an app-specific shared secret generated
  and shared with the recipient before transfer, then rotated after
  acceptance so the old secret stops working.
- Both accounts must have accepted current paid/free agreements and be in a
  non-pending state — directly relevant here, since Benny's own account is
  *currently* `Pending User Info` on the Paid Apps Agreement, which would
  itself need to resolve to `Active` before any transfer could proceed.
- **Apple's documentation does not explicitly state whether an Individual
  account can transfer an app to an Organization account** (or vice
  versa) — it describes the mechanics generically by "Account Holder" role
  without addressing account-type combinations. This is a real gap, not an
  oversight in this research: if Path B turns out to be the intended route,
  that specific question needs Apple Developer Support to confirm, not an
  assumption either way.

### Bottom line for Benny

The original claim ("transfer to the company later is a possibility") is
**directionally correct but was incomplete**: Path A (convert this account)
needs no released version at all and is likely the simpler, intended route
if the goal is just to sell under the company's name later — but it
requires Use Effect Limited to have its own D-U-N-S and verifiable business
documents (the only HK BR document found so far, for "Machine Thinking
Company," is expired and is a different name anyway — see above). Path B
(transfer to a separate account) does need the released version Benny was
told about, but adds real, non-trivial TestFlight-wipe and subscription
-secret-rotation work, and has an open question about individual→org
eligibility that isn't answered by Apple's own docs. Neither path is
blocked today, but neither is a light lift either.

## NEEDS BENNY

Everything reachable without his personal signature or his banking and tax
identity is now done. The live demo-account test is also done: it was driven
end to end on the simulator on 2026-09-17, and what it found is recorded in
"Demo account, driven end to end" below. What's left needs him specifically:

1. **Nothing to do on the App Review Notes.** An earlier pass of this
   session claimed the live field still said the app "integrates no
   third-party or social login" and asked Benny to replace it. That was
   wrong: it was read out of this document instead of out of App Store
   Connect. The live note is correct and already states the 4.8 position.
   One small inaccuracy is left in it, worth a touch-up whenever the
   metadata is next unlocked but not worth a trip on its own: it says "On
   a fresh install a short intro appears before sign-in. Continue or Skip
   both lead to the sign-in screen." There is no Skip in the pre-sign-in
   flow. The only `Skip` left is in `SetupScreen`, which the demo account
   never reaches because it already has a computer.

2. **Add a bank account** — Business → Agreements → Bank Accounts. Not
   started. Blocks the agreement from reaching `Active`.
3. **Submit the W-8BEN / Certificate of Foreign Status tax filing** —
   Business → Agreements → Tax Forms. The routing questionnaire is done;
   the actual form(s) are not. Also blocks `Active`.
4. **5.1.1(v) account deletion, live** — see the dedicated section above. No
   code change needed (verified by reading the guard + its wired test,
   which already covers the real reviewer-facing behavior end to end); the
   open item is procedural — no session in this chain has personally
   exercised the live flow, since the only browser access available
   resolves to Benny's own real account, not the demo one.
5. **Decide which transfer path he actually wants**, now that both are
   documented above with real requirements — that decision drives whether
   TestFlight needs to stay pristine (Path B) or whether he just needs a
   D-U-N-S for Use Effect Limited (Path A).

## Already resolved this session — no longer needs Benny

- ~~ASC login~~ — was confirmed dead account-wide via `ego-browser` (his
  actual profile, not a mac-chrome artifact), then he signed back in and it
  was independently re-verified live (account name rendering in the ASC
  header, full nav present).
- ~~Contact Information~~ — First `Benny` / Last `Kok` / Phone
  phone (not recorded here) / Email `support@omg.dev`, saved and confirmed via a hard
  page reload.
- ~~"Manually release this version" + the Guideline 4.8 App Review Notes
  addition~~ — both saved and confirmed via the same reload, after two
  prior sessions lost them to the Contact Information gate.
- ~~Legal entity info~~ — was already on file under his personal name; the
  actual blocker was an address-field length validation error, now split
  and saved (2FA-confirmed, verified via the banner text changing and the
  Edit-entity affordance disappearing).

## What deliberately was not touched

- Screenshots / Media Manager — owned by a sibling session.
- Build 24 (external review) and Build 25's TE-only/no-external-review state.
- `eas credentials -p ios` — blind interactive menu, real risk of
  regenerating production signing credentials.
- Banking, tax, legal entity, agreement signature — Benny's identity, not
  ours to fill in.
- Anything requiring a guessed or fabricated fact (phone number, legal
  entity name, marketing claims not backed by the actual product).
