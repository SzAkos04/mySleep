import Foundation

// What the screens show of the nights, as the rules give it (shared/lib/views.js: the
// wording and the numbers are decided and tested there). The app draws these.

public enum Tone: String, Decodable, Sendable { case good, accent, warn }

public struct Stat: Decodable, Equatable, Sendable { public let value: String, label: String }

public struct ReportView: Decodable, Equatable, Sendable {
  public struct Part: Decodable, Equatable, Sendable { public let label: String, note: String; public let pts: Int, max: Int }
  public struct Sound: Decodable, Equatable, Sendable { public let label: String, time: String, length: String }
  public struct Diag: Decodable, Equatable, Sendable { public let label: String, value: String; public let bad: Bool }
  public struct Times: Decodable, Equatable, Sendable { public let bed: String, on: String, wake: String }   // HH:MM; `on` empty: no sleep found
  public let id: String, title: String, range: String
  public let times: Times
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
  func view<T: Decodable>(_ call: String, _ type: T.Type) -> T? {
    guard let text = try? withState("const V=\(call);return V==null?undefined:JSON.stringify(V)"),
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

// What the screens show of the nights: the night's report, the journal's month, the trends.
// The wording and the numbers are decided here, once, and tested (ViewsTests); the app draws them.
extension NightState {
  static let monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  static let dayLetters = ["S", "M", "T", "W", "T", "F", "S"]
  static let soundNames = ["snore": "Snoring", "talk": "Talking", "cough": "Coughing", "noise": "Room noise"]

  public static func verdict(_ s: Int) -> String { s >= 85 ? "A great night" : s >= 70 ? "A good night" : s >= 55 ? "An okay night" : "A rough night" }
  /// good / accent / warn: the app picks the colours
  public static func tone(_ s: Int) -> Tone { s >= 80 ? .good : s >= 60 ? .accent : .warn }

  /// The nights not deleted, newest first.
  var list: [NightRecord] { nights.values.filter { !$0.isDeleted }.sorted { $0.id > $1.id } }
  func score(_ n: NightRecord) -> Int { Score.of(n, bedtime: settings.bedtime).score }
  /// The average score of the nights the microphone recorded: an empty night says nothing about sleep.
  func meanScore<C: Collection>(_ ns: C) -> Int? where C.Element == NightRecord {
    let r = ns.filter { !Score.unrecorded($0) }
    return r.isEmpty ? nil : JS.int(Double(r.reduce(0) { $0 + score($1) }) / Double(r.count))
  }
  static func dayOf(_ id: String) -> DateComponents { Clock.cal.dateComponents([.year, .month, .day, .weekday], from: Clock.noon(id)) }

  public func reportView(_ id: String) -> ReportView? {
    guard let n = nights[id], !n.isDeleted else { return nil }
    let s = Score.of(n, bedtime: settings.bedtime), blank = Score.unrecorded(n)
    let week = list.filter { $0.id != n.id && !Score.unrecorded($0) }.prefix(7)
    let avg = week.count >= 3 ? meanScore(week) : nil
    let latency = n.fellAsleep.map { JS.int(($0 - (n.bed ?? .nan)) / 60000) }
    var diag: [ReportView.Diag] = []
    if let d = n.diag, d["app"]?.string == "native" {
      func v(_ k: String) -> String { d[k]?.text ?? "undefined" }
      func bad(_ k: String) -> Bool { (d[k]?.number ?? 0) > 0 }
      diag = [.init(label: "Recorded by", value: "mySleep", bad: false), .init(label: "Interruptions", value: v("interruptions"), bad: bad("interruptions")),
              .init(label: "Audio restarted", value: v("restarts"), bad: bad("restarts")), .init(label: "Microphone sent nothing", value: v("micSilent"), bad: bad("micSilent")),
              .init(label: "Phone locked", value: v("locked"), bad: false)]
    }
    let bed = n.bed ?? .nan, wake = n.wake ?? .nan, clock = Clock.clockOf
    return ReportView(
      id: id, title: Clock.dayLabel(id), range: "In bed \(clock(bed)) – \(clock(wake)) · \(Clock.dur((wake - bed) / 60000))",
      times: .init(bed: clock(bed), on: n.fellAsleep.map(clock) ?? "", wake: clock(wake)),   // as the correction form starts
      score: s.score, tone: Self.tone(s.score), blank: blank, verdict: blank ? "Nothing recorded" : Self.verdict(s.score),
      vsWeek: avg.flatMap { a in blank ? nil : "\(s.score > a ? "Better than" : s.score < a ? "Below" : "Same as") your week (\(a))" },
      facts: [Stat(value: Clock.dur(JS.or0(n.asleepMin)), label: "asleep"), Stat(value: latency.map { "\($0) min" } ?? "–", label: "to fall asleep"),
              Stat(value: n.restfulMin.map(Clock.dur) ?? "–", label: "restful")],
      timeline: n.timeline,
      parts: s.parts.map { .init(label: $0.label, note: $0.note, pts: JS.int($0.pts), max: $0.max) },
      insights: Score.insights(n),
      sounds: (n.events ?? []).compactMap { e in Self.soundNames[e.kind].map { .init(label: $0, time: clock(e.t), length: e.sec < 60 ? "\(JS.num(e.sec)) s" : "\(JS.int(e.sec / 60)) min") } },
      alarm: n.alarm.map { "The alarm rang at \(clock($0.at))\($0.early != 0 ? ", \(JS.num($0.early)) min early" : "")." },
      diag: diag)
  }

  /// The month the journal opens on: the newest night's, this month with none.
  public func startMonth(now: Date) -> MonthID {
    let c = list.first.map { Self.dayOf($0.id) } ?? Clock.cal.dateComponents([.year, .month], from: now)
    return MonthID(year: c.year ?? 1970, month: (c.month ?? 1) - 1)
  }

  /// `selected`: the chosen night's id, or the newest.
  public func journalView(_ month: MonthID, selected sel: String?, now: Date) -> JournalView {
    let all = list, byId = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    let (y, m) = (month.year, month.month), cal = Clock.cal
    let first = cal.date(from: DateComponents(year: y, month: m + 1, day: 1)) ?? now
    let count = cal.range(of: .day, in: .month, for: first)?.count ?? 30
    let lead = (cal.component(.weekday, from: first) - 1 + 6) % 7
    let prefix = "\(y)-\(Clock.pad(m + 1))", inMonth = all.filter { $0.id.hasPrefix(prefix) }, avg = meanScore(inMonth)
    let days = (1...count).map { d -> JournalView.Day in
      let id = "\(prefix)-\(Clock.pad(d))"
      guard let n = byId[id] else {
        let midnight = cal.date(from: DateComponents(year: y, month: m + 1, day: d)) ?? now
        return .init(n: d, id: id, kind: midnight > now ? .future : .none, score: nil, tone: nil)
      }
      if Score.unrecorded(n) { return .init(n: d, id: id, kind: .blank, score: nil, tone: nil) }
      let s = score(n)
      return .init(n: d, id: id, kind: .scored, score: s, tone: Self.tone(s))
    }
    let today = cal.dateComponents([.year, .month], from: now)
    let selected = (sel ?? all.first?.id).flatMap { byId[$0] }.map { n -> JournalView.Selected in
      let blank = Score.unrecorded(n), s = score(n)
      let line = [n.wakes.flatMap { $0 != 0 ? "Woke \(Clock.times($0))" : nil } ?? (n.fellAsleep != nil ? "Slept through" : nil),
                  n.snoreMin.flatMap { $0 != 0 && !$0.isNaN ? "snored \(JS.num($0)) min" : nil },
                  n.talks.flatMap { $0 != 0 ? "talked \(Clock.times($0))" : nil }].compactMap { $0 }.joined(separator: " · ")
      return .init(id: n.id, title: Clock.dayLabel(n.id), blank: blank, score: s, tone: Self.tone(s),
                   headline: blank ? "Nothing recorded" : Clock.dur(JS.or0(n.asleepMin)) + " asleep", line: line, timeline: n.timeline)
    }
    return JournalView(
      title: Self.monthNames[m] + (y != today.year ? " \(y)" : ""),
      sub: inMonth.isEmpty ? "No nights this month" : "\(avg.map { "Average \($0) · " } ?? "")\(inMonth.count) \(inMonth.count == 1 ? "night" : "nights")",
      canNext: !(y == today.year && m + 1 == today.month), lead: lead, days: days, selected: selected,
      empty: selected != nil ? nil : all.isEmpty ? "Your nights will fill this calendar." : "Pick a night in the calendar.")
  }

  /// `days`: 7, 30 or 365.
  public func trendsView(days: Int) -> TrendsView {
    let all = list, L = Array(all.prefix(days))
    guard let s = Score.summary(L, need: Score.need) else {
      return TrendsView(empty: "Trends start after a couple of nights.", label: nil, avg: nil, change: nil, kpis: nil, scores: nil, hours: nil, snoring: nil, windows: nil, target: nil)
    }
    let chrono = Array(L.reversed()), scored = chrono.map(score)
    let avg = meanScore(L) ?? 0, prev = meanScore(all.dropFirst(days).prefix(days))
    let period = days == 7 ? "week" : days == 30 ? "month" : "year"
    func label(_ n: NightRecord) -> String {
      let d = Self.dayOf(n.id), wd = (d.weekday ?? 1) - 1
      return chrono.count <= 7 ? Self.dayLetters[wd] : wd == 1 ? "\(d.day ?? 0)" : ""
    }
    let labels = chrono.map(label)
    return TrendsView(
      empty: nil, label: "This \(period)", avg: avg,
      change: prev.map { "\(avg >= $0 ? "up" : "down") \(abs(avg - $0)) on the \(period) before" },
      kpis: [Stat(value: Clock.dur(s.avgAsleep), label: "asleep a night"), Stat(value: Clock.dur(s.debt), label: "short of 8 h, in all"),
             Stat(value: s.on.map { Clock.noonToClock($0.mean) } ?? "–", label: s.on.map { "asleep ± \(JS.int($0.sd)) min" } ?? "asleep"),
             Stat(value: s.wake.map { Clock.noonToClock($0.mean) } ?? "–", label: s.wake.map { "awake ± \(JS.int($0.sd)) min" } ?? "awake")],
      scores: chrono.indices.map { .init(id: chrono[$0].id, label: labels[$0], value: Double(scored[$0]), tone: Self.tone(scored[$0]), full: nil) },
      hours: chrono.indices.map { i in let a = JS.or0(chrono[i].asleepMin); return .init(id: chrono[i].id, label: labels[i], value: a, tone: nil, full: a >= Score.need) },
      snoring: chrono.contains { JS.or0($0.snoreMin) != 0 } ? chrono.indices.map { .init(id: chrono[$0].id, label: labels[$0], value: JS.or0(chrono[$0].snoreMin), tone: nil, full: nil) } : nil,
      windows: chrono.indices.map { i in
        let n = chrono[i], both = n.fellAsleep != nil && (n.wake ?? 0) != 0
        return .init(id: n.id, label: labels[i], on: both ? n.fellAsleep.map(Clock.fromNoon) : nil, wake: both ? n.wake.map(Clock.fromNoon) : nil)
      },
      target: .init(bed: Clock.toNoon(settings.bedtime), wake: Clock.toNoon(settings.wake), label: "\(settings.bedtime)–\(settings.wake)"))
  }
}
