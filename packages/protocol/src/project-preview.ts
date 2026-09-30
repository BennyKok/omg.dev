export interface ProjectPreview {
  sessionId: string;
  title: string;
  url: string;
  port: number;
  kind: "sandbox-preview";
  visibility: "owner";
  temporary: true;
  createdAt: number;
  /** `exps://` link that opens the same live Metro server in Expo Go. */
  expoGoUrl?: string;
  /** When the Expo Go link stops working, in epoch milliseconds. */
  expoGoExpiresAt?: number;
  /**
   * True while the preview has never answered on its port. An Expo Go link is
   * created before Metro is running, so a new preview is not "stopped", it has
   * not started yet. Cleared the first time the port answers. Absent on rows
   * from older Computers, which then behave as before.
   */
  notStartedYet?: true;
}

export interface ProjectPreviewSnapshot {
  preview: ProjectPreview | null;
  /** False when nothing listens on the preview port, for example after the Computer slept. Absent from older Computers. */
  live?: boolean;
  /** True when the Expo Go link has expired. `live` is then false as well. */
  expired?: boolean;
  /** True when the preview has not answered on its port even once. Clients hide the card until then. */
  starting?: boolean;
  /**
   * Level 2 of the preview card: an iOS Simulator streamed into the page.
   * Present only when the Computer has the simulator flag on
   * (`LFG_PREVIEW_SIMULATOR=1`) and the preview is an Expo app. Clients show
   * the "Simulator" level only when this field is present.
   */
  simulator?: SimulatorStream;
}

/**
 * The three levels of one preview card. "web" is Expo Web from the same Metro
 * server, "simulator" is a streamed iOS Simulator, "device" is Expo Go on the
 * user's own phone. A future "install" level (a signed build for the user's
 * device) goes after "device".
 */
export type PreviewLevel = "web" | "simulator" | "device";

/**
 * One streamed simulator for one preview. The card embeds `streamUrl` (an
 * iframe on the web, a WebView in the app). That page draws the screen and
 * sends taps, typing and swipes itself, so the card needs no input protocol.
 * Until the state is "ready", the card keeps the web preview (level 1) under
 * a status overlay, so the user never sees a blank frame.
 */
export interface SimulatorStream {
  /**
   * idle: nothing allocated; the card offers "Start simulator".
   * queued: every simulator is busy. Normal, not an error; see `queuePosition`.
   * starting: allocated, booting or opening the app; see `phase`.
   * ready: `streamUrl` works now.
   * unavailable: no simulator can serve this user now; show `message`.
   * error: the last start failed; show `message` and offer a retry.
   */
  state: "idle" | "queued" | "starting" | "ready" | "unavailable" | "error";
  /**
   * Identity of the allocated stream. The card reloads its frame only when
   * this changes, not when the token inside `streamUrl` rotates. The stream
   * page renews its own token before `expiresAt`.
   */
  streamId?: string;
  /**
   * HTTPS page that shows the stream and takes input (touch and mouse). It
   * carries a short-lived token scoped to this user and session. Its origin
   * must allow the omg.dev apps as frame ancestors. Required when "ready".
   */
  streamUrl?: string;
  /** When the token in `streamUrl` stops working, in epoch milliseconds. */
  expiresAt?: number;
  /** 1 is next. Only when "queued". */
  queuePosition?: number;
  /** Estimated wait until "ready", in milliseconds. "queued" or "starting". */
  etaMs?: number;
  /** The current start step. Only when "starting". Openurl to first frame takes 19 to 54 s, so the card names the step. */
  phase?: "allocating" | "booting" | "opening" | "loading_bundle";
  /** Start progress from 0 to 1, when the provider can tell. */
  progress?: number;
  /** One plain sentence for the user when `state` is "unavailable" or "error". */
  message?: string;
}

/**
 * The owner of level 2. The Computer calls it; the card never talks to it
 * directly, and the Computer never holds a Mac credential: the provider calls
 * the control plane with the Computer's binding credential.
 *
 * Release rule: the card polls the snapshot about every 3 seconds, and only
 * while its page is visible. A backgrounded mobile tab sends no unload
 * event, so `stop` is best effort. The provider frees a simulator when it has
 * had no `status` call and no stream viewer for 60 seconds.
 *
 * `preview` carries the Metro URL (`url`) and the Expo Go link (`expoGoUrl`)
 * that the simulator must open.
 */
export interface SimulatorStreamProvider {
  /**
   * Cheap; called on every card poll. With `autoStart`, the provider may
   * start a simulator from here when Metro is ready, so the user sees the
   * phone without a tap.
   */
  status(preview: ProjectPreview): Promise<SimulatorStream>;
  /** The user tapped "Start simulator". Returns the new state: "queued" or "starting". */
  start(preview: ProjectPreview): Promise<SimulatorStream>;
  /** The user left the Simulator level. Best effort; see the release rule. */
  stop(preview: ProjectPreview): Promise<void>;
  /** Start from `status` without a tap. Default off. */
  autoStart?: boolean;
  /**
   * False hides the Simulator level for now, for example when this user may
   * not use it. Checked on every card poll, so keep it cheap. Absent = true.
   */
  available?(): boolean;
}

/** Card action for level 2: POST with `{ sessionId, action: "start" | "stop" }`. Answers with a SimulatorStream. */
export const PROJECT_PREVIEW_SIMULATOR_PATH = "/api/project-preview/simulator";

/** Message a preview card sends to ask the session agent to start the preview again. */
export const PROJECT_PREVIEW_RESTART_MESSAGE =
  "The preview stopped. Restart it: start the development server again and expose it with omg_expose_port. For an Expo app, request a new Expo Go link.";

const SIMULATOR_PHASE_TEXT: Record<NonNullable<SimulatorStream["phase"]>, string> = {
  allocating: "Finding a free iPhone simulator…",
  booting: "Starting the iPhone simulator…",
  opening: "Opening your app…",
  loading_bundle: "Loading your app…",
};

/** A rough wait for the card: seconds under 90 s, then whole minutes. */
export function formatWait(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  return m === 1 ? "1 min" : `${m} min`;
}

/** One line for the card while level 2 is not ready. Null when the stream shows. */
export function simulatorStatusText(stream: SimulatorStream): string | null {
  const eta = stream.etaMs && stream.etaMs > 0 ? ` About ${formatWait(stream.etaMs)}.` : "";
  switch (stream.state) {
    case "ready": return stream.streamUrl ? null : "Opening the simulator…";
    case "idle": return "See your app on an iPhone simulator.";
    case "queued": return `All simulators are busy. You are number ${stream.queuePosition ?? 1} in line.${eta}`;
    case "starting": return `${stream.phase ? SIMULATOR_PHASE_TEXT[stream.phase] : "Starting the iPhone simulator…"}${eta}`;
    case "unavailable": return stream.message ?? "The simulator is not available now.";
    case "error": return stream.message ?? "The simulator did not start.";
  }
}

/** The levels a card offers, in order. "simulator" only when the Computer sends its state. */
export function previewLevels(snapshot: Pick<ProjectPreviewSnapshot, "simulator">): PreviewLevel[] {
  return snapshot.simulator ? ["web", "simulator", "device"] : ["web", "device"];
}

/** Tab labels, shared by the web and native cards. */
export const PREVIEW_LEVEL_LABEL: Record<PreviewLevel, string> = {
  web: "Web",
  simulator: "Simulator",
  device: "Your phone",
};

/**
 * The URL an inline frame loads for the web level. The owner URL (`url`)
 * needs the preview sign-in cookie, and an embedded frame does not get it:
 * it is a third-party cookie inside app.omg.dev and inside the app's WebView,
 * so the frame showed "Sign in to continue". The Expo Go host is a signed,
 * short-lived capability URL for the same Metro port, and Metro answers it
 * with the Expo Web page. A plain web preview has no such host and keeps `url`.
 */
export function inlinePreviewUrl(preview: Pick<ProjectPreview, "url" | "expoGoUrl">): string {
  return preview.expoGoUrl?.startsWith("exps://") ? `https://${preview.expoGoUrl.slice("exps://".length)}` : preview.url;
}
