# App Builder preset

Status: local opt-in pilot. No default change or production rollout.

OMG Agent runs this preset through the OpenCode SDK. The web composer offers
General and App Builder under OMG Agent. Selecting App Builder selects Haiku
with low reasoning. The user can then select another builder model.

The launch API accepts `builderPreset: "app-builder-v1"` with `agent: "omg"`.
When no model or reasoning level is given, the preset uses
`omg/anthropic/claude-haiku-5.5` and `low`. Other agents reject this preset.
The preset is stored with the session and in the resume cache.

The controller owns three phases:

1. The selected builder implements the request and runs focused checks.
2. Apex receives bounded excerpts of changed source in a separate OpenCode
   session. Tools are disabled. The request has a 90-second deadline.
3. The original builder checks the advice, fixes confirmed issues, and verifies
   the app. The controller permits exactly one review per user turn.

Cancellation prevents the repair pass. An empty or failed review stops the
workflow. A stopped workflow does not claim completion. Each builder turn has
an OpenCode limit of 50 steps. The reviewer has a limit of one step.

On Linux, the preset disables OpenCode's native file watcher. This avoids a
first-prompt deadlock reproduced in the pilot. Source reads still work.

This route uses OMG API credits. It does not use Claude subscription OAuth.
Review tokens and the separate review session ID are retained in the runtime
registry. OpenCode cost metadata depends on provider pricing configuration.
The platform billing ledger remains the cost authority.

The review checks source excerpts. It does not review screenshots or guarantee
all bugs are found. A Git project with an initial commit is required. A turn
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
