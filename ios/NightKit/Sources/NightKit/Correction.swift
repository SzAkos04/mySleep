import Foundation

/// A night's times as the correction sheet holds them: when you went to bed, fell asleep and woke.
/// "Fell asleep" may be missing (no sleep was found): then it is sent blank, which the rules read as
/// "no sleep", and it stays so until the sleeper adds one.
public struct Correction: Equatable {
  public var bed: Date, wake: Date
  public var on: Date?

  public struct Texts: Equatable { public let bed: String, on: String, wake: String }

  static let format: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; f.locale = Locale(identifier: "en_US_POSIX"); return f }()

  public init(_ t: ReportView.Times) {
    func date(_ hm: String) -> Date { Self.format.date(from: hm) ?? Date() }
    bed = date(t.bed); wake = date(t.wake)
    on = t.on.isEmpty ? nil : date(t.on)
  }

  /// "HH:MM" for each, as the rules take them (`on` blank: none).
  public var texts: Texts { Texts(bed: Self.format.string(from: bed), on: on.map(Self.format.string(from:)) ?? "", wake: Self.format.string(from: wake)) }

  /// Starts where the night does, to be moved from there.
  public mutating func addFellAsleep() { on = bed }
  public mutating func removeFellAsleep() { on = nil }
}
