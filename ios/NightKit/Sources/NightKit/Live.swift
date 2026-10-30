import Foundation

/// What the lock screen card shows during the night (the Live Activity's content). Its times are
/// dates, so the card counts them itself without updates: iOS updates a Live Activity for 8 hours at
/// most, and only the app in the foreground may start a new one.
public struct LiveCard: Codable, Hashable, Sendable {
  public var started: Date
  public var ringFrom: Date?
  public var ringAt: Date?
  public var hearing: Bool
  public var updated: Date   // when the app last said how it is
  public var handedOver = false   // ended by the app before iOS's 8 hours: no more updates
  public var ringing = false      // the app's own, gentle alarm is ringing
  public init(started: Date, ringFrom: Date?, ringAt: Date?, hearing: Bool, updated: Date, handedOver: Bool = false) {
    self.started = started; self.ringFrom = ringFrom; self.ringAt = ringAt; self.hearing = hearing; self.updated = updated; self.handedOver = handedOver
  }

  public enum Status: Hashable, Sendable {
    case listening, notHearing, handedOver, ringing, stale(since: String)
    public var text: String {
      switch self {
      case .listening: "Listening"
      case .notHearing: "Not hearing anything"
      case .handedOver: "Still listening · live status in the app"
      case .ringing: "Good morning"
      case .stale(let since): "Not heard from since \(since) · open mySleep Night"
      }
    }
    /// A second, small line, where one is needed.
    public var hint: String? { self == .ringing ? "Stop it in the app" : nil }
  }

  /// `stale`: iOS marks the card stale when the app has not updated it (LivePlan.staleDate):
  /// the app was closed, so it must not claim to listen.
  public func status(stale: Bool, calendar: Calendar = .current) -> Status {
    ringing ? .ringing : handedOver ? .handedOver : stale ? .stale(since: clock(updated, calendar)) : hearing ? .listening : .notHearing
  }

  /// Snoozed: quiet again, and the alarm line says when it rings next.
  public func snoozed(until next: Date, now: Date) -> LiveCard {
    var c = self
    c.ringing = false; c.ringFrom = next; c.ringAt = next; c.updated = now
    return c
  }

  public func alarmLine(calendar: Calendar = .current) -> String {
    guard let ringAt else { return "No alarm" }
    guard let ringFrom, ringFrom != ringAt else { return "Alarm \(clock(ringAt, calendar))" }
    return "Alarm \(clock(ringFrom, calendar)) – \(clock(ringAt, calendar))"
  }

  private func clock(_ d: Date, _ c: Calendar) -> String { InstallStatus.clock(d, c) }
}

/// When the app updates, hands over and lets go of the card.
public enum LivePlan {
  public static let iosLimit: TimeInterval = 8 * 3600     // iOS ends a Live Activity after this
  public static let margin: TimeInterval = 600            // hand over before iOS does
  public static let linger: TimeInterval = 4 * 3600       // how long iOS keeps an ended one
  public static let staleAfter: TimeInterval = 180        // minute updates: three missed = stale
  public static let afterAlarm: TimeInterval = 1800

  /// The app ends the card itself here, with content that stays right without updates.
  public static func handOver(started: Date) -> Date { started.addingTimeInterval(iosLimit - margin) }

  /// An ended card stays until half an hour after the alarm, as long as iOS allows.
  public static func dismissal(ended: Date, ringAt: Date?) -> Date {
    let most = ended.addingTimeInterval(linger)
    guard let ringAt else { return most }
    if ringAt <= ended { return ended.addingTimeInterval(margin) }
    return min(most, ringAt.addingTimeInterval(afterAlarm))
  }

  public static func staleDate(updated: Date) -> Date { updated.addingTimeInterval(staleAfter) }
}

/// The alarm's own lock screen card (AlarmKit's Live Activity): what it says while it rings, while
/// snoozed (with the time it rings again) and paused.
public enum AlarmCard {
  public enum Phase: Sendable { case ringing, snoozing, paused }
  public struct Text: Equatable, Sendable {
    public let title: String, subtitle: String, showsTime: Bool
    public init(title: String, subtitle: String, showsTime: Bool) { self.title = title; self.subtitle = subtitle; self.showsTime = showsTime }
  }
  public static func text(_ p: Phase) -> Text {
    switch p {
    case .ringing: Text(title: "Good morning", subtitle: "mySleep Night is ringing", showsTime: false)
    case .snoozing: Text(title: "Snoozing", subtitle: "mySleep Night rings again at", showsTime: true)
    case .paused: Text(title: "Alarm paused", subtitle: "Open mySleep Night", showsTime: false)
    }
  }
}
