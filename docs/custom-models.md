# Custom models

The omg agent can run on your own OpenAI-compatible server, such as vLLM or
llama.cpp on a home GPU. No omg.dev account is needed for these models.

## Add a model

Create `~/.omg/models.json`:

```json
{
  "providers": [
    {
      "id": "pc",
      "name": "3060 Ti",
      "baseURL": "http://100.79.118.10:8000/v1",
      "apiKey": "optional",
      "models": [
        { "id": "gemma-4-e4b", "context": 24576, "output": 4096, "input": ["text", "image"] }
      ]
    }
  ]
}
```

- `id` (provider): letters, digits, `.`, `_`, `-`.
- `id` (model): the name the server serves (`/v1/models`).
- `context`: the server's context window. OpenCode compacts the chat before it
  is full. Set it to the server's `--max-model-len` or lower.
- `output`: the most tokens for one reply. Default 4096.
- `input`: add `"image"` only when the server accepts images.

The model appears in the omg agent picker as `custom-<provider>/<model>`, for
example `custom-pc/gemma-4-e4b`. The picker reads the file again when it
changes.

## How it runs

```
picker ──▶ omg agent ──▶ OpenCode ──▶ provider "custom-pc" ──▶ your server
                                        ↑
                          written from ~/.omg/models.json
                          by ensureCustomProviders()
```

- `src/custom-models.ts` owns the file. At launch it writes each provider into
  OpenCode's config as `custom-<id>`. It removes a `custom-*` provider that is
  no longer in the file.
- An invalid entry is skipped. The other entries still load.

## Server requirements

- OpenAI-compatible `/v1/chat/completions`.
- Tool calls with `tool_choice: "auto"`. The agent edits files through tools.
  For vLLM, start with `--enable-auto-tool-choice --tool-call-parser <parser>`.
  Without it every turn fails with `"auto" tool choice requires
  --enable-auto-tool-choice`.
- A context of about 16k tokens or more. The OpenCode system prompt and tool
  list use several thousand tokens before the first message.

## Not in this version

- No routing of internal jobs (session titles, summaries) to a custom model.
- No fallback when the server is offline. The turn fails with the server error.
- No add or edit screen. Edit the file by hand.
