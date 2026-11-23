import Foundation

/// Times of a night in the phone's local time. A night is named after its evening ("2026-10-29"),
/// clock times are "HH:MM", and times as ms since 1970.
public enum Clock {
  static var cal: Calendar { Calendar.current }
  static let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

  static func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }
  public static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }
  static func pad(_ n: Int) -> String { n < 10 && n >= 0 ? "0\(n)" : "\(n)" }

  /// The night a moment belongs to: anything before noon belongs to the day before.
  public static func nightId(_ ms: Double) -> String { id(of: date(ms - 12 * 3600e3)) }
  static func id(of d: Date) -> String {
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return "\(c.year ?? 1970)-\(pad(c.month ?? 1))-\(pad(c.day ?? 1))"
  }
  /// (year, month 1-12, day) of a night's id.
  static func ymd(_ id: String) -> (Int, Int, Int) {
    let p = id.split(separator: "-").map { Int($0) ?? 1 }
    return (p.first ?? 1970, p.count > 1 ? p[1] : 1, p.count > 2 ? p[2] : 1)
  }
  /// Noon on the night's date.
  static func noon(_ id: String) -> Date {
    let (y, m, d) = ymd(id)
    return cal.date(from: DateComponents(year: y, month: m, day: d, hour: 12)) ?? Date(timeIntervalSince1970: 0)
  }
  static func hm(_ hhmm: String) -> (Int, Int) {
    let p = hhmm.split(separator: ":").map { Int($0) ?? 0 }
    return (p.first ?? 0, p.count > 1 ? p[1] : 0)
  }

  /// "HH:MM" on a night: evening hours on its date, morning hours on the next.
  public static func atClock(_ id: String, _ hhmm: String) -> Double {
    let (h, m) = hm(hhmm)
    var day = noon(id)
    if h * 60 + m < 720 { day = cal.date(byAdding: .day, value: 1, to: day) ?? day }
    return ms(cal.date(bySettingHour: h, minute: m, second: 0, of: day) ?? day)
  }

  public static func clockOf(_ ms: Double) -> String {
    let c = cal.dateComponents([.hour, .minute], from: date(ms))
    return pad(c.hour ?? 0) + ":" + pad(c.minute ?? 0)
  }

  /// "45 min", "2h 05m": whole minutes first, so 119.6 is 2h 00m, not 1h 60m.
  public static func dur(_ min: Double) -> String {
    if min < 59.5 { return "\(JS.int(min)) min" }
    let t = JS.int(min)
    return "\(t / 60)h \(pad(t % 60))m"
  }
  /// "once" or "3 times"
  static func times(_ n: Int) -> String { n == 1 ? "once" : "\(n) times" }
  /// "Wed, Oct 28"
  public static func dayLabel(_ id: String) -> String {
    let c = cal.dateComponents([.weekday, .month, .day], from: noon(id))
    return "\(days[(c.weekday ?? 1) - 1]), \(months[(c.month ?? 1) - 1]) \(c.day ?? 1)"
  }

  /// Clock times as minutes after noon, so a night's 23:50 and 00:10 sit 20 minutes apart
  /// instead of 23 hours.
  static func fromNoon(_ ms: Double) -> Double {
    let c = cal.dateComponents([.hour, .minute], from: date(ms))
    return Double(((c.hour ?? 0) * 60 + (c.minute ?? 0) + 720) % 1440)
  }
  static func toNoon(_ hhmm: String) -> Double { let (h, m) = hm(hhmm); return Double((h * 60 + m + 720) % 1440) }
  static func noonToClock(_ m: Double) -> String {
    let v = ((JS.int(m) + 720) % 1440 + 1440) % 1440
    return pad(v / 60) + ":" + pad(v % 60)
  }
}
