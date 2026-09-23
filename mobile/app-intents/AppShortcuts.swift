import AppIntents

/// The spoken phrases the system compiles into the app.
///
/// Every phrase must contain `\(.applicationName)`, and the list is fixed at
/// BUILD time: nothing here can be added from JavaScript at runtime. Ten is
/// the system limit for one app.
struct AppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartOmgSessionIntent(),
      phrases: [
        "Start a session in \(.applicationName)",
        "New session in \(.applicationName)",
        "Start a \(.applicationName) agent",
      ],
      shortTitle: "Start a session",
      systemImageName: "sparkles"
    )
  }
}
