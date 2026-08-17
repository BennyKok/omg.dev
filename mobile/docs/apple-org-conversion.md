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
*request* form, and D&B already had Use Effect Limited on file (see D-U-N-S
section below), so no request was ever filed. Not pursuing it — HK's
Companies Registry e-Services portal requires a real HKID or passport number
to register as a searcher even for the free search, and that isn't worth
asking Benny for on a step that no longer applies.

Nothing outstanding from Benny for the D-U-N-S step. His exact title at Use
Effect Limited may still come up during the actual Convert to Organization
request (see conversion sequence below) — ask then, if Apple's form asks
for it.

## D-U-N-S number

Apple requires a D&B D-U-N-S number to verify the organization before it will
convert the account. Two paths exist and they are **not equivalent in
speed**:

| Path | Turnaround | Notes |
| --- | --- | --- |
| Apple's own lookup/request tool (`developer.apple.com/enroll/duns-lookup/`) | ~7 business days total (D&B issues in ≤5 business days, syncs to Apple in ≤2 more) | Free. Checks for an existing number first; if none exists, submits a new request on this fast track. **Use this path.** |
| D&B Hong Kong direct (email `enquiryhk@dnb.com`, mail back a form) | ~30 working days (~6 weeks) | Free, but far slower. Only fall back to this if the Apple-tool path stalls past 2 weeks — Apple's own guidance in that case is to escalate via `support.dnb.com/?CUST=APPLEDEV`. |

**Status: Existing D&B record found — number in transit by email.** Ran
Apple's lookup tool on 2026-08-17 (Region: Hong Kong, Legal Entity Name:
`USE EFFECT LIMITED`, Headquarters Address: `RM 29-33 5/F BEVERLEY COMM CTR,
87-105 CHATHAM RD`, Tsim Sha Tsui). D&B returned one matching record with the
exact legal entity name and exact headquarters address already on file.
Selected/confirmed that match (did not submit a *new* D-U-N-S request — this
was the "check for an existing one" branch of the tool). Apple's response:

> We've received your information. Your organization's D-U-N-S Number has
> been sent to the email address you provided.

The number itself is **not shown on-screen** — D&B emails it to the work
contact address used on the form (`support@omg.dev`). This still removes the
~7-business-day wait entirely since no new request was needed — D&B already
has Use Effect Limited on file at this address.

**Retrieving the email needs Benny.** `support@omg.dev` is its own mailbox on
Google Workspace (confirmed via the domain's MX record — it points to
Google's Workspace mail servers), separate from Benny's personal Gmail. There
is no evidence it forwards there. Whoever is picking this doc back up should
have Benny check `support@omg.dev` directly rather than assuming it lands
somewhere else.

- [ ] Paste the actual D-U-N-S number here once Benny finds the email.

## Conversion sequence (Individual → Organization)

Once the D-U-N-S number is in hand:

1. **Benny**, as Account Holder, signs in at `developer.apple.com/account`.
2. Open **Membership Details** in the left sidebar.
3. Click **"Submit a request"** next to *Convert to Organization*.
4. The request requires the **D-U-N-S number**. The requester must be the
   organization's **founder or co-founder** — Benny qualifies.
5. Apple immediately sends a confirmation email with a **case number**.
6. **Apple calls to verify the enrollment** — expect a call to
   `+852 6776 2685`. This is a real step, not a formality; have the BR
   certificate and D-U-N-S details on hand for that call.
7. After verification, Apple emails instructions to complete the conversion.

Apple explicitly **rejects** DBAs, fictitious businesses, trade names, and
branches — sole proprietorships must stay Individual. Use Effect Limited is a
Hong Kong private company limited by shares (BODY CORPORATE per the BR), so
it qualifies as a recognized legal entity.

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

Converting to an Organization and setting the org's display name changes the
value iOS computes for `identifierForVendor` for every existing install.
Anything keyed off that identifier (analytics, entitlements, local
de-duplication, etc.) will see existing users as brand-new installs after the
switch. This is **not reversible** and gets worse the longer the app runs
under the personal account first — more installs accumulate that identity
before the reset. Worth converting sooner rather than later once the
D-U-N-S/paperwork is ready, specifically because of this.

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
      Limited at the exact registered address; number emailed to
      `support@omg.dev`, not yet retrieved. See D-U-N-S section above.
- [ ] Benny checks `support@omg.dev` (a separate Google Workspace mailbox,
      does not forward to his personal Gmail) and pastes the actual D-U-N-S
      number into this doc.
- [x] ~~Free ICRIS search~~ — **not required.** It only existed to fill in a
      D-U-N-S request form; D&B already had an existing record, so no
      request was filed and the company number / incorporation date it would
      have provided are no longer needed for this step.
- [x] ~~Get employee count and Benny's title~~ — **not required for
      D-U-N-S**, same reason as ICRIS above. His title may resurface during
      the actual Convert to Organization request below; ask then if Apple's
      form asks for it.
- [ ] Benny submits the Convert to Organization request himself once the
      D-U-N-S number is confirmed (this agent prepares, does not submit).
