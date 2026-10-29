import ActivityKit
import AlarmKit

/// The Live Activity during the night: its content is NightKit's LiveCard (what the card says and
/// when it was updated). Shared by the app, which starts and updates it, and the widget extension,
/// which draws it.
struct NightActivity: ActivityAttributes {
  typealias ContentState = LiveCard
  var night: String
}

/// The alarm's metadata (AlarmKit), shared so the widget extension can draw its snooze countdown.
struct NightAlarm: AlarmMetadata {}
