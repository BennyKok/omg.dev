---
name: ask-user
description: Ask the human a question and block until they answer. Use when a decision genuinely needs the user's call (irreversible actions, ambiguous intent, competing trade-offs, anything risky) and you cannot reasonably decide alone. Raises a push notification; the user replies by typing in the app or by talking to the voice agent.
---

# Asking the user (human-in-the-loop)

You run headless on a schedule, but some calls are not yours to make. When you
hit one, ask the human instead of guessing. This sends them a push notification
and **blocks until they answer** (or it times out), then hands you their reply.

```
BASE=http://localhost:8766
```

## When to ask

Ask only when it's worth interrupting someone:

- Irreversible or risky actions (deploying, deleting, force-pushing, spending).
- Genuinely ambiguous intent where the wrong guess wastes real work.
- A judgement call between trade-offs only the user can weigh.

Do **not** ask for things you can safely determine yourself, and never ask more
than one question per run. Silence is still the default — most runs ask nothing.

## How to ask

Send the question and wait. The call returns when the user answers, or after the
timeout with `status: "open"` and a null answer.

```bash
RESP=$(curl -s -X POST $BASE/api/ask -H 'Content-Type: application/json' -d '{
  "question": "The billing migration will drop the legacy table. Run it now?",
  "options": ["Run it", "Skip for now"],
  "agentId": "<your agent id, if known>",
  "sessionId": "<related session id, if any>",
  "user": "<user email to notify, if known>",
  "timeoutMs": 180000
}')

echo "$RESP" | jq -r '.status'   # "answered" or "open"
echo "$RESP" | jq -r '.answer'   # the user's reply (free text), when answered
```

- `options` are optional one-tap suggestions; the user may also type free text,
  so handle any answer, not just the options you offered.
- `user` scopes the push notification and the UI surface to that person. Set it
  from the related session's `assignedUser` when you know it.
- Default block is generous but bounded. If you must ask without waiting, pass
  `"wait": false` to get just `{id}`, then later poll `GET $BASE/api/ask/<id>`.

## After the answer

- If `status` is `answered`, act on `answer` — it's the user's decision in their
  own words. Honour it even when it differs from your recommendation.
- If `status` is `open` (timed out), do **not** take the risky action. Either
  surface a finding noting it's still pending, or leave it for the next run.
