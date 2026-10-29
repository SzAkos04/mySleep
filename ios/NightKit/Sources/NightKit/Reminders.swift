import Foundation

/// A notification the phone schedules for itself.
public struct Reminder: Equatable, Sendable {
  public enum When: Equatable, Sendable { case daily(hour: Int, minute: Int), once(Date) }
  public let id: String, title: String, body: String
  public let when: When
}

/// The reminders, as the server sent them as web pushes (api/server.js, api/reminders.js) until the
/// phone took it over: a free Apple ID has no push, but a notification the app scheduled itself
/// arrives without it. Pure: what to schedule, not the scheduling.
public enum Reminders {
  public static let bedtimeMinutes = 30

  /// Every day, `bedtimeMinutes` before bedtime.
  public static func bedtime(_ s: AppSettings) -> Reminder? {
    guard s.remind else { return nil }
    let hm = s.bedtime.split(separator: ":").compactMap { Int($0) }
    guard hm.count == 2, (0..<24).contains(hm[0]), (0..<60).contains(hm[1]) else { return nil }
    let at = (hm[0] * 60 + hm[1] - bedtimeMinutes + 1440) % 1440
    return Reminder(id: "bedtime", title: "Bedtime in \(bedtimeMinutes) min", body: "Lights out at \(s.bedtime).", when: .daily(hour: at / 60, minute: at % 60))
  }

  /// The free signature runs out on `expires` (7 days after the install): a heads-up two days before,
  /// one on the last day, one when it has stopped; each at 9:00, and only what is still to come.
  public static func expiry(expires: Date?, now: Date, calendar: Calendar) -> [Reminder] {
    guard let expires else { return [] }
    func nine(_ d: Date) -> Date { calendar.date(bySettingHour: 9, minute: 0, second: 0, of: d) ?? d }
    func days(_ n: Int) -> Date { calendar.date(byAdding: .day, value: n, to: expires) ?? expires }
    let weekday = { () -> String in let f = DateFormatter(); f.calendar = calendar; f.timeZone = calendar.timeZone; f.locale = Locale(identifier: "en_US"); f.dateFormat = "EEEE"; return f.string(from: expires) }()
    let todayAt = nine(expires)
    let all: [(Reminder, Date)] = [
      (Reminder(id: "reinstall-soon", title: "mySleep Night stops on \(weekday)", body: "Reinstall it from the Mac before then: connect the iPhone and run the install.", when: .once(nine(days(-2)))), nine(days(-2))),
      // an install that runs out before 9:00 has no "tonight": it has stopped by then
      (Reminder(id: "reinstall-today", title: "mySleep Night stops tonight", body: "Reinstall it from the Mac today, or tonight will not be recorded.", when: .once(todayAt)), todayAt < expires ? todayAt : .distantPast),
      (Reminder(id: "reinstall-expired", title: "mySleep Night has stopped", body: "It cannot record a night until it is reinstalled from the Mac.", when: .once(todayAt < expires ? nine(days(1)) : todayAt)), todayAt < expires ? nine(days(1)) : todayAt)
    ]
    return all.filter { $0.1 > now }.map(\.0)
  }

  /// All of it, for the settings and the install as they are.
  public static func all(_ s: AppSettings, expires: Date?, now: Date, calendar: Calendar) -> [Reminder] {
    (bedtime(s).map { [$0] } ?? []) + expiry(expires: expires, now: now, calendar: calendar)
  }
}
