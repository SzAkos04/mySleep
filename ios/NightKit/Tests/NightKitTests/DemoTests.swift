import Testing
import Foundation
@testable import NightKit

// The demo mode (MYSLEEP_DEMO=1, the UI tests): a month of made-up nights, the same every time.
@Suite struct DemoTests {
  let now = Clock.date(at(23, 9, 0, month: 11))

  @Test func aMonthOfNightsEndingLastNightTheSameEveryTimeNothingToSync() {
    let s = NightState.demo(now: now)
    #expect(s.nights.count == 30)
    #expect(s.list.first?.id == "2026-11-22" && s.list.last?.id == "2026-10-24")
    #expect(s.dirty.isEmpty && s.rev == 0)
    #expect(s == NightState.demo(now: now))
    #expect(s.nights.values.allSatisfy { !Score.unrecorded($0) && ($0.asleepMin ?? 0) > 5 * 60 && $0.timeline != nil })
    #expect(Set(s.nights.values.map { s.score($0) }).count > 5)   // nights that differ
  }

  @Test func inTheEveningTooItEndsLastNightNotTonight() {
    #expect(NightState.demo(now: Clock.date(at(23, 21, 43, month: 11))).list.first?.id == "2026-11-22")
    #expect(NightState.demo(now: Clock.date(at(23, 0, 30, month: 11))).list.first?.id == "2026-11-22")   // after midnight: the night going on, as Clock.nightId counts
  }

  @Test func everyScreenHasSomethingToShow() throws {
    let s = NightState.demo(now: now)
    #expect(s.reportView("2026-11-22")?.sounds.isEmpty == false)
    #expect(s.journalView(s.startMonth(now: now), selected: nil, now: now).selected != nil)
    #expect(s.trendsView(days: 7).scores?.count == 7 && s.trendsView(days: 30).snoring != nil)
  }
}
