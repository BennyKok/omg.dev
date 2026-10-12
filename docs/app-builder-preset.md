# App Builder preset

Status: experimental opt-in workflow. General remains the default.

OMG Agent runs this preset through the OpenCode SDK. The web composer offers
App Builder in the final Workflows section of the OMG Agent model list on
desktop and mobile web.
Its subtitle is “Haiku · Apex code review · Luna design review”. Selecting
the row selects Haiku with low reasoning and activates the workflow. The
composer pill shows App Builder. Selecting a regular model or another agent
exits the workflow. The separate Preset dropdown was removed.
Choose a Git project before using this workflow. Quick Chat without a project
is not supported. The picker explains this requirement, and the launch API
rejects it before starting a session. The native client is unchanged.

The launch API accepts `builderPreset: "app-builder-v1"` with `agent: "omg"`.
When no model or reasoning level is given, the preset uses
`omg/anthropic/claude-haiku-5.5` and `low`. Other agents reject this preset.
The preset is stored with the session and in the resume cache.

The controller owns the review loop:

1. The selected builder implements the request, runs focused checks, and
   inspects the rendered UI against the design references.
2. Apex reviews bounded source excerpts in a separate OpenCode session.
3. The controller captures the live app at 390 by 844 pixels. Luna compares
   that screenshot with the user brief and up to three reference images.
4. If either review fails, the builder receives the same reference images and
   current screenshot as image inputs, alongside both reviewers’ findings.
   It compares the images, repairs the findings once, and inspects a fresh
   screenshot after the repair. Both
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

## Direct visual repair replay (2026-10-11)

The repair turn now receives the same reference images and candidate screenshot
as the design reviewer. Both build and repair prompts request rendered UI
inspection. The OpenCode SDK forwards the image parts in order. There are 64
passing focused runtime tests. Root typecheck passes.

The fresh Tealist replay confirms four direct repair attachments and five
completed reads of builder screenshots. Extra benchmark compact-build and
browser restrictions were removed. Final code review passes. Final design
review fails. The layout improves over the previous repair, but Luna remains
closer to the reference. The screenshot reviewer also falsely claims that the
visible due-soon banner is missing. Its findings need evidence checks.

The clean replay takes 5 minutes 46 seconds and costs $0.05883676 in recorded
token estimates. A failed local proxy setup adds 7 minutes 7 seconds and
$0.02518478 in recorded overhead. Combined recorded cost is $0.08402154.
Unlogged HTTP retry charges may add more. These are API credits, not Claude
subscription usage. The historical Luna cloud window is 15 minutes 26 seconds,
including preview/deployment work. It is not a controlled timing comparison.

Independent browser checks pass 12 and fail 3: shared live updates, project
creation, and shared item completion. Backend restart and concurrent writes
pass. No full-suite rerun, native build, deployment, or rollout was performed.
The full suite retains previously recorded baseline failures. General remains
the default. Evidence is in
`/home/dev/.cache/lfg/tmp/tealist-visual-loop-v2-2026-10-11/REPORT.md`.
