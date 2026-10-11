# App Builder preset

Status: local opt-in pilot. No default change or production rollout.

OMG Agent runs this preset through the OpenCode SDK. The web composer offers
General and App Builder under OMG Agent. Selecting App Builder selects Haiku
with low reasoning. The user can then select another builder model.

The launch API accepts `builderPreset: "app-builder-v1"` with `agent: "omg"`.
When no model or reasoning level is given, the preset uses
`omg/anthropic/claude-haiku-5.5` and `low`. Other agents reject this preset.
The preset is stored with the session and in the resume cache.

The controller owns the review loop:

1. The selected builder implements the request and runs focused checks.
2. Apex reviews bounded source excerpts in a separate OpenCode session.
3. The controller captures the live app at 390 by 844 pixels. Luna compares
   that screenshot with the user brief and up to three reference images.
4. If either review fails, the builder repairs the findings once. Both
   reviewers then check the current version again with a fresh screenshot.

Both reviewers must return a passing JSON verdict on the same version before
completion. The controller allows two review rounds and one repair turn.
Invalid verdicts, capture errors, timeouts, and failed final reviews stop the
workflow. Cancellation prevents further work. Each builder turn has an
OpenCode limit of 50 steps. Each reviewer has one step, no tools, and a
90-second deadline. Code review cannot substitute for design review.

The builder must leave a local web preview running and write its URL to
`.omg/app-builder-preview.json`, for example:
`{"url":"http://127.0.0.1:8353"}`. Only loopback HTTP URLs are accepted.
Screenshot capture uses an isolated Bun.WebView with a 30-second deadline.
The view closes after capture or cancellation. Reference images come from
user attachments or image paths in the request. The controller converts them
to bounded JPEGs and limits the image payload to one megabyte. Screenshots
are saved under `.omg/app-builder-review/`. A preview that has not rendered
cannot pass the capture gate. Refresh the preview after a repair.

On Linux, the preset disables OpenCode's native file watcher. This avoids a
first-prompt deadlock reproduced in the pilot. Source reads still work.

This route uses OMG API credits. It does not use Claude subscription OAuth.
Code and design review verdicts, tokens, costs, and separate session IDs are
retained in the runtime registry. OpenCode cost metadata depends on provider pricing configuration.
The platform billing ledger remains the cost authority.

Code review checks source excerpts. Design review checks one rendered viewport.
These checks do not guarantee all bugs or visual defects are found. A Git project with an initial commit is required. A turn
with no changed app source stops before review. Native client controls and
hosted account defaults are outside this local pilot.

Before rollout, repeat representative app tests, verify the billing ledger,
and test the hosted Computer and native client selection paths. Keep General
as the default until those checks pass.

## Local replay result (2026-10-11)

The revised Tealist replay took 4 minutes 18 seconds for the model workflow.
Recorded tokens at the current router prices give an estimate of $0.04475717.
Apex identified a shared-write race and paused timer updates. Haiku fixed both.
The race reproduces before the fix and passes after it. All 14 browser checks
pass. Luna's historical app is closer to the supplied design references.

The pilot has 64 passing focused runtime tests. Root and web typechecks pass.
The full suite has 4,823 passes and 21 failures. Twenty failures reproduce on
a clean baseline checkout. The remaining setup timeout passes alone.
The full suite is not green. The replay exercised the controller and SDK
directly. Production web launch and hosted Computer behavior remain rollout
checks. No deployment was performed.

## Dual review replay (2026-10-11)

The extension has 63 passing focused runtime checks. Root and web typechecks
pass. Independent app verification passes all 14 browser checks, backend
restart persistence, concurrent shared writes, and a before/after task-storage
race test. The full suite remains red on the previously checked baseline
failures. A stale client build error passes after rebuilding that prerequisite.

The Tealist replay costs an estimated $0.07626303 from recorded tokens.
The model workflow takes 8 minutes 39 seconds, including an interruption and
resume. A separate design review retry takes 18 seconds after an expired local
OAuth token returns HTTP 401. This is not a clean speed comparison.

The first reviews fail. Haiku repairs the task-storage race and changes the
mascot and icons. Final code review passes. Final design review fails on hero
text layout and composition. The workflow does not claim completion. Luna's
historical app remains closer to the reference. No rollout was performed.

The final design capture is 390 by 844 pixels. The initial replay captures
were 390 by 757 pixels before an explicit viewport override was added. Keep
this variation in mind when comparing the images. More app samples, the repair
strategy, runtime screenshot support, hosted authentication, and launch paths
remain rollout checks. General remains the default.
