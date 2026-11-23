import Testing
import Foundation
@testable import NightKit

extension NightRecord {
  /// A night for the tests: `rec(bed:on:wake:)` and the rest as given.
  static func rec(_ id: String = "2026-10-20", bed: Double? = nil, on: Double? = nil, wake: Double? = nil, asleep: Double? = nil, awake: Double? = nil,
                  wakes: Int? = nil, restful: Double? = nil, snore: Double? = nil, events: [SoundEvent]? = nil, timeline: Timeline? = nil) -> NightRecord {
    var n = NightRecord(id: id)
    n.bed = bed; n.on = on; n.wake = wake; n.asleepMin = asleep; n.awakeMin = awake; n.wakes = wakes; n.restfulMin = restful
    n.snoreMin = snore; n.events = events; n.timeline = timeline
    return n
  }
}

@Suite struct ScoreTests {
  @Test func aFullNightGetsFullMarksAndAShortBrokenOneScalesDown() {
    let good = NightRecord.rec(bed: at(20, 22, 50), on: at(20, 23, 0), wake: at(21, 7, 15), asleep: 490, awake: 0, wakes: 0, restful: 170, timeline: .init(start: 0, states: ""))
    #expect(Score.of(good, bedtime: "23:00").score == 100)
    let bad = NightRecord.rec(bed: at(20, 23, 0), on: at(21, 0, 30), wake: at(21, 5, 30), asleep: 240, awake: 40, wakes: 3, restful: 0, timeline: .init(start: 0, states: ""))
    let s = Score.of(bad, bedtime: "23:00")
    #expect(s.score < 40)
    #expect(s.parts.map(\.label) == ["Duration", "Efficiency", "Continuity", "Falling asleep", "Restfulness", "Routine"])
  }

  @Test func aNightWithoutSleepGetsNothingForContinuityFallingAsleepOrRoutine() {
    let none = NightRecord.rec(bed: at(21, 21, 55), on: at(21, 21, 55), wake: at(21, 21, 57), asleep: 0, awake: 0, wakes: 0, restful: 0, timeline: .init(start: 0, states: "wwww"))
    #expect(Score.of(none, bedtime: "23:00").score == 0)
    var heard = none; heard.on = nil
    #expect(Score.insights(heard) == ["No sleep was heard: you were moving, or the recording was too short."])
  }

  @Test func aNightTypedInByHandIsScoredOnThePartsItHas() {
    let s = Score.of(.rec(bed: at(20, 23, 0), on: at(20, 23, 0), wake: at(21, 7, 0), asleep: 480), bedtime: "23:00")
    #expect(!s.parts.map(\.label).contains("Restfulness"))
    #expect(s.score == 100)
  }

  @Test func saysWhatHappenedInTheNight() {
    let start = at(20, 23, 0)
    let states = String(repeating: "w", count: 30) + String(repeating: "l", count: 60) + String(repeating: "w", count: 6) + String(repeating: "d", count: 80) + String(repeating: "l", count: 40)
    var n = NightRecord.rec(bed: start, on: start + 15 * 60000, awake: 3, wakes: 1, snore: 12,
                            events: [.init(t: at(21, 2, 10), kind: "snore", sec: 700), .init(t: at(21, 3, 5), kind: "talk", sec: 6), .init(t: at(21, 4, 0), kind: "cough", sec: 1)],
                            timeline: .init(start: start, states: states))
    let text = Score.insights(n).joined(separator: " ")
    #expect(text.contains("You fell asleep at 23:15, 15 min after going to bed."))
    #expect(text.contains("You woke once (23:45)"))
    #expect(text.contains("You snored for about 12 min, from 02:10."))
    #expect(text.contains("You talked in your sleep once (03:05)."))
    #expect(text.contains("You coughed once (04:00)."))
    #expect(text.contains("Your most restful stretch was 23:48–00:28 (estimate)."))
    // snoring through the night: the hour with the most of it
    n.snoreMin = 30; n.timeline = .init(start: start, states: String(repeating: "l", count: 600)); n.wakes = nil
    n.events = [.init(t: at(21, 1, 10), kind: "snore", sec: 300), .init(t: at(21, 3, 5), kind: "snore", sec: 900), .init(t: at(21, 3, 40), kind: "snore", sec: 600), .init(t: at(21, 23, 30), kind: "snore", sec: 100)]
    #expect(Score.insights(n).joined(separator: " ").contains("You snored for about 30 min, mostly between 03:00 and 04:00."))
  }

  // a night the microphone did not record
  let start = at(28, 1, 31)
  var blank: NightRecord { .rec(bed: start, wake: start + 37_276_000, asleep: 0, timeline: .init(start: start, states: String(repeating: "g", count: 1242) + "w")) }

  @Test func aNightTheMicrophoneDidNotRecordIsToldApartFromOneWithoutSleep() {
    #expect(Score.unrecorded(blank))
    #expect(!Score.unrecorded(.rec(timeline: .init(start: start, states: String(repeating: "w", count: 1243)))))
    #expect(!Score.unrecorded(.rec(bed: 0, wake: 1)))   // nights from before timelines
    let text = Score.insights(blank)
    #expect(text == ["The microphone recorded nothing (10h 21m), so this night has no score."])
    // the last half-minute block is padded: never more than the time in bed (10h 21m 16s here)
    var padded = blank; padded.timeline = .init(start: start, states: String(repeating: "g", count: 1243))
    #expect(Score.insights(padded).first?.contains("(10h 21m)") == true)
  }

  @Test func namesTheStretchesItMissedInARecordedNight() {
    func r(_ s: [(Character, Int)]) -> String { s.map { String(repeating: $0.0, count: $0.1) }.joined() }
    let states = r([("w", 30), ("l", 60), ("g", 60), ("l", 200), ("g", 10), ("l", 100)])
    var n = NightRecord.rec(bed: start, on: start + 15 * 60000, wake: start + Double(states.count) * 30000, asleep: 180, timeline: .init(start: start, states: states))
    #expect(Score.insights(n).contains("The microphone recorded nothing for 35 min in 2 stretches, the longest from 02:16."))
    n.timeline = .init(start: start, states: r([("l", 100), ("g", 30), ("l", 100)]))
    #expect(Score.insights(n).contains("The microphone recorded nothing for 15 min, from 02:21."))
    n.timeline = .init(start: start, states: r([("l", 100), ("g", 10), ("l", 100)]))
    #expect(!Score.insights(n).joined().contains("recorded nothing"))   // 5 min: not worth a line
  }

  @Test func countsCoughsAndRoomNoiseAndCutsLongListsShort() {
    let base = NightRecord.rec(bed: at(20, 22, 50), on: at(20, 23, 0), wake: at(21, 7, 15), asleep: 490, awake: 0, wakes: 0, restful: 170, snore: 0, timeline: .init(start: 0, states: ""))
    func ev(_ kind: String, _ hm: (Int, Int)...) -> [NightRecord.SoundEvent] { hm.map { .init(t: at(21, $0.0, $0.1), kind: kind, sec: 3) } }
    var n = base
    n.events = ev("cough", (1, 0)) + ev("noise", (2, 0), (3, 30)) + ev("talk", (1, 1), (1, 2), (1, 3), (1, 4), (1, 5))
    let lines = Score.insights(n)
    #expect(lines.contains("You coughed once (01:00)."))
    #expect(lines.contains("The room was noisy 2 times (02:00, 03:30): long sounds that were not you."))
    #expect(lines.contains("You talked in your sleep 5 times (01:01, 01:02, 01:03, 01:04…)."))
    n = base; n.snoreMin = 6; n.events = ev("snore", (2, 10))
    #expect(Score.insights(n).contains("You snored for about 6 min, from 02:10."))
    n.snoreMin = 40; n.events = ev("snore", (2, 10), (2, 30), (2, 50), (4, 0))
    #expect(Score.insights(n).first { $0.hasPrefix("You snored") }?.hasPrefix("You snored for about 40 min, mostly ") == true)
  }

  @Test func averagesBedtimesAcrossMidnightAndSumsOnlyTheShortfallAsDebt() throws {
    let s = try #require(Score.summary([.rec(on: at(20, 23, 50), wake: at(21, 6, 40), asleep: 400), .rec(on: at(21, 0, 10), wake: at(22, 6, 50), asleep: 480)], need: 450))
    #expect(Clock.noonToClock(try #require(s.on).mean) == "00:00")
    #expect(s.on?.sd == 10)
    #expect(Clock.noonToClock(try #require(s.wake).mean) == "06:45")
    #expect(s.debt == 50 && s.avgAsleep == 440)
    #expect(Score.summary([], need: 450) == nil)
  }
}
