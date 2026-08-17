# Converting the Apple Developer account to Use Effect Limited

Status as of 2026-08-17: shipping under Benny's **personal (Individual)** Apple
Developer account today. This doc tracks the plan to convert that account to
**Use Effect Limited** so App Store revenue lands on the company instead of
him personally. Update the checklist below as each step lands — this is meant
to stay current, not be a one-time snapshot.

## Company on record

Read off the actual BR certificate (not a secondhand summary):

```
USE EFFECT LIMITED
RM 29-33 5/F BEVERLEY COMM CTR
87-105 CHATHAM RD, TSIM SHA TSUI
HONG KONG

BR Certificate No.: 80637455-000-06-26-9
Valid: 15/06/2026 - 14/06/2027 (current)
Nature of Business: CORP
Status: BODY CORPORATE
```

The BR's "Date of Commencement" (15/06/2026) is that certificate's **annual
renewal cycle**, not the company's incorporation date — not that it matters
for this doc anymore. The company number and true incorporation date would
have come from a free HK Companies Registry (ICRIS) name search, but that
search turned out to be **unnecessary**: it existed only to fill in a D-U-N-S
*request* form, and D&B already had Use Effect Limited on file (D-U-N-S
**374273777**, see below), so no request was ever filed and the ICRIS search
was dropped.

Nothing outstanding from Benny before he can run the Convert to Organization
request himself. His exact title at Use Effect Limited may still come up
during that request (see conversion sequence below) — ask then, if Apple's
form asks for it.

## D-U-N-S number

Apple requires a D&B D-U-N-S number to verify the organization before it will
convert the account. Two paths exist and they are **not equivalent in
speed**:

| Path | Turnaround | Notes |
| --- | --- | --- |
| Apple's own lookup/request tool (`developer.apple.com/enroll/duns-lookup/`) | ~7 business days total (D&B issues in ≤5 business days, syncs to Apple in ≤2 more) | Free. Checks for an existing number first; if none exists, submits a new request on this fast track. **Use this path.** |
| D&B Hong Kong direct (email `enquiryhk@dnb.com`, mail back a form) | ~30 working days (~6 weeks) | Free, but far slower. Only fall back to this if the Apple-tool path stalls past 2 weeks — Apple's own guidance in that case is to escalate via `support.dnb.com/?CUST=APPLEDEV`. |

### Status: confirmed

```
D-U-N-S Number: 374273777
Legal entity:   Use Effect Limited
```

Ran Apple's lookup tool on 2026-08-17 (Region: Hong Kong, Legal Entity Name:
`USE EFFECT LIMITED`, Headquarters Address: `RM 29-33 5/F BEVERLEY COMM CTR,
87-105 CHATHAM RD`, Tsim Sha Tsui). D&B returned one matching record with the
exact legal entity name and exact headquarters address already on file.
Selected/confirmed that match (did not submit a *new* D-U-N-S request — this
was the "check for an existing one" branch of the tool). Apple's response:

> We've received your information. Your organization's D-U-N-S Number has
> been sent to the email address you provided.

The number wasn't shown on-screen — D&B emailed it to the work contact
address used on the form (`support@omg.dev`). This skipped the
~7-business-day wait entirely: no new D-U-N-S request had to be filed, D&B
already had Use Effect Limited on file at this address.

Retrieved the email (read-only — opened, read, did not reply/archive/delete)
from Apple Developer (`developer@email.apple.com`), subject "Your D-U-N-S
Number is enclosed," addressed to "support":

> Dear Chun Hung Kok, The D-U-N-S Number for Use Effect Limited is
> 374273777. If you have the legal authority to bind your company to Apple
> Developer Program agreements, you can use this number to enroll for your
> company. Before enrolling, please ensure that Use Effect Limited is a
> legal entity.

`support@omg.dev` turned out to be reachable after all: it's not a separate,
unreachable mailbox — it's an alias that delivers into `benny@omg.dev`,
which is logged in as a secondary Google Workspace account in Benny's
browser profile (Gmail's account switcher, `mail.google.com/mail/u/1/`).
Correcting the earlier note in this doc that assumed no path in.

## Conversion sequence (Individual → Organization)

The D-U-N-S number is in hand (`374273777`) — this is now unblocked and
walkable end to end:

1. **Benny**, as Account Holder, signs in at `developer.apple.com/account`.
2. Open **Membership Details** in the left sidebar.
3. Click **"Submit a request"** next to *Convert to Organization*.
4. The request requires the **D-U-N-S number** (`374273777`). The requester
   must be the organization's **founder or co-founder** — Benny qualifies.
5. Apple immediately sends a confirmation email with a **case number**.
6. **Apple calls to verify the enrollment** — expect a call to
   `+852 6776 2685`. This is a real step, not a formality; have the BR
   certificate and D-U-N-S details on hand for that call.
7. After verification, Apple emails instructions to complete the conversion.

Apple explicitly **rejects** DBAs, fictitious businesses, trade names, and
branches — sole proprietorships must stay Individual. Use Effect Limited is a
Hong Kong private company limited by shares (BODY CORPORATE per the BR), so
it qualifies as a recognized legal entity.

**Do this before the public App Store release, not after.** See
"Irreversible catch" below — the cost of converting only goes up the longer
the app runs under the personal account first, and it goes up sharply once
the app is publicly live and accumulating installs. There's no version of
this that gets cheaper by waiting.

### The two loose ends this closes

- **Bank account mismatch.** Benny added a bank account registered to Use
  Effect Limited on his *personal* Apple Developer account — a
  beneficiary-name mismatch he accepted because this conversion was coming.
  Converting the account to the entity resolves that mismatch properly
  instead of leaving it as an accepted risk.
- **W-8BEN line 9 treaty error.** The individual W-8BEN filed today
  incorrectly checked the treaty-residency box (Hong Kong has no US tax
  treaty — see note below). It couldn't be corrected in App Store Connect
  once submitted. The **W-8BEN-E filed under Use Effect Limited** after
  conversion supersedes it entirely, since withholding then runs against the
  company's tax status, not Benny's personal one.

## What has to be redone under the company, after conversion

Converting the account does not carry existing paperwork over — these are
new, separate actions once the account is an Organization:

- **A new W-8BEN-E** (the entity tax form) replacing the individual W-8BEN.
  See the note below — this is also needed to correct a separate problem.
- **A company bank account** for Use Effect Limited, replacing Benny's
  personal account, so App Store payouts route to the company.
- **Re-signing the Paid Apps Agreement** as the entity (Use Effect Limited),
  not as Chun Hung Kok individually.

## Irreversible catch: `identifierForVendor` resets on org name change

**Converting before the public App Store release is cheap. Converting after
is not — do this now.**

Converting to an Organization and setting the org's display name changes the
value iOS computes for `identifierForVendor` for every existing install.
Anything keyed off that identifier (analytics, entitlements, local
de-duplication, etc.) will see existing users as brand-new installs after the
switch. This is **not reversible**, and the cost scales directly with how
many installs exist at the moment of conversion:

- **Pre-release / low install count (now):** the reset touches almost no
  real users. This is the cheap window.
- **Post-release, with the app publicly live:** every install accumulated
  between launch and conversion gets treated as a new user the moment the
  org name changes — broken analytics history, entitlement/purchase
  re-linking issues, de-duplication gaps, for everyone who installed before
  the switch. The longer the gap between "app is public" and "conversion
  happens," the larger and more painful this list gets.

With the D-U-N-S number now in hand, there's no remaining reason to delay —
this is the argument for running the conversion sequence above before
shipping publicly, not after.

## Timing: conversion is not retroactive

Revenue earned while the account is Individual is Benny's **personal**
income, full stop — converting the account later does not reclassify past
revenue as company revenue. The practical implication: the sooner the
conversion happens after today's launch, the smaller the slice of revenue
that has to be treated as personal income before the company takes over.

## Note on today's W-8BEN (personal account)

The W-8BEN filed today in App Store Connect under the Individual account has
an inaccuracy worth recording so it isn't lost: **Part II line 9 (treaty
residency) was checked**, but Hong Kong has no US income tax treaty, so that
claim doesn't hold. Line 10 (the specific treaty article / reduced
withholding rate) was left blank, so no reduced withholding rate was actually
claimed as a result — the practical tax impact is likely limited, but the
form as filed is not accurate.

This **cannot be corrected in App Store Connect** — the form locks after
submission, and Apple's own guidance is to contact support directly rather
than expecting a self-service fix. Leaving it as-is is a reasonable call
short-term: the eventual **W-8BEN-E filed under Use Effect Limited** after
conversion supersedes it, since withholding then runs against the company's
tax status, not Benny's personal one. Flagging here so it's a known,
deliberate deferral and not a dropped thread.

## Open items

- [x] Run the Apple D-U-N-S lookup — existing D&B record found for Use Effect
      Limited at the exact registered address.
- [x] Retrieve the actual D-U-N-S number — **374273777**, read from the D&B
      email in `benny@omg.dev` (the `support@` alias's real destination).
- [x] ~~Free ICRIS search~~ — **not required.** It only existed to fill in a
      D-U-N-S request form; D&B already had an existing record, so no
      request was filed and the company number / incorporation date it would
      have provided are no longer needed for this step.
- [x] ~~Get employee count and Benny's title~~ — **not required for
      D-U-N-S**, same reason as ICRIS above. His title may resurface during
      the actual Convert to Organization request below; ask then if Apple's
      form asks for it.
- [ ] **Benny submits the Convert to Organization request himself** —
      D-U-N-S number `374273777` is ready to enter, this agent prepares but
      does not submit. Do this before the public App Store release (see
      `identifierForVendor` section above) — the bank-account mismatch and
      the W-8BEN treaty error both wait on this too.
