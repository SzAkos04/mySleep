import Foundation
import UserNotifications

/// Schedules the reminders NightKit plans (Reminders.all) as the phone's own notifications: the
/// bedtime one every day, the reinstall ones on their dates. Everything of ours is replaced each
/// time, so a changed bedtime or a reinstall leaves nothing stale. Asks for permission the first time.
enum NotifyStatus: Equatable { case unknown, denied, scheduled([String]) }

enum Notifier {
  @discardableResult
  static func apply(_ settings: AppSettings, expires: Date?) async -> NotifyStatus {
    let center = UNUserNotificationCenter.current()
    let plan = Reminders.all(settings, expires: expires, now: Date(), calendar: .current)
    center.removePendingNotificationRequests(withIdentifiers: Reminders.ids)
    guard !plan.isEmpty else { return .scheduled([]) }
    guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return .denied }
    for r in plan {
      let content = UNMutableNotificationContent()
      content.title = r.title; content.body = r.body; content.sound = .default
      content.interruptionLevel = r.id == "bedtime" ? .active : .timeSensitive
      let trigger: UNCalendarNotificationTrigger
      switch r.when {
      case .daily(let h, let m): trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: h, minute: m), repeats: true)
      case .once(let d): trigger = UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: d), repeats: false)
      }
      try? await center.add(UNNotificationRequest(identifier: r.id, content: content, trigger: trigger))
    }
    return .scheduled(await pending())
  }

  /// What is waiting, for the Simulator and the tests of the people.
  static func pending() async -> [String] { await UNUserNotificationCenter.current().pendingNotificationRequests().map(\.identifier).sorted() }
}
