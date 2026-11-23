import Testing
import Foundation
@testable import NightKit

// What the screens show, from a store with a real night in it (the fixture's: 165.5 min asleep on
// 29 October 2026, made from its log).
@Suite struct ViewsTests {
  func store() -> NightStore { let s = NightStore(); s.saveNight(NightRecord(log: Fixtures.shortLog()), now: Date()); return s }
  let now = Date(timeIntervalSince1970: 1_793_340_000)   // 30 October 2026, morning

  @Test func aNightsReport() throws {
    let r = try #require(store().report("2026-10-29"))
    #expect(r.title == "Thu, Oct 29")
    #expect(r.facts.map(\.label) == ["asleep", "to fall asleep", "restful"])
    #expect(r.facts[0].value == "2h 46m")
    #expect(!r.blank && r.score > 0)
    #expect(r.times.bed.count == 5 && r.times.on.count == 5 && r.times.wake.count == 5)
    #expect(r.parts.first?.label == "Duration")
    #expect(r.timeline?.states.isEmpty == false && r.timeline?.db.isEmpty == false)
    #expect(r.sounds.first?.label == "Snoring")
    #expect(r.alarm?.hasPrefix("The alarm rang at") == true)
    #expect(r.diag.first == ReportView.Diag(label: "Recorded by", value: "mySleep", bad: false))
    #expect(store().report("2026-01-01") == nil)
  }

  @Test func aMonthOfNights() throws {
    let s = store()
    #expect(s.startMonth(now: now) == MonthID(year: 2026, month: 9))
    let j = try #require(s.journal(MonthID(year: 2026, month: 9), selected: nil, now: now))
    #expect(j.title == "October" && j.lead == 3 && j.days.count == 31 && j.canNext == false)
    #expect(j.days[28].id == "2026-10-29" && j.days[28].kind == .scored && j.days[28].score != nil)
    #expect(j.days[0].kind == .none)
    #expect(j.selected?.id == "2026-10-29" && j.selected?.headline == "2h 46m asleep")
    #expect(s.journal(MonthID(year: 2025, month: 11), selected: nil, now: now)?.sub == "No nights this month")
  }

  @Test func trends() throws {
    let t = try #require(store().trends(days: 7))
    #expect(t.empty == nil && t.label == "This week" && t.kpis?.count == 4)
    #expect(t.scores?.count == 1 && t.hours?.first?.value == 165.5 && t.target?.label == "23:00–06:45")
    #expect(NightStore().trends(days: 7)?.empty == "Trends start after a couple of nights.")
  }
}
