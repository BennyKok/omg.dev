import {
  createSameOriginTransport,
  type OmgSocket,
  type OmgTransport,
  type OmgUploadProgress,
} from "@omg-dev/client";

/**
 * Did this failure come from the box refusing on PLAN grounds?
 *
 * Two deliberate choices here.
 *
 * It reads a CODE, not the message. The server tags exactly the refusals a
 * paying host can do something about (see ApiErrorCode in
 * src/commands/serve.ts); everything else — including the identical "too many
 * agents" wall on a self-hosted install, which is a local setting, not a plan —
 * stays an ordinary error. Matching prose instead would break the next time
 * that sentence is edited.
 *
 * And it is STRUCTURAL, not `instanceof OmgApiError`. An embedding host builds
 * the transport itself, with its OWN copy of @omg-dev/client (see
 * computer-transport-cache.ts on the omg side) — so the error that lands here
 * is an instance of that copy's class, not of the one bundled into this
 * surface. `instanceof` across those two realms is always false, which would
 * make this quietly return false forever on the exact surface the feature
 * exists for.
 */
export function isPlanLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "plan_limit"
  );
}

/**
 * Did the box refuse because of the LOCAL live-agent cap?
 *
 * The sibling of the check above, and deliberately a separate code rather than
 * a flag on the same one. This refusal comes from a number its own owner chose
 * in Settings on hardware they already paid for, so the only honest responses
 * are "start it anyway" and "change the number" — never an upgrade. Reading the
 * code, not the sentence, for the same two reasons documented above.
 */
export function isAgentLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "agent_limit"
  );
}

// Standalone lfg and every embeddable host use the same transport contract.
// The standalone adapter is deliberately tiny because Vite/lfg serve keeps the
// UI and runtime on one origin; omg supplies the authenticated grant adapter.
let omgTransport: OmgTransport = createSameOriginTransport();
let omgAssetBaseUrl = "";

/**
 * Where a hosted surface mirrors client errors, in addition to reporting them
 * through the transport into the user's own lfg instance.
 *
 * Host-supplied rather than hardcoded: standalone and self-hosted lfg have no
 * business phoning a vendor endpoint, and the URL belongs to whoever is doing
 * the hosting.
 */
export type OmgErrorSink = {
  url: string;
  /** Short label for which host surface this is, e.g. "omg-dashboard". */
  surface?: string;
  /** Version of the embedded lfg app, so a report can be pinned to a build. */
  appVersion?: string;
};

let omgErrorSinkConfig: OmgErrorSink | null = null;
let omgTransportGenerationCounter = 0;

/**
 * Installs the host-owned runtime boundary before the shared LFG application
 * mounts. Standalone LFG never calls this and keeps the same-origin adapter.
 */
export function configureOmgTransport(
  transport: OmgTransport,
  options: { assetBaseUrl?: string; errorSink?: OmgErrorSink } = {},
): void {
  // Bump only on a genuine swap. A host re-renders this surface freely and
  // calls us with the same transport object each time; treating that as a
  // change would blank the version rows on every render.
  if (transport !== omgTransport) omgTransportGenerationCounter += 1;
  omgTransport = transport;
  omgAssetBaseUrl = options.assetBaseUrl?.replace(/\/+$/, "") ?? "";
  omgErrorSinkConfig = options.errorSink ?? null;
}

/**
 * Which transport a value was fetched over.
 *
 * A host switches Computers by handing us a new transport, in place — the app
 * tree is not remounted, so state captured from the previous machine survives
 * the switch. Anything claiming to describe "the selected Computer" has to
 * record this counter alongside the value and discard it when the counter
 * moves, or it will keep displaying the old box's answer under the new box's
 * name. Settings' Computer version row is the first such reader.
 */
export function omgTransportGeneration(): number {
  return omgTransportGenerationCounter;
}

export function omgErrorSink(): OmgErrorSink | null {
  return omgErrorSinkConfig;
}

export function api<T>(path: string, init?: RequestInit): Promise<T> {
  return omgTransport.request<T>(path, init);
}

export function omgFetch(path: string, init?: RequestInit): Promise<Response> {
  return omgTransport.fetch(path, init);
}

export function omgUpload(
  path: string,
  init: RequestInit,
  onProgress: (progress: OmgUploadProgress) => void,
): Promise<Response> {
  return omgTransport.upload?.(path, init, onProgress) ??
    omgTransport.fetch(path, init);
}

export function openOmgLiveSocket(): Promise<OmgSocket> {
  return omgTransport.openLiveSocket();
}

export function openOmgSocket(path: string): Promise<OmgSocket> {
  return omgTransport.openSocket(path);
}

export function omgAssetUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${omgAssetBaseUrl}${normalizedPath}`;
}
