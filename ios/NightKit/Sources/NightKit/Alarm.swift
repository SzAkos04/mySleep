import Foundation

/// The alarm as the person sets it: on or off, the wake time, and the smart window.
public struct AlarmSettings: Codable, Equatable, Sendable {
  public var on: Bool
  public var smart: Bool
  public var hour: Int
  public var minute: Int
  public init(on: Bool, smart: Bool, hour: Int, minute: Int) { self.on = on; self.smart = smart; self.hour = hour; self.minute = minute }
  public var time: String { String(format: "%02d:%02d", hour, minute) }
}

/// When tonight's alarm rings, the same rules as the web app's (frontend/src/lib/night.js):
/// at the next wake time, or, when smart, from SMART_MIN before it once the sleeper stirs.
public struct AlarmPlan: Equatable, Sendable {
  public static let smartMinutes = 30
  public static let snoozeMinutes = 9
  /// The system alarm (AlarmKit) rings at full volume at once, so it waits this long behind the
  /// app's own alarm, which rises from near silence: it rings only if the app could not, or nobody
  /// stopped it.
  public static let backupDelay: TimeInterval = 120
  public var backup: Date { at.addingTimeInterval(Self.backupDelay) }
  public static func backup(afterRingingAt t: Date) -> Date { t.addingTimeInterval(backupDelay) }
  public static func snoozed(at t: Date) -> AlarmPlan {
    let next = t.addingTimeInterval(Double(snoozeMinutes) * 60)
    return AlarmPlan(from: next, at: next)
  }
  public let from: Date
  public let at: Date
  public init(from: Date, at: Date) { self.from = from; self.at = at }

  public static func make(_ s: AlarmSettings, from now: Date, calendar: Calendar = .current) -> AlarmPlan? {
    guard s.on, let at = calendar.nextDate(after: now, matching: DateComponents(hour: s.hour, minute: s.minute, second: 0), matchingPolicy: .nextTime) else { return nil }
    // inside the window already: it starts now, not in the past
    let open = s.smart ? max(now, at.addingTimeInterval(-Double(smartMinutes) * 60)) : at
    return AlarmPlan(from: open, at: at)
  }

  /// Checked every few seconds; `isStirring` (the sound analysis) is only asked inside the window.
  public func shouldRing(at now: Date, smart: Bool, isStirring: () -> Bool) -> Bool {
    if now >= at { return true }
    return smart && now >= from && isStirring()
  }

  public func label(calendar: Calendar = .current) -> String {
    let f = DateFormatter(); f.calendar = calendar; f.timeZone = calendar.timeZone; f.dateFormat = "HH:mm"
    return from == at ? f.string(from: at) : "\(f.string(from: from)) – \(f.string(from: at))"
  }
}

/// The alarm's loudness while the app rings by itself (no system alarm): the web app's curve
/// (tracker.js riseCurve), smooth in decibels from -42 dB, easing into full at `seconds`, then held.
public enum RiseCurve {
  public static let fromDb = -42.0, seconds = 25.0
  public static func gain(at t: Double) -> Double {
    let x = min(max(t / seconds, 0), 1)
    return pow(10, fromDb * (1 - x) * (1 - x) / 20)
  }
}
