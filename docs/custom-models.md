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
- `context` (optional): the context window in tokens. With no value, omg asks
  the server at each session start: vLLM `max_model_len` on `/v1/models`, or
  llama.cpp `n_ctx` on `/props`. The answer is cached in
  `~/.omg/cache/custom-model-context.json`. Ollama does not report its served
  context, so set it by hand there. OpenCode compacts the chat against this
  size.
- `name` (model): the name the picker shows, for example
  `"Gemma 4 E4B (3060 Ti)"`. With no name, the picker makes one from the id:
  `gemma-4-e4b` shows as `Gemma 4 E4B`.
- `output`: the most tokens for one reply. Default 4096.
- `input`: add `"image"` only when the server accepts images.

The model id is `custom-<provider>/<model>`, for example
`custom-pc/gemma-4-e4b`. The picker shows its name, not the id. The picker reads the file again when it
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
- A context of about 16k tokens or more. The OpenCode system prompt and
  built-in tools use about 14k tokens before the first message.

## Tools by context size

OpenCode sends every tool description with every request. The omg.dev MCP
tools are large, so a custom model gets only what its context can hold. The
filter applies on each turn. The sizes are hardcoded from a measurement on
2026-10-12.

| Context | MCP tools |
|---|---|
| under 48k, or unknown | lite set: `omg_ship`, `omg_display_image`, `omg_display_file`, `omg_deploy`, `omg_deploy_status` (about 1.6k tokens) |
| 48k to under 256k | every `omg` and `computer` tool (about 17k tokens) |
| 256k or more | all, including `connectors` (about 200k tokens) |

OpenCode's base prompt and built-in tools take about 14k tokens.

## Not in this version

- No routing of internal jobs (session titles, summaries) to a custom model.
- No fallback when the server is offline. The turn fails with the server error.
- No add or edit screen. Edit the file by hand.
- No tool search. A small model cannot load an omg tool outside the lite set.
