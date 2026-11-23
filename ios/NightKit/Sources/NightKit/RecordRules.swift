import Foundation

extension NightRecord {
  /// What the morning shows, saved when the night ends: the analysis of the readings, with times.
  /// `ringing`: the alarm, if it rang.
  static func make(id: String, readings f: Readings, start: Double, end: Double, ringing: Rang?, diag: [String: JSONValue]) -> NightRecord {
    let r = Analysis.summarize(f, start: start)
    var n = NightRecord(id: id)
    n.bed = start; n.on = r.on; n.wake = end
    n.wakes = r.wakes; n.awakeMin = r.awakeMin; n.asleepMin = r.asleepMin; n.restfulMin = r.restfulMin
    n.snoreMin = r.snoreMin; n.talks = r.talks; n.coughs = r.coughs; n.events = r.events
    n.timeline = r.timeline; n.clips = []; n.diag = diag; n.alarm = ringing
    return n
  }

  /// The night a finished log of the app's holds.
  public init(log: NightLog) {
    let s = log.samples, at = { log.start + $0 }
    let f = Readings(db: s.db.map { $0 ?? .nan }, low: (s.low ?? []).map { $0 ?? 0 }, mid: (s.mid ?? []).map { $0 ?? 0 },
                     vr: (s.vr ?? []).map { $0 ?? 0 }, at: (s.at ?? []).map { $0 ?? 0 })
    let finish = log.events.first { $0.type == "finish" }
    let rang = log.events.first { $0.type == "ring" || $0.type == "alarm-ringing" }
    let wake = log.events.first { $0.type == "wake" }
    let ringing = rang.map { Rang(at: at($0.ms), early: wake?.data["early"]?.number ?? $0.data["early"]?.number ?? 0) }
    let end = finish.map { at($0.ms) } ?? at(Double(s.db.count) * 1000)
    self = .make(id: log.night, readings: f, start: s.start, end: end, ringing: ringing, diag: Self.diag(log.events))
    source = "native"
  }

  /// What went wrong in the night, as the app logs it (NightEngine.swift).
  static func diag(_ events: [NightLog.Event]) -> [String: JSONValue] {
    func c(_ t: String) -> JSONValue { .number(Double(events.filter { $0.type == t }.count)) }
    return [
      "app": .string("native"), "events": .number(Double(events.count)),
      "interruptions": c("interruption-began"),
      "restarts": .number(Double(events.filter { $0.type == "audio" && $0.data["reason"]?.string != "start" }.count)),
      "micSilent": c("mic-silent"), "recoveries": c("recovered"), "stalls": c("stall"),
      "locked": c("locked"), "memoryWarnings": c("memory-warning")
    ]
  }

  /// The night to make of one of the app's logs, or nothing: not an unfinished log, not one here
  /// already (same start), never over a night deleted here or from elsewhere. A later night under
  /// the same date replaces the earlier one only when it is longer (3 Nov: a 20 min restart after
  /// the alarm was stopped replaced a night of 3 h 43).
  public static func takeIn(_ log: NightLog, nights: [String: NightRecord]) -> NightRecord? {
    guard log.final == true else { return nil }
    if let have = nights[log.night] {
      let length = log.events.first { $0.type == "finish" }?.ms ?? Double(log.samples.db.count) * 1000
      let held = JS.or0((have.wake ?? .nan) - (have.bed ?? .nan))
      guard !have.isDeleted, have.source == "native", have.bed != log.start, length > held else { return nil }
    }
    return NightRecord(log: log)
  }

  public enum Corrected: Equatable { case night(NightRecord), refused(String) }

  /// The night's times put right by hand ("HH:MM"; `on` may be blank). Bed is on the night's
  /// evening; asleep and awake come after it, the next day if need be (up at 12:30 after a 23:00
  /// bed). Untouched, the analysed minutes stand; changed, the sleep is counted from the new times.
  public func corrected(bed b: String, on o: String, wake w: String) -> Corrected {
    guard !b.isEmpty, !w.isEmpty else { return .refused("Going to bed and waking up need a time.") }
    func after(_ ms: Double, _ from: Double) -> Double {
      var d = Clock.date(ms)
      while Clock.ms(d) < from { d = Clock.cal.date(byAdding: .day, value: 1, to: d) ?? d.addingTimeInterval(86400) }
      return Clock.ms(d)
    }
    let bed = Clock.atClock(id, b)
    let wake = after(Clock.atClock(id, w), bed + 60000)
    let on = o.isEmpty ? nil : after(Clock.atClock(id, o), bed)
    if let on, on > wake { return .refused("Falling asleep has to be between going to bed and waking up.") }
    if bed == self.bed && wake == self.wake && on == self.on { return .night(self) }
    var n = self
    n.bed = bed; n.on = on; n.wake = wake
    n.asleepMin = max(0, JS.round((wake - (on ?? wake)) / 60000 - JS.or0(awakeMin)))
    return .night(n)
  }
}
