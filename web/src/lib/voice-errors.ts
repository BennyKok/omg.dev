export type VoiceErrorCode =
  | "provider_not_configured"
  | "invalid_api_key"
  | "credit_balance_exhausted"
  | "rate_limited"
  | "provider_unreachable"
  | "transcription_failed"
  | "realtime_only";

export type VoiceSttResponse = {
  text?: string;
  error?: string;
  code?: VoiceErrorCode | string;
  provider?: string;
  retryable?: boolean;
};

function providerName(provider: unknown): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "elevenlabs") return "ElevenLabs";
  if (provider === "omg") return "omg.dev";
  return "The speech provider";
}

/** Convert the stable server code to user text. Do not display provider response bodies. */
export function voiceErrorMessage(payload: VoiceSttResponse, status = 0): string {
  const provider = providerName(payload.provider);
  switch (payload.code) {
    case "provider_not_configured":
      return `${provider} is not configured. Add an API key in Voice settings.`;
    case "invalid_api_key":
      return `${provider} rejected the API key. Replace it in Voice settings.`;
    case "credit_balance_exhausted":
      return `${provider} API credit is empty. Add credit in the provider billing settings.`;
    case "rate_limited":
      return `${provider} is rate limiting transcription. Wait and try again.`;
    case "provider_unreachable":
      return `Could not reach ${provider}. Check the connection and try again.`;
    case "realtime_only":
      return "Live transcription ended before it returned text. Record the message again.";
    case "transcription_failed":
      return `${provider} could not transcribe this recording. Try again.`;
    default:
      if (status === 401 || status === 403) return "The speech API key was rejected. Check Voice settings.";
      if (status === 429) return "Speech transcription is temporarily unavailable. Check API credit or try again later.";
      return "Speech transcription failed. Try again.";
  }
}

