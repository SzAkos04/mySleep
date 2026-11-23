import Testing
import Foundation
@testable import NightKit

// The app records the night and keeps its log; the rules turn a finished log into the night it
// holds, once, and put a night's times right by hand.
@Suite struct RecordTests {
  let start = at(29, 23, 0)

  @Test func aLogIsTheNightRecordMarkedAsRecordedByTheApp() {
    let n = NightRecord(log: Fixtures.log())
    #expect(n.id == "2026-10-29" && n.bed == start && n.wake == start + 8 * 3600e3 && n.source == "native" && n.clips == [])
    #expect((n.asleepMin ?? 0) > 7 * 60)
    #expect(n.timeline?.states.count == 960)
    #expect(n.wakes == 0)
    #expect((n.on ?? 0) - start > 10 * 60000)
  }

  @Test func keepsWhenTheAlarmRangAndHowEarly() {
    #expect(NightRecord(log: Fixtures.log()).alarm == .init(at: start + 7.4 * 3600e3 + 2000, early: 12))
    #expect(NightRecord(log: Fixtures.log(events: [.init(ms: 0, type: "start"), .init(ms: 8 * 3600e3, type: "finish")])).alarm == nil)
    // the app rang by itself (no system alarm): that counts as ringing too
    let own = Fixtures.log(events: [.init(ms: 0, type: "start"), .init(ms: 7 * 3600e3, type: "ring", data: ["self": .bool(true), "early": .number(0)]), .init(ms: 8 * 3600e3, type: "finish")])
    #expect(NightRecord(log: own).alarm == .init(at: start + 7 * 3600e3, early: 0))
  }

  @Test func sumsUpWhatWentWrongInTheNight() {
    let d = NightRecord(log: Fixtures.log()).diag ?? [:]
    #expect(d == ["app": .string("native"), "events": .number(7), "interruptions": .number(1), "restarts": .number(1), "micSilent": .number(1),
                  "recoveries": .number(0), "stalls": .number(0), "locked": .number(0), "memoryWarnings": .number(0)])
    let back = NightRecord.diag([.init(ms: 0, type: "start"), .init(ms: 5000, type: "mic-silent"), .init(ms: 9000, type: "recovered"),
                                 .init(ms: 20000, type: "mic-silent"), .init(ms: 30000, type: "recovered")])
    #expect(back["micSilent"] == .number(2) && back["recoveries"] == .number(2))
  }

  func native(_ bed: Double, wake: Double? = nil, source: String = "native") -> NightRecord {
    var n = NightRecord(id: "2026-10-29"); n.bed = bed; n.wake = wake; n.source = source; return n
  }

  @Test func aFinishedLogOfANightNotHereYetBecomesTheNight() {
    #expect(NightRecord.takeIn(Fixtures.log(), nights: [:])?.bed == start)
  }

  @Test func notUnfinishedNotHereAlreadyNotOverADeletedNightOrOneFromElsewhere() {
    #expect(NightRecord.takeIn(Fixtures.log(final: false), nights: [:]) == nil)
    #expect(NightRecord.takeIn(Fixtures.log(), nights: ["2026-10-29": native(start)]) == nil)
    var gone = NightRecord(id: "2026-10-29"); gone.deleted = true
    #expect(NightRecord.takeIn(Fixtures.log(), nights: ["2026-10-29": gone]) == nil)
    #expect(NightRecord.takeIn(Fixtures.log(), nights: ["2026-10-29": native(start, source: "web")]) == nil)
    #expect(NightRecord.takeIn(Fixtures.log(start: start + 3600e3), nights: ["2026-10-29": native(start)]) != nil)   // a later night, same date
  }

  // 3 November: a night of 3 h 43 and, after its alarm was stopped, a 20 min restart the same evening;
  // the restart took the night's place
  @Test func aLaterNightTheSameDateReplacesTheEarlierOnlyWhenLonger() {
    let short = Fixtures.log(start: start + 8 * 3600e3, events: [.init(ms: 0, type: "start"), .init(ms: 20 * 60e3, type: "finish")])
    #expect(NightRecord.takeIn(Fixtures.log(), nights: ["2026-10-29": native(start - 5000, wake: start - 5000 + 3600e3)]) != nil)
    #expect(NightRecord.takeIn(short, nights: ["2026-10-29": native(start, wake: start + 8 * 3600e3)]) == nil)
    // the earlier, longer night comes back over the short restart that replaced it
    #expect(NightRecord.takeIn(Fixtures.log(), nights: ["2026-10-29": native(start + 8 * 3600e3, wake: start + 8 * 3600e3 + 20 * 60e3)])?.bed == start)
  }

  @Test func aRestartJustAsLongAsTheNightHereDoesNotReplaceIt() {
    let same = Fixtures.log(start: start + 3600e3)   // 8 h, as the night here
    #expect(NightRecord.takeIn(same, nights: ["2026-10-29": native(start, wake: start + 8 * 3600e3)]) == nil)
  }

  // in bed 23:00, asleep 23:15, up 07:00, 5 min awake in the night
  var hand: NightRecord {
    var n = NightRecord(id: "2026-10-28"); n.bed = at(28, 23, 0); n.on = at(28, 23, 15); n.wake = at(29, 7, 0); n.awakeMin = 5; n.asleepMin = 460
    return n
  }

  @Test func untouchedTheAnalysedMinutesStand() {
    #expect(hand.corrected(bed: "23:00", on: "23:15", wake: "07:00") == .night(hand))
  }

  @Test func newTimesCountTheSleepFromThemLessTheTimeAwake() {
    guard case .night(let n) = hand.corrected(bed: "23:00", on: "23:45", wake: "06:45") else { Issue.record(); return }
    #expect(n.bed == at(28, 23, 0) && n.on == at(28, 23, 45) && n.wake == at(29, 6, 45) && n.asleepMin == 7 * 60 - 5)
    // asleep after midnight and up after noon: both the next day
    guard case .night(let late) = hand.corrected(bed: "23:00", on: "00:30", wake: "12:30") else { Issue.record(); return }
    #expect(late.on == at(29, 0, 30) && late.wake == at(29, 12, 30) && late.asleepMin == 12 * 60 - 5)
    // no sleep time: nothing asleep
    guard case .night(let none) = hand.corrected(bed: "23:00", on: "", wake: "07:00") else { Issue.record(); return }
    #expect(none.on == nil && none.asleepMin == 0)
  }

  @Test func clearedOrImpossibleTimesAreRefusedNotSaved() {
    #expect(hand.corrected(bed: "", on: "23:15", wake: "07:00") == .refused("Going to bed and waking up need a time."))
    #expect(hand.corrected(bed: "23:00", on: "23:15", wake: "") == .refused("Going to bed and waking up need a time."))
    #expect(hand.corrected(bed: "23:00", on: "22:30", wake: "07:00") == .refused("Falling asleep has to be between going to bed and waking up."))
    #expect(hand.corrected(bed: "23:00", on: "07:30", wake: "07:00") == .refused("Falling asleep has to be between going to bed and waking up."))
  }

  @Test func aNightKeepsWhatThisVersionDoesNotKnowThroughSavingAndSending() throws {
    let json = #"{"id":"a","bed":1,"wake":2,"q":3,"on":"not a time","timeline":{"states":"wl"}}"#
    let n = try JSONDecoder().decode(NightRecord.self, from: Data(json.utf8))
    #expect(n.bed == 1 && n.on == nil && n.timeline?.states == "wl" && n.timeline?.db == [])
    let back = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(n)) as? [String: Any])
    #expect(back["q"] as? Int == 3 && back["on"] as? String == "not a time")
  }
}
