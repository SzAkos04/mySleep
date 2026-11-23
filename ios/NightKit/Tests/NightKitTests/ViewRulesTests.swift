import Testing
import Foundation
@testable import NightKit

// What the screens show, as plain data (the app draws it): the night's report, the journal's
// month, the trends. The wording and the numbers are decided here.
@Suite struct ViewRulesTests {
  static func night(_ id: String, _ asleep: Double = 450, _ edit: (inout NightRecord) -> Void = { _ in }) -> NightRecord {
    let bed = Clock.atClock(id, "23:00")
    var n = NightRecord.rec(id, bed: bed, on: bed + 15 * 60e3, wake: Clock.atClock(id, "07:00"), asleep: asleep, awake: 5, wakes: 1, restful: 200, snore: 0, events: [])
    n.talks = 0; n.coughs = 0
    edit(&n)
    return n
  }
  static func state(_ ns: NightRecord...) -> NightState { state(ns) }
  static func state(_ ns: [NightRecord]) -> NightState {
    var s = NightState()
    s.settings.bedtime = "23:00"; s.settings.wake = "06:45"
    s.nights = Dictionary(ns.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
    return s
  }
  static let gaps = Timeline(start: 1, states: String(repeating: "g", count: 100))
  let now = Clock.date(at(29, 9, 0))
  func score(_ n: NightRecord) -> Int { Score.of(n, bedtime: "23:00").score }
  typealias V = ViewRulesTests

  @Test func aVerdictNamesANightByItsScore() {
    #expect([90, 85, 84, 70, 69, 55, 54, 0].map(NightState.verdict) == ["A great night", "A great night", "A good night", "A good night", "An okay night", "An okay night", "A rough night", "A rough night"])
  }

  @Test func theReportsTitleTimesScoreAndThreeNumbers() throws {
    let n = V.night("2026-10-28"), v = try #require(V.state(n).reportView("2026-10-28"))
    #expect(v.title == "Wed, Oct 28")
    #expect(v.range == "In bed 23:00 – 07:00 · 8h 00m")
    #expect(v.score == score(n) && v.verdict == NightState.verdict(v.score) && !v.blank)
    #expect(v.times == .init(bed: "23:00", on: "23:15", wake: "07:00"))   // for correcting them
    #expect(V.state(V.night("2026-10-27", 0) { $0.on = nil }).reportView("2026-10-27")?.times.on == "")
    #expect(v.facts == [Stat(value: "7h 30m", label: "asleep"), Stat(value: "15 min", label: "to fall asleep"), Stat(value: "3h 20m", label: "restful")])
  }

  @Test func comparedWithTheWeekWhenThereAreThreeNightsToCompareWith() {
    let week = ["21", "22", "23", "24", "25"].map { V.night("2026-10-" + $0, 400) }, good = V.night("2026-10-28", 480)
    let avg = JS.int(Double(week.map(score).reduce(0, +)) / Double(week.count))
    #expect(V.state(week + [good]).reportView("2026-10-28")?.vsWeek == "Better than your week (\(avg))")
    #expect(V.state(week[0], good).reportView("2026-10-28")?.vsWeek == nil)
  }

  @Test func aNightTheMicrophoneDidNotRecordSaysSoWithNoScoreToCompare() throws {
    let v = try #require(V.state(V.night("2026-10-28", 0) { $0.on = nil; $0.timeline = V.gaps }).reportView("2026-10-28"))
    #expect(v.blank && v.verdict == "Nothing recorded" && v.vsWeek == nil)
    #expect(v.insights.first?.contains("recorded nothing") == true)
  }

  @Test func howTheScoreAddsUpTheSentencesTheSoundsTheAlarmAndTheDiagnostics() throws {
    let n = V.night("2026-10-28") {
      $0.events = [.init(t: Clock.atClock("2026-10-28", "02:10"), kind: "snore", sec: 300), .init(t: Clock.atClock("2026-10-28", "03:00"), kind: "talk", sec: 20)]
      $0.snoreMin = 5; $0.alarm = .init(at: Clock.atClock("2026-10-28", "06:33"), early: 12)
      $0.diag = ["app": .string("native"), "interruptions": .number(1), "restarts": .number(0), "micSilent": .number(0), "locked": .number(2)]
    }
    let v = try #require(V.state(n).reportView("2026-10-28")), s = Score.of(n, bedtime: "23:00")
    #expect(v.parts.map(\.label) == s.parts.map(\.label))
    #expect(v.parts[0] == .init(label: "Duration", note: "7h 30m of 8h 00m", pts: JS.int(s.parts[0].pts), max: 35))
    #expect(v.insights.contains { $0.contains("snored for about 5 min") })
    #expect(v.sounds == [.init(label: "Snoring", time: "02:10", length: "5 min"), .init(label: "Talking", time: "03:00", length: "20 s")])
    #expect(v.alarm == "The alarm rang at 06:33, 12 min early.")
    #expect(v.diag == [.init(label: "Recorded by", value: "mySleep", bad: false), .init(label: "Interruptions", value: "1", bad: true),
                       .init(label: "Audio restarted", value: "0", bad: false), .init(label: "Microphone sent nothing", value: "0", bad: false),
                       .init(label: "Phone locked", value: "2", bad: false)])
  }

  @Test func aNightThatIsNotThereOrDeletedIsNothing() {
    var gone = NightRecord(id: "2026-10-28"); gone.deleted = true; gone.ts = 1
    #expect(V.state().reportView("2026-10-28") == nil)
    #expect(V.state(gone).reportView("2026-10-28") == nil)
  }

  let month = [night("2026-10-27", 480), night("2026-10-28", 300), night("2026-10-20", 0) { $0.on = nil; $0.timeline = gaps }, night("2026-09-30", 450)]

  @Test func theMonthAsACalendarFromMonday() {
    let v = V.state(month).journalView(MonthID(year: 2026, month: 9), selected: nil, now: now)
    #expect(v.title == "October")
    #expect(v.sub == "Average \(JS.int(Double(score(month[0]) + score(month[1])) / 2)) · 3 nights")
    #expect(v.lead == 3)   // 1 October 2026 is a Thursday
    #expect(v.days.count == 31)
    #expect(v.days[26] == .init(n: 27, id: "2026-10-27", kind: .scored, score: score(month[0]), tone: NightState.tone(score(month[0]))))
    #expect(v.days[19].kind == .blank && v.days[0].kind == .none && v.days[29].kind == .future)   // 30 October, after now
    #expect(!v.canNext)
  }

  @Test func anEarlierMonthItsOwnYearWhenNotThisOneAWayForwardNoNightsWhenEmpty() {
    let sep = V.state(month).journalView(MonthID(year: 2026, month: 8), selected: nil, now: now)
    #expect(sep.title == "September" && sep.canNext && sep.lead == 1)
    let dec = V.state(month).journalView(MonthID(year: 2025, month: 11), selected: nil, now: now)
    #expect(dec.title == "December 2025" && dec.sub == "No nights this month")
  }

  @Test func theChosenNightBelowLastNightAtFirst() {
    let v = V.state(month).journalView(MonthID(year: 2026, month: 9), selected: nil, now: now)
    #expect(v.selected?.id == "2026-10-28" && v.selected?.title == "Wed, Oct 28" && v.selected?.headline == "5h 00m asleep" && v.selected?.line == "Woke once")
    #expect(V.state(month).journalView(MonthID(year: 2026, month: 9), selected: "2026-10-27", now: now).selected?.id == "2026-10-27")
    let none = V.state().journalView(MonthID(year: 2026, month: 9), selected: nil, now: now)
    #expect(none.selected == nil && none.empty == "Your nights will fill this calendar.")
  }

  let week = ["22", "23", "24", "25", "26", "27", "28"].enumerated().map { i, d in night("2026-10-" + d, 420 + Double(i) * 10) { if i == 3 { $0.snoreMin = 12 } } }

  @Test func trendsNothingToShowBeforeACoupleOfNights() {
    #expect(V.state().trendsView(days: 7).empty == "Trends start after a couple of nights.")
  }

  @Test func aWeekTheAverageAndFourNumbersThenABarForEachNight() throws {
    let v = V.state(week).trendsView(days: 7), sc = week.map(score)
    #expect(v.label == "This week" && v.avg == JS.int(Double(sc.reduce(0, +)) / 7) && v.change == nil)
    #expect(v.kpis?.map(\.label) == ["asleep a night", "short of 8 h, in all", "asleep ± 0 min", "awake ± 0 min"])
    #expect(v.kpis?.first?.value == "7h 30m")
    #expect(v.scores?.map(\.value) == sc.map(Double.init))                         // oldest first
    #expect(v.scores?.first?.id == "2026-10-22" && v.scores?.first?.label == "T")   // 22 October 2026 is a Thursday
    #expect(v.hours?.map(\.value) == [420, 430, 440, 450, 460, 470, 480])
    #expect(v.hours?.last?.full == true && v.hours?.first?.full == false)
    #expect(v.windows?.first?.id == "2026-10-22")
    #expect(v.target == .init(bed: 660, wake: 1125, label: "23:00–06:45"))   // minutes after noon
    #expect(v.snoring?.map(\.value) == week.map { $0.snoreMin ?? 0 })
  }

  @Test func comparedWithThePeriodBeforeNoSnoringChartWithoutSnoring() {
    let before = ["15", "16", "17", "18", "19", "20", "21"].map { V.night("2026-10-" + $0, 300) }
    let v = V.state(before + week.map { var n = $0; n.snoreMin = 0; return n }).trendsView(days: 7)
    #expect(v.change?.wholeMatch(of: /up \d+ on the week before/) != nil)
    #expect(v.snoring == nil)
  }

  @Test func aMonthLabelsTheMondaysWithTheirDate() {
    let many = (0..<14).map { V.night("2026-10-" + Clock.pad(15 + $0)) }
    let v = V.state(many).trendsView(days: 30)
    #expect(v.label == "This month")
    #expect(v.scores?.map(\.label).filter { !$0.isEmpty } == ["19", "26"])   // the Mondays
  }

  @Test func theJournalOpensOnTheNewestNightsMonthADeletedOneNotCounted() {
    var gone = NightRecord(id: "2026-09-05"); gone.deleted = true; gone.ts = 1
    #expect(V.state(V.night("2026-08-31"), V.night("2026-07-02"), gone).startMonth(now: now) == MonthID(year: 2026, month: 7))
    #expect(V.state().startMonth(now: now) == MonthID(year: 2026, month: 9))
  }
}
