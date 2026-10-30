import Testing
import Foundation
@testable import NightKit

// What the screens show, as the app reads it from the rules (shared/lib/views.js: its own
// tests decide the wording and numbers). Here: that the app can read it, from a store with a real
// night in it (the fixture's: 165.5 min asleep on 29 October 2026).
@Suite struct ViewsTests {
  func store() throws -> NightStore {
    let rules = try Rules(source: Rules.bundleSource)
    let fixture = try String(contentsOf: RulesTests.fixtures.appendingPathComponent("fixture.js"), encoding: .utf8)
    let log = try #require(try rules.evaluate(fixture + "\n;JSON.stringify(fixtureLog())"))
    let s = try NightStore(rules: rules)
    try s.takeIn(log: log, now: Date())
    return s
  }
  let now = Date(timeIntervalSince1970: 1_793_340_000)   // 30 October 2026, morning

  @Test func aNightsReport() throws {
    let r = try #require(try store().report("2026-10-29"))
    #expect(r.title == "Thu, Oct 29")
    #expect(r.facts.map(\.label) == ["asleep", "to fall asleep", "restful"])
    #expect(r.facts[0].value == "2h 46m")
    #expect(!r.blank && r.score > 0 && ["good", "accent", "warn"].contains(r.tone.rawValue))
    #expect(r.times.bed.count == 5 && r.times.on.count == 5 && r.times.wake.count == 5)
    #expect(r.parts.first?.label == "Duration")
    #expect(r.timeline?.states.isEmpty == false && r.timeline?.db.isEmpty == false)
    #expect(r.sounds.first?.label == "Snoring")
    #expect(r.alarm?.hasPrefix("The alarm rang at") == true)
    #expect(r.diag.first == ReportView.Diag(label: "Recorded by", value: "mySleep Night", bad: false))
    #expect(try store().report("2026-01-01") == nil)
  }

  @Test func aMonthOfNights() throws {
    let s = try store()
    #expect(s.startMonth(now: now) == MonthID(year: 2026, month: 9))
    let j = try #require(s.journal(MonthID(year: 2026, month: 9), selected: nil, now: now))
    #expect(j.title == "October" && j.lead == 3 && j.days.count == 31 && j.canNext == false)
    #expect(j.days[28].id == "2026-10-29" && j.days[28].kind == .scored && j.days[28].score != nil)
    #expect(j.days[0].kind == .none)
    #expect(j.selected?.id == "2026-10-29" && j.selected?.headline == "2h 46m asleep")
    #expect(try s.journal(MonthID(year: 2025, month: 11), selected: nil, now: now)?.sub == "No nights this month")
  }

  @Test func trends() throws {
    let s = try store()
    let t = try #require(s.trends(days: 7))
    #expect(t.empty == nil && t.label == "This week" && t.kpis?.count == 4)
    #expect(t.scores?.count == 1 && t.hours?.first?.value == 165.5 && t.target?.label == "23:00–06:45")
    let none = try NightStore(rules: Rules(source: Rules.bundleSource))
    #expect(none.trends(days: 7)?.empty == "Trends start after a couple of nights.")
  }
}
