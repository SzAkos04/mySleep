import ActivityKit
import AlarmKit
import AppIntents
import Foundation

/// The Live Activity during the night: its content is NightKit's LiveCard (what the card says and
/// when it was updated). Shared by the app, which starts and updates it, and the widget extension,
/// which draws it.
struct NightActivity: ActivityAttributes {
  typealias ContentState = LiveCard
  var night: String
}

/// The alarm's metadata (AlarmKit), shared so the widget extension can draw its snooze countdown.
struct NightAlarm: AlarmMetadata {}

/// Snooze from the lock screen card while the app's own alarm rings. A Live Activity's intent runs
/// in the app's process; the engine listens for this (stopping takes the held button in the app).
struct SnoozeIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Snooze"
  func perform() async throws -> some IntentResult {
    await MainActor.run { NotificationCenter.default.post(name: .mySleepSnooze, object: nil) }
    return .result()
  }
}

extension Notification.Name { static let mySleepSnooze = Notification.Name("mySleepSnooze") }
