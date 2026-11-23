import Testing
import Foundation
@testable import NightKit

/// A synthetic night: a quiet room at ~30 dB with a little jitter; `burst` adds a sound
/// (movement by default: broadband, steady, no jump).
struct Synth {
  var f: Readings
  init(hours: Double = 8, wobbly: Bool = false) {
    let n = Int(hours * 3600)
    var seed = 1.0
    func rnd() -> Double { seed = (seed * 16807).truncatingRemainder(dividingBy: 2147483647); return (seed - 1) / 2147483646 }
    var db = (0..<n).map { _ in 30 + rnd() * 2 }
    if wobbly {   // a very quiet room (2026-10-30: floor 21 dB) whose level wobbles by itself
      seed = 7
      db = (0..<n).map { _ in 21 + rnd() * 3 + (rnd() < 0.08 ? 7 + rnd() * 2 : 0) }
    }
    f = Readings(db: db, low: .init(repeating: 0.3, count: n), mid: .init(repeating: 0.3, count: n), vr: .init(repeating: 1, count: n), at: .init(repeating: 1, count: n))
  }
  struct Sound { var db = 45.0, low = 0.3, mid = 0.3, vr = 1.0, at = 2.0 }
  // traits as shared/scripts/replay.mjs measured them (SOUND_ANALYSIS.md)
  static let snore = Sound(db: 48, low: 0.57, mid: 0.33, vr: 9.7, at: 14), talk = Sound(db: 44, low: 0.45, mid: 0.4, vr: 13, at: 32)
  static let cough = Sound(db: 55, low: 0.17, mid: 0.66, vr: 13.6, at: 38)
  mutating func burst(_ s: Int, _ len: Int, _ o: Sound = Sound()) {
    for i in s..<(s + len) { f.db[i] = o.db; f.low[i] = o.low; f.mid[i] = o.mid; f.vr[i] = o.vr; f.at[i] = o.at }
  }
  func first(_ seconds: Int) -> Readings { Readings(db: Array(f.db.prefix(seconds)), low: f.low, mid: f.mid, vr: f.vr, at: f.at) }
}

@Suite struct AnalysisTests {
  @Test func findsSleepOnsetOneWakeUpAndSnoringThatIsNotMovement() {
    var n = Synth()
    for s in stride(from: 0, to: 15 * 60, by: 20) { n.burst(s, 2) }                       // awake in bed, tossing: 15 min
    for s in stride(from: 7200, to: 7200 + 5 * 60, by: 15) { n.burst(s, 3) }              // a 5-minute wake-up at 2h
    for s in stride(from: 3 * 3600, to: 3 * 3600 + 600, by: 4) { n.burst(s, 2, Synth.snore) } // 10 min of snoring at 3h
    for s in stride(from: 4 * 3600, to: 8 * 3600, by: 600) { n.burst(s, 1) }              // a turn every 10 min: still asleep
    for s in stride(from: 8 * 3600 - 900, to: 8 * 3600 - 40, by: 20) { n.burst(s, 3) }    // up and about for 15 min before Stop
    let r = Analysis.summarize(n.f, start: 0)
    #expect((14...19).contains((r.on ?? 0) / 60000))
    #expect(r.wakes == 1)
    #expect((4...9).contains(r.awakeMin))
    #expect((9...11).contains(r.snoreMin))
    #expect(r.asleepMin > 7 * 60 - 15)
    #expect(r.timeline.states.hasSuffix("w"))
    #expect(r.timeline.states.count == 960 && r.timeline.db.count == 480)
  }

  @Test func estimatesRestfulSleepOnlyWhereNothingHappenedFor10Minutes() {
    var n = Synth()
    for s in stride(from: 1800, to: 4 * 3600, by: 300) { n.burst(s, 1) }   // asleep from the start; a turn every 5 min for 4 hours
    let r = Analysis.summarize(n.f, start: 0), st = Array(r.timeline.states)
    #expect(!st[60..<470].contains("d"))                                   // turns every 5 min: light
    #expect(st[500..<950].allSatisfy { $0 == "d" })                        // the quiet second half: restful
    #expect(r.restfulMin > 200)
  }

  @Test func marksMissingSecondsAsGapsAndDoesNotCountThemAsSleep() {
    var n = Synth()
    for s in 3600..<7200 { n.f.db[s] = .nan }
    let r = Analysis.summarize(n.f, start: 0)
    #expect(String(Array(r.timeline.states)[120..<240]) == String(repeating: "g", count: 120))
    #expect(r.asleepMin <= 7 * 60)
  }

  @Test func aQuietRoomThatWobblesByItselfIsNotSomeoneAwakeButStillHearsRealMovement() {
    let calm = Analysis.summarize(Synth(hours: 4, wobbly: true).f, start: 0)
    #expect(calm.wakes <= 1 && calm.asleepMin > 3.5 * 60)
    var n = Synth(hours: 4, wobbly: true)
    for s in stride(from: 2 * 3600, to: 2 * 3600 + 5 * 60, by: 15) { n.burst(s, 3) }   // 5 minutes of tossing
    let r = Analysis.summarize(n.f, start: 0)
    #expect(r.wakes == 1 && r.awakeMin >= 4)
  }

  @Test func turningOverEveryQuarterHourTowardsTheMorningIsNotWakingUp() {
    var n = Synth(hours: 6)
    for s in stride(from: 3 * 3600, to: 6 * 3600, by: 900) { for t in stride(from: s, to: s + 180, by: 15) { n.burst(t, 1) } }
    let r = Analysis.summarize(n.f, start: 0)
    #expect(r.wakes == 0 && r.asleepMin > 5 * 60 + 30)
  }

  @Test func tellsTalkingCoughingSnoringAndRoomNoiseApart() {
    var n = Synth(hours: 2)
    n.burst(1000, 4, Synth.talk); n.burst(1006, 3, Synth.talk)               // one sentence, a short pause
    n.burst(2000, 1, Synth.cough); n.burst(2002, 1, Synth.cough)             // a double cough
    for s in stride(from: 3000, to: 3060, by: 4) { n.burst(s, 2, Synth.snore) } // a minute of snoring
    n.burst(5000, 90, .init(db: 40, vr: 0.5))                                // a car passing for 90 s
    n.burst(6000, 2)                                                         // a turn: not an event
    let ev = Analysis.events(n.f, start: 0)
    #expect(ev.map(\.kind) == ["talk", "cough", "snore", "noise"])
    #expect(ev[0] == .init(t: 1_000_000, kind: "talk", sec: 9))
    #expect(ev[2].sec >= 56)
    let r = Analysis.summarize(n.f, start: 0)
    #expect(r.talks == 1 && r.coughs == 1)
  }

  @Test func threeSnoresAtBreathingPaceAreSnoringTwoAreNot() {
    var three = Synth(hours: 1), two = Synth(hours: 1)
    for s in [1000, 1004, 1008] { three.burst(s, 2, Synth.snore) }
    for s in [1000, 1004] { two.burst(s, 2, Synth.snore) }
    #expect(Analysis.events(three.f, start: 0).map(\.kind) == ["snore"])
    #expect(Analysis.events(two.f, start: 0).isEmpty)
  }

  @Test func talkingOrRoomNoiseIsNotBeingAwake() {
    var n = Synth()
    for s in stride(from: 2 * 3600, to: 2 * 3600 + 600, by: 30) { n.burst(s, 5, Synth.talk) }   // talking in your sleep, 10 min
    n.burst(5 * 3600, 1200, .init(db: 40, vr: 0.5))                                             // a fan for 20 min
    #expect(Analysis.summarize(n.f, start: 0).wakes == 0)
  }

  @Test func stirringAfterMovementInTheLastMinuteNotInQuietSnoringOrTalking() {
    var a = Synth()
    #expect(!Analysis.stirring(a.first(3600)))
    for s in stride(from: 3600 - 50, to: 3600, by: 10) { a.burst(s, 2) }
    #expect(Analysis.stirring(a.first(3600)))
    var b = Synth()
    for s in stride(from: 3600 - 60, to: 3600, by: 4) { b.burst(s, 2, Synth.snore) }
    #expect(!Analysis.stirring(b.first(3600)))
    var c = Synth()
    for s in stride(from: 3600 - 60, to: 3600, by: 10) { c.burst(s, 4, Synth.talk) }
    #expect(!Analysis.stirring(c.first(3600)))
  }

  /// The smart alarm asks a night being recorded (Night), its last 11 minutes.
  @Test func stirringReadsTheNightBeingRecorded() {
    func night(_ seconds: Int, moving: (Int) -> Bool) -> Night {
      let n = Night(start: 0)
      for s in 0..<seconds { let m = moving(s); n.append(db: m ? 45 : 30 + Double(s % 5) / 4, low: 0.3, mid: 0.3, vr: 1, at: m ? 2 : 1) }
      return n
    }
    #expect(!Analysis.stirring(Readings(night(900) { _ in false })))
    #expect(Analysis.stirring(Readings(night(900) { $0 > 860 && $0 % 10 < 2 })))
    let gaps = night(900) { _ in false }
    for _ in 0..<60 { gaps.append(db: .nan, low: 0, mid: 0, vr: 0, at: 0) }
    #expect(!Analysis.stirring(Readings(gaps)))
  }

  // Real data, not a simulation: two hours of the night of 2026-10-29 as the app heard it (per-second
  // numbers, no audio). The sleeper reports sleeping calmly through the night and the morning, with only
  // small awakenings. A very quiet room: the floor is ~21 dB, close to the microphone's own noise.
  // Tune the knobs in Analysis from real nights like this.
  static func real(_ k: String) throws -> Readings {
    struct Hour: Decodable { let db: [Double?], low: [Double], mid: [Double], vr: [Double], at: [Double] }
    let all = try JSONDecoder().decode([String: Hour].self, from: Data(contentsOf: Fixtures.dir.appendingPathComponent("real-night.json")).withoutNote())
    let h = try #require(all[k])
    return Readings(db: h.db.map { $0 ?? .nan }, low: h.low, mid: h.mid, vr: h.vr, at: h.at)
  }

  @Test func aRealNightSleepsThroughTheSmallHours() throws {
    let r = Analysis.summarize(try Self.real("night"), start: 0)
    #expect(r.wakes == 0 && r.awakeMin <= 2 && r.asleepMin >= 55)
  }

  @Test func aRealMorningWithTheDaytimeNoiseComingUpDoesNotWakeTheSleeper() throws {
    let r = Analysis.summarize(try Self.real("morning"), start: 0)
    #expect(r.wakes <= 1 && r.awakeMin <= 5 && r.asleepMin >= 40)
  }
}

extension Data {
  /// The fixture's "note" (a string) taken out, so the rest decodes as hours.
  func withoutNote() throws -> Data {
    var o = try JSONSerialization.jsonObject(with: self) as? [String: Any] ?? [:]
    o["note"] = nil
    return try JSONSerialization.data(withJSONObject: o)
  }
}
