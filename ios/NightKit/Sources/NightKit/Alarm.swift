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

/// When tonight's alarm rings: the system alarm (AlarmKit) at the wake time, or, when smart, from
/// `smartMinutes` before it, as soon as the sleeper stirs (the app then brings the alarm forward).
public struct AlarmPlan: Equatable, Sendable {
  public static let smartMinutes = 30
  public static let snoozeMinutes = 9
  public let from: Date
  public let at: Date
  public init(from: Date, at: Date) { self.from = from; self.at = at }

  public static func make(_ s: AlarmSettings, from now: Date, calendar: Calendar = .current) -> AlarmPlan? {
    guard s.on, let at = calendar.nextDate(after: now, matching: DateComponents(hour: s.hour, minute: s.minute, second: 0), matchingPolicy: .nextTime) else { return nil }
    // inside the window already: it starts now, not in the past
    let open = s.smart ? max(now, at.addingTimeInterval(-Double(smartMinutes) * 60)) : at
    return AlarmPlan(from: open, at: at)
  }

  /// Checked every few seconds: ring now, before the wake time? `isStirring` (the sound analysis)
  /// is only asked inside the window. At the wake time the system alarm rings by itself.
  public func ringsEarly(at now: Date, smart: Bool, isStirring: () -> Bool) -> Bool {
    smart && now >= from && now < at && isStirring()
  }

  public func label(calendar: Calendar = .current) -> String {
    let clock = { InstallStatus.clock($0, calendar) }
    return from == at ? clock(at) : "\(clock(from)) – \(clock(at))"
  }
}

/// AlarmKit's alarm as the app sees it.
public enum AlarmPhase: Sendable { case none, set, ringing, snoozed }

/// Moving the alarm: `schedule` cancels it and sets it for a date. When that fails, the alarm it had
/// (`old`, if still to come) is set again: a move that fails must not leave no alarm at all.
public enum AlarmMove {
  public static func run(from old: Date?, to new: Date, now: Date, schedule: (Date) async throws -> Void) async -> (at: Date?, error: Error?) {
    do { try await schedule(new); return (new, nil) } catch {
      guard let old, old > now, (try? await schedule(old)) != nil else { return (nil, error) }
      return (old, error)
    }
  }
}

/// What the alarm did in the morning, followed through AlarmKit's states: the minutes early it first
/// rang, the snoozes, and when it was stopped (`step` true: the night is over).
public struct WakeTally: Equatable, Sendable {
  public private(set) var early: Int?
  public private(set) var snoozes = 0
  public init() {}
  /// `early`: how many minutes before the wake time, if this is a ring.
  public mutating func step(from: AlarmPhase, to: AlarmPhase, early e: Int) -> Bool {
    if to == .ringing && early == nil { early = e }
    if from == .ringing && to == .snoozed { snoozes += 1 }
    return to == .none && (from == .ringing || from == .snoozed)
  }
}

/// Settings › Alarm test: where the system alarm's test stands, in words.
public enum AlarmTest: Equatable, Sendable {
  case idle, waiting(Int), ringing, heard, denied, failed(String)
  /// It did not ring: the words are a warning.
  public var warns: Bool { switch self { case .denied, .failed: true; default: false } }
  public var busy: Bool { if case .waiting = self { return true }; return self == .ringing }
  public var text: String? {
    switch self {
    case .idle: nil
    case .waiting(let s): "Rings in \(s) s. Lock the phone and listen."
    case .ringing: "It is ringing: Stop or Snooze ends the test."
    case .heard: "It rang and the test is over."
    case .denied: "Alarms are not allowed: turn them on for mySleep in iOS Settings."
    case .failed(let why): "The alarm did not ring: \(why)"
    }
  }
}
