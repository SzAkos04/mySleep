import Foundation
@testable import NightKit

/// Local time as ms, the way the rules read it: `at(28, 23, 0)` is 28 October 2026, 23:00 here.
func at(_ day: Int, _ h: Int, _ m: Int, month: Int = 10, year: Int = 2026) -> Double {
  Clock.ms(Calendar.current.date(from: DateComponents(year: year, month: month, day: day, hour: h, minute: m))!)
}

enum Fixtures {
  static let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")

  /// A night as the app logs it: `seconds` from `start`, quiet with 15 min tossing first, a gap at
  /// second 100; `extra(i)` changes a second (db, low).
  static func log(night: String = "2026-10-29", start: Double = at(29, 23, 0), seconds: Int = 8 * 3600, final: Bool = true,
                  events: [NightLog.Event]? = nil, second: ((Int) -> (db: Double, low: Double)?)? = nil) -> NightLog {
    var db: [Double?] = [], low: [Double?] = [], mid: [Double?] = [], vr: [Double?] = [], atv: [Double?] = []
    for i in 0..<seconds {
      let toss = i < 900 && i % 20 < 2
      let s = second?(i) ?? (toss ? 45 : 30 + Double(i % 7) / 4, 0.3)
      db.append(s.db); low.append(s.low); mid.append(0.3); vr.append(1); atv.append(toss ? 2 : 1)
    }
    db[100] = nil   // a gap, as JSON keeps it
    let ev = events ?? [.init(ms: 0, type: "start"), .init(ms: 3600e3, type: "interruption-began"),
                        .init(ms: 3610e3, type: "audio", data: ["reason": .string("interruption-ended")]), .init(ms: 7 * 3600e3, type: "mic-silent"),
                        .init(ms: 7.4 * 3600e3, type: "wake", data: ["early": .number(12)]), .init(ms: 7.4 * 3600e3 + 2000, type: "alarm-ringing"),
                        .init(ms: Double(seconds) * 1000, type: "finish")]
    return NightLog(night: night, start: start, final: final, samples: .init(start: start, db: db, low: low, mid: mid, vr: vr, at: atv), events: ev)
  }

  /// The night RulesTests' fixture.js made (three hours from 22:00 UTC, 5 min of snoring at 2 h, the
  /// alarm 12 min early): 165.5 min asleep.
  static func shortLog() -> NightLog {
    let start = Clock.ms(Calendar(identifier: .gregorian).date(from: DateComponents(timeZone: .gmt, year: 2026, month: 10, day: 29, hour: 22))!)
    var db: [Double?] = [], low: [Double?] = [], atv: [Double?] = []
    for i in 0..<(3 * 3600) {
      let toss = i < 900 && i % 20 < 2, snore = i > 7200 && i < 7500 && i % 5 < 2
      db.append(toss ? 45 : snore ? 41 : 30 + Double(i % 7) / 4); low.append(snore ? 0.6 : 0.3); atv.append(toss ? 2 : 1)
    }
    db[100] = nil
    let n = 3 * 3600
    return NightLog(night: "2026-10-29", start: start, final: true,
                    samples: .init(start: start, db: db, low: low, mid: Array(repeating: 0.3, count: n), vr: Array(repeating: 1, count: n), at: atv),
                    events: [.init(ms: 0, type: "start"), .init(ms: 3600e3, type: "interruption-began"),
                             .init(ms: 3610e3, type: "audio", data: ["reason": .string("interruption-ended")]),
                             .init(ms: 2.5 * 3600e3, type: "wake", data: ["early": .number(12)]), .init(ms: 2.5 * 3600e3 + 2000, type: "alarm-ringing"),
                             .init(ms: Double(n) * 1000, type: "finish")])
  }
}

