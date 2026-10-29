import Foundation

// What the screens show of the nights, as the rules give it (frontend/src/lib/views.js: the
// wording and the numbers are decided and tested there). The app draws these.

public enum Tone: String, Decodable, Sendable { case good, accent, warn }

/// A night as the microphone heard it: loudness a minute at a time, and per half minute the estimate
/// (w awake, l light, s sleep, d restful, g not recorded) and what was heard (n snoring, t talking,
/// c coughing, m movement, x room noise).
public struct Timeline: Decodable, Equatable, Sendable {
  public let start: Double
  public let states: String, events: String
  public let db: [Double?]
}

public struct Stat: Decodable, Equatable, Sendable { public let value: String, label: String }

public struct ReportView: Decodable, Equatable, Sendable {
  public struct Part: Decodable, Equatable, Sendable { public let label: String, note: String; public let pts: Int, max: Int }
  public struct Sound: Decodable, Equatable, Sendable { public let label: String, time: String, length: String }
  public struct Diag: Decodable, Equatable, Sendable { public let label: String, value: String; public let bad: Bool }
  public let id: String, title: String, range: String
  public let score: Int, tone: Tone, blank: Bool
  public let verdict: String
  public let vsWeek: String?
  public let facts: [Stat]
  public let timeline: Timeline?
  public let parts: [Part]
  public let insights: [String]
  public let sounds: [Sound]
  public let alarm: String?
  public let diag: [Diag]
}

public struct MonthID: Equatable, Hashable, Sendable {
  public var year: Int, month: Int   // month 0-based, as in JavaScript
  public init(year: Int, month: Int) { self.year = year; self.month = month }
}

public struct JournalView: Decodable, Equatable, Sendable {
  public enum Kind: String, Decodable, Sendable { case none, future, blank, scored }
  public struct Day: Decodable, Equatable, Sendable { public let n: Int, id: String; public let kind: Kind; public let score: Int?, tone: Tone? }
  public struct Selected: Decodable, Equatable, Sendable {
    public let id: String, title: String; public let blank: Bool; public let score: Int; public let tone: Tone
    public let headline: String, line: String; public let timeline: Timeline?
  }
  public let title: String, sub: String
  public let canNext: Bool
  public let lead: Int
  public let days: [Day]
  public let selected: Selected?
  public let empty: String?
}

public struct TrendsView: Decodable, Equatable, Sendable {
  public struct Bar: Decodable, Equatable, Sendable { public let id: String, label: String; public let value: Double; public let tone: Tone?; public let full: Bool? }
  public struct Window: Decodable, Equatable, Sendable { public let id: String, label: String; public let on: Double?, wake: Double? }
  public struct Target: Decodable, Equatable, Sendable { public let bed: Double, wake: Double; public let label: String }
  public let empty: String?
  public let label: String?
  public let avg: Int?
  public let change: String?
  public let kpis: [Stat]?
  public let scores: [Bar]?, hours: [Bar]?, snoring: [Bar]?
  public let windows: [Window]?
  public let target: Target?
}

extension NightStore {
  /// A view of the stored nights: `call` is JavaScript using `S` (the state), giving a view or nothing.
  private func view<T: Decodable>(_ call: String, _ type: T.Type) -> T? {
    guard let text = try? rules.evaluate("(function(){const S=JSON.parse(\(Self.lit(json)));const V=\(call);return V==null?undefined:JSON.stringify(V)})()"),
          let data = text.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  public func report(_ id: String) -> ReportView? { view("MySleepRules.reportView(S,\(Self.lit(id)))", ReportView.self) }

  /// The month the journal opens on: the newest night's.
  public func startMonth(now: Date) -> MonthID {
    struct M: Decodable { let year: Int, month: Int }
    let m = view("MySleepRules.startMonth(S,\(Self.ms(now)))", M.self)
    return MonthID(year: m?.year ?? 1970, month: m?.month ?? 0)
  }

  public func journal(_ month: MonthID, selected: String?, now: Date) -> JournalView? {
    view("MySleepRules.journalView(S,{year:\(month.year),month:\(month.month)},\(selected.map(Self.lit) ?? "null"),\(Self.ms(now)))", JournalView.self)
  }

  public func trends(days: Int) -> TrendsView? { view("MySleepRules.trendsView(S,\(days))", TrendsView.self) }
}
