import Foundation

/// The sleep score (0–100) and the night in a few plain sentences. Derived from a saved night, so
/// changing the formula re-scores every night (docs/dev/SOUND_ANALYSIS.md).
public enum Score {
  /// What a night is scored against: the middle of the 7–9 h adults need (AASM, 2015). Not a
  /// setting: nobody knows their own number, and the score should not depend on a guess.
  public static let need = 480.0

  public struct Part: Equatable, Sendable { public let label: String, max: Int, pts: Double, note: String }

  static func clamp(_ v: Double) -> Double { v.isNaN ? v : max(0, min(1, v)) }
  static func lerp(_ v: Double, _ zero: Double, _ full: Double) -> Double { clamp((v - zero) / (full - zero)) }

  /// The score and how it adds up (`pts` not rounded: the score is).
  public static func of(_ n: NightRecord, bedtime: String) -> (score: Int, parts: [Part]) {
    let asleep = JS.or0(n.asleepMin)
    let inBed = ((n.wake ?? .nan) - (n.bed ?? .nan)) / 60000
    let latency = n.fellAsleep.map { ($0 - (n.bed ?? .nan)) / 60000 }
    // without sleep there is nothing to be continuous, quick or on time about
    let slept = asleep > 0
    var parts = [Part(label: "Duration", max: 35, pts: 35 * clamp(asleep / need), note: "\(Clock.dur(asleep)) of \(Clock.dur(need))")]
    if inBed > 0 { parts.append(Part(label: "Efficiency", max: 20, pts: 20 * lerp(asleep / inBed, 0.6, 0.9), note: "\(JS.int(asleep / inBed * 100))% of time in bed asleep")) }
    if slept {
      let wakes = n.wakes ?? 0, awake = JS.or0(n.awakeMin)
      parts.append(Part(label: "Continuity", max: 15, pts: 15 * lerp(awake, 40, 0),
                        note: wakes != 0 ? "\(wakes) wake-up\(wakes > 1 ? "s" : ""), \(JS.int(awake)) min awake" : "Slept through"))
      if let latency { parts.append(Part(label: "Falling asleep", max: 10, pts: 10 * lerp(latency, 60, 15), note: "\(JS.int(latency)) min")) }
      if n.timeline != nil, let r = n.restfulMin {
        parts.append(Part(label: "Restfulness", max: 10, pts: 10 * clamp(r / max(1, asleep) / 0.35), note: "\(Clock.dur(r)) restful (estimate)"))
      }
      if let on = n.fellAsleep {
        parts.append(Part(label: "Routine", max: 10, pts: 10 * lerp(abs(Clock.fromNoon(on) - Clock.toNoon(bedtime)), 90, 15),
                          note: "asleep at \(Clock.clockOf(on)), bedtime \(bedtime)"))
      }
    }
    let most = parts.reduce(0) { $0 + $1.max }, pts = parts.reduce(0.0) { $0 + $1.pts }
    return (JS.int(100 * pts / Double(most)), parts)
  }

  /// Most of the night without a recording ('g' epochs): the microphone sent nothing (29 October),
  /// which says nothing about sleep. Told apart from a night the microphone heard and found no sleep in.
  public static func unrecorded(_ n: NightRecord) -> Bool {
    guard let s = n.timeline?.states.utf8, !s.isEmpty else { return false }
    return Double(s.filter { $0 == Analysis.g }.count) >= 0.9 * Double(s.count)
  }

  /// The night in plain sentences.
  public static func insights(_ n: NightRecord) -> [String] {
    let clock = Clock.clockOf, dur = Clock.dur
    if unrecorded(n), let t = n.timeline {
      let gapMin = min(Double(t.states.utf8.filter { $0 == Analysis.g }.count) / 2, ((n.wake ?? .nan) - (n.bed ?? .nan)) / 60000)   // the last block is padded
      return ["The microphone recorded nothing (\(dur(gapMin))), so this night has no score."]
    }
    var out: [String] = []
    if n.timeline != nil && n.fellAsleep == nil { out.append("No sleep was heard: you were moving, or the recording was too short.") }
    if let on = n.fellAsleep { out.append("You fell asleep at \(clock(on)), \(JS.int((on - (n.bed ?? .nan)) / 60000)) min after going to bed.") }
    let ev = n.events ?? []
    let wakes = !ev.isEmpty ? n.timeline.map(wakeTimes) ?? [] : []
    if let w = n.wakes, w != 0 { out.append("You woke \(Clock.times(w))\(wakes.isEmpty ? "" : " (" + wakes.joined(separator: ", ") + ")"), \(JS.int(JS.or0(n.awakeMin))) min awake in all.") }
    else if n.fellAsleep != nil && (n.asleepMin ?? 0) > 0 { out.append("You slept through without waking.") }
    let snore = ev.filter { $0.kind == "snore" }
    if !snore.isEmpty { out.append("You snored for about \(JS.int(n.snoreMin ?? .nan)) min, \(snore.count == 1 ? "from " + clock(snore[0].t) : "mostly " + peakHour(snore)).") }
    func occasions(_ list: [NightRecord.SoundEvent], _ verb: String, _ show: Int) -> String {
      "\(verb) \(Clock.times(list.count)) (\(list.prefix(show).map { clock($0.t) }.joined(separator: ", "))\(list.count > show ? "…" : ""))"
    }
    let talk = ev.filter { $0.kind == "talk" }
    if !talk.isEmpty { out.append("You \(occasions(talk, "talked in your sleep", 4)).") }
    let cough = ev.filter { $0.kind == "cough" }
    if !cough.isEmpty { out.append("You \(occasions(cough, "coughed", 4)).") }
    let noise = ev.filter { $0.kind == "noise" }
    if !noise.isEmpty { out.append("The room \(occasions(noise, "was noisy", 3)): long sounds that were not you.") }
    if let t = n.timeline {
      let gaps = runs(t, Analysis.g), gapMin = Double(gaps.reduce(0) { $0 + $1.count }) / 2
      if gapMin >= 10, let longest = gaps.reduce(nil as (from: Int, count: Int)?, { a, b in a.map { b.count > $0.count ? b : $0 } ?? b }) {
        let from = clock(t.start + Double(longest.from) * 30000)
        out.append("The microphone recorded nothing for \(dur(gapMin))\(gaps.count > 1 ? " in \(gaps.count) stretches, the longest from \(from)" : ", from \(from)").")
      }
      // the longest restful stretch (the first of the longest)
      if let calm = runs(t, Analysis.d).reduce(nil as (from: Int, count: Int)?, { a, b in a.map { b.count > $0.count ? b : $0 } ?? b }), calm.count * 30000 >= 20 * 60000 {
        out.append("Your most restful stretch was \(clock(t.start + Double(calm.from) * 30000))–\(clock(t.start + Double(calm.from + calm.count) * 30000)) (estimate).")
      }
    }
    return out
  }

  /// Runs of one state in the timeline: where each starts and how long it is (epochs).
  static func runs(_ t: Timeline, _ ch: UInt8) -> [(from: Int, count: Int)] {
    let s = Array(t.states.utf8)
    var out: [(from: Int, count: Int)] = [], i = 0
    while i < s.count {
      guard s[i] == ch else { i += 1; continue }
      var j = i
      while j < s.count && s[j] == ch { j += 1 }
      out.append((i, j - i)); i = j
    }
    return out
  }

  static func wakeTimes(_ t: Timeline) -> [String] {
    let s = Array(t.states.utf8), slept: (UInt8) -> Bool = { $0 == Analysis.l || $0 == Analysis.d }
    guard let first = s.firstIndex(where: slept), let last = s.lastIndex(where: slept) else { return [] }
    return (first..<last).filter { s[$0] == Analysis.w && s[$0 - 1] != Analysis.w }.map { Clock.clockOf(t.start + Double($0) * 30000) }
  }

  /// "between 03:00 and 04:00": the hour with the most of it (the earlier of a tie).
  static func peakHour(_ list: [NightRecord.SoundEvent]) -> String {
    var by = [Double](repeating: 0, count: 24)
    for e in list { by[Clock.cal.component(.hour, from: Clock.date(e.t))] += e.sec }
    let h = by.indices.reduce(0) { by[$1] > by[$0] ? $1 : $0 }
    return "between \(Clock.pad(h)):00 and \(Clock.pad((h + 1) % 24)):00"
  }

  /// Averages of the nights with sleep in them (newest first): the bed and wake times across midnight.
  public struct Summary: Equatable, Sendable {
    public struct Spread: Equatable, Sendable { public let mean: Double, sd: Double }
    public let n: Int, avgAsleep: Double, debt: Double, snore: Double
    public let on: Spread?, wake: Spread?
  }

  public static func summary(_ nights: [NightRecord], need: Double) -> Summary? {
    let L = nights.filter { ($0.asleepMin ?? 0) > 0 }
    guard !L.isEmpty else { return nil }
    func mean(_ a: [Double]) -> Double { a.reduce(0, +) / Double(a.count) }
    func spread(_ a: [Double]) -> Summary.Spread? {
      guard !a.isEmpty else { return nil }
      let m = mean(a)
      return .init(mean: m, sd: mean(a.map { ($0 - m) * ($0 - m) }).squareRoot())
    }
    return Summary(n: L.count, avgAsleep: mean(L.map { $0.asleepMin ?? 0 }),
                   debt: L.reduce(0) { $0 + max(0, need - ($1.asleepMin ?? 0)) },
                   snore: mean(L.map { JS.or0($0.snoreMin) }),
                   on: spread(L.compactMap(\.fellAsleep).map(Clock.fromNoon)),
                   wake: spread(L.compactMap { $0.wake.flatMap { $0 != 0 ? $0 : nil } }.map(Clock.fromNoon)))
  }
}
