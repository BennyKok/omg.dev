# Provider and agent marks

Audit date: 2026-10-11. Target: the existing web and mobile icon sets.
This checks the identity and shape of each mark. The app uses monochrome
provider marks so they remain legible in both themes.

`web/src/lib/model-provider-icon-paths.ts` owns provider geometry.
`bun scripts/generate-provider-icons.ts` generates all mobile sizes.
`bun scripts/generate-provider-icons.ts --check` compares decoded pixels with
that geometry. Mobile normalizes provider slugs in the same way as the web.

| Provider | Reference | Result |
| --- | --- | --- |
| Anthropic | [Anthropic](https://www.anthropic.com/company) | Retain the A and diagonal lettermark. |
| Callstack / Apex | [Official favicon](https://apex.callstack.com/favicon.png) | Retain the A lettermark. Add missing mobile assets. |
| DeepSeek | [DeepSeek](https://www.deepseek.com/) | Retain the whale. |
| MiniMax | [Official logo](https://www.minimax.io/assets/logo/minimax-horizontal-brand-black.webp) | Retain the waveform. |
| OpenAI | [Brand guidelines](https://openai.com/brand/) | Retain the Blossom. |
| Qwen | [Official Qwen Code mark](https://github.com/QwenLM/qwen-code/blob/main/packages/desktop/bootstrap/qwen-code-logo.svg) | Retain the three interlocking arrows. |
| xAI | [Brand guidelines](https://x.ai/legal/brand-guidelines) | Replace the generic X with the xAI lettermark. Add missing mobile assets. |
| Z.ai | [Official logo](https://z-cdn.chatglm.cn/z-ai/static/logo.svg) | Retain the diagonal Z. |

Anthropic, DeepSeek, MiniMax, OpenAI and Qwen vectors come from Simple Icons
(CC0). xAI and Z.ai vectors come from LobeHub Icons (MIT). Callstack uses the
lettermark from its favicon, without the green background.

## Agent artwork

`web/public/agent-*.svg` owns agent artwork. Mobile has PNGs at 32, 64 and
96 pixels. Bump `AGENT_ICON_VERSION` in `session-ui.tsx` when changing a served
SVG, because the web caches these URLs.

| Agent | Reference | Result |
| --- | --- | --- |
| Grok / Grok Build | [Official welcome mark](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/assets/logo/logo05.txt), [official app](https://apps.apple.com/us/app/grok-ai/id6670324846) | Replace the custom G and blue slash with the ring and pointed diagonal. Vector from LobeHub Icons (MIT). The brand ZIP download returned HTTP 403, so compare with the official app and terminal mark. |
| Devin | [Official symbol](https://devin.ai/assets/brand/logos/devin/symbol-light.svg) | Replace the custom teal D with the official geometric symbol. |
| Muse Code | [Meta Muse Code](https://dev.meta.ai/lp/muse-code), [Muse mark](https://muse.ai/images/favicon/app-squiggle.svg) | Replace the custom M with the official blue squiggle. Meta links to Muse from its Code page. |
| Cursor | [Brand kit](https://cursor.com/brand) | Retain the cube. |
| fx | [Official site](https://fx.sh/) | Retain the fx glyph. |
| Hermes | [Official favicon](https://github.com/NousResearch/hermes-agent/blob/main/website/static/img/favicon.svg) | Retain the portrait. |
| OpenCode | [Official brand mark](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/asset/brand/opencode-logo-light-square.svg) | Retain the rectangular mark with its lower inset. |
| Codex | [Official app](https://openai.com/index/introducing-the-codex-app/) | Retain the terminal mark. |
| Claude | [Claude](https://claude.ai/) | Retain the orange burst. |
| DeepSeek | [DeepSeek](https://www.deepseek.com/) | Retain the whale. |
| GitHub Copilot | [Primer icon](https://primer.style/foundations/icons/copilot-24) | Retain the Copilot mark. |
| omg | `web/public/icon.svg` | Retain the app's own mark. |
| Pi | [Source recorded in SVG](https://pi.dev/logo.svg) | Retain existing pinned geometry. Source returned HTTP 403 during this audit. |
| Jcode | [Source recorded in SVG](https://jcode.sh/favicon.svg) | Retain existing pinned torus geometry. Source returned HTTP 403 during this audit. |

The simulator fixture `scripts/provider-icons-e2e-entry.tsx` renders the actual
`AgentAvatar` and mobile picker PNGs. Run `bun run test:e2e --build --plan
provider-icons --record` with `OMG_E2E_ENTRY_FILE=scripts/provider-icons-e2e-entry.tsx`
to inspect agent and provider marks in both themes.

## LobeHub Icons license

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
