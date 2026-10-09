# Computer resume metrics

`computer_resume` is emitted by the full web App connection owner. It uses the
existing host analytics callback (Umami), or the iframe analytics bridge.
Standalone diagnostics also receive the event through `evlog`.

Run the read-only production report:

```sh
scripts/computer-resume-metrics.sh 7
```

The report shows daily and total sample counts, average, p50, and p95 in seconds.
Failed and abandoned attempts are counted separately. Empty averages mean there
are no completed samples. `OMG_METRICS_SSH_TARGET` overrides the metrics host.

The timer starts when the foreground app first observes a connection wait.
It includes the time before the status endpoint identifies `paused` or `waking`.
It ends only when bootstrap data is usable and the socket is live. `ready` alone
is not completion. Ordinary reconnects and cold starts are excluded. Tab hiding,
computer switches, and unmounts end an attempt as `abandoned`. A visible return
starts a new attempt. This prevents time away from inflating successful latency.

Event properties: `duration_ms` (measured with the monotonic browser clock),
`result` (`connected`, `failed`, `abandoned`), `initial_lifecycle` (`paused`,
`waking`), and `schema_version` (`1`). The UI progress bar is an estimate and is
never a metric input. Collection is best effort and includes only browsers that
send analytics. Navigation or a page crash can lose a sample.

Backend wake timing already exists in Axiom's `logs` dataset (the control plane's current `AXIOM_DATASET`). It includes
`ms`, `infraMs`, `syncMs`, `readyMs`, `result`, and `phase`. Compare it with the
browser wait to find whether the slow stage is resume, runtime readiness, or
client reconnection. Use this APL for successful wakes:

```apl
['logs']
| where _time > ago(7d) and event == "computer.wake" and result == "running"
| summarize samples=count(), average_ms=avg(ms), p50_ms=percentile(ms, 50), p95_ms=percentile(ms, 95), infra_ms=avg(infraMs), sync_ms=avg(syncMs), ready_ms=avg(readyMs)
```
