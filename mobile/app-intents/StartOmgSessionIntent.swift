import AppIntents
internal import ExpoAppIntents

/// "Hey Siri, start a session in omg.dev" -- the one action this app is for.
///
/// `openAppWhenRun` is true on purpose. Starting a session needs the signed-in
/// account and the selected computer, both of which live in the JavaScript
/// runtime behind `provider.tsx`, so there is nothing for a headless intent to
/// call. Opening the app and dispatching the prompt reuses the session
/// creation path the composer already uses, rather than adding a second one
/// that would have to learn auth on its own.
///
/// The prompt is NOT interpolated into the shortcut phrase. A classic App
/// Shortcut phrase resolves its parameters against a fixed catalog of values,
/// and the task an agent should do is open text. Leaving the parameter out of
/// the phrase makes the system ask for it with `requestValueDialog`, which is
/// the supported way to collect free text on iOS 16.4.
struct StartOmgSessionIntent: AppIntent {
  static let title: LocalizedStringResource = "Start a session"
  static let description = IntentDescription("Start a new coding agent session on your computer.")

  /// Opening the app is the point: the JavaScript side does the work.
  static let openAppWhenRun: Bool = true

  @Parameter(
    title: "Task",
    description: "What the agent should do.",
    requestValueDialog: "What should the agent do?"
  )
  var prompt: String

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    await AppIntentDispatcher.shared.dispatch(
      name: "startSession",
      params: ["prompt": .string(prompt)]
    )
    return .result(dialog: "Starting a session.")
  }
}
