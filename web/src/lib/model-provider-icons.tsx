// Provider marks for the hosted omg model picker.
//
// Every `omg/<provider>/<model>` row shows the mark of the lab that serves
// it, next to the short model name from packages/protocol/src/omg-model-display.
// Vector marks use `fill="currentColor"` like brand-icons.tsx, so the mark takes
// the row's text colour in both themes and never fights the selected tint.
//
// Path data: Simple Icons (https://simpleicons.org, CC0) for anthropic,
// deepseek, minimax, openai and qwen, viewBox 0 0 24 24, unmodified beyond
// dropping the fill. xAI and Z.ai marks are from
// lobehub/lobe-icons (MIT, Copyright (c) 2023 LobeHub), viewBox 0 0 24 24.
// The native app rasterises the same paths to mobile/assets/providers.

import { PROVIDER_PATHS } from "./model-provider-icon-paths";

/** Provider slug from the id -> icon key. `z-ai` in the id is `zai` here. */
export function modelProviderIconKey(provider: string | null | undefined): string | null {
  if (!provider) return null;
  const key = provider.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PROVIDER_PATHS[key] ? key : null;
}

export function ModelProviderIcon({
  provider,
  className,
}: {
  provider: string | null | undefined;
  className?: string;
}) {
  const key = modelProviderIconKey(provider);
  if (!key) return null;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true" className={className}>
      <path d={PROVIDER_PATHS[key]} />
    </svg>
  );
}
