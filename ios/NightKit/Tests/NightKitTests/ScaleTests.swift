import Testing
import Foundation
@testable import NightKit

// The whole state goes into JavaScriptCore on every view-model call (NightStore.withState): 2 MB of state (about a year of
// nights) must still answer a screen in well under 100 ms; this runs on the Mac, the phone is 2-4 times slower.
@Suite struct ScaleTests {
  /// `count` nights, each the fixture night under another date.
  func year(_ count: Int) throws -> NightStore {
    let rules = try Rules(source: Rules.bundleSource)
    let fixture = try String(contentsOf: RulesTests.fixtures.appendingPathComponent("fixture.js"), encoding: .utf8)
    let state = try #require(try rules.evaluate(fixture + """
    \n;(function(){const n=MySleepRules.nightFromLog(fixtureLog()),nights={},dirty={};
    for(let i=0;i<\(count);i++){const d=new Date(Date.UTC(2026,9,29)-i*864e5),id=d.toISOString().slice(0,10);nights[id]={...n,id,ts:1+i};}
    return JSON.stringify({user:null,nights,settings:MySleepRules.defaultSettings(),rev:0,dirty,lastSynced:null})})()
    """))
    return try NightStore(rules: rules, json: state)
  }

  @Test func aYearOfNightsAnswersAScreenQuickly() throws {
    let s = try year(1100)   // 1100 short nights are 2 MB: a year of 8 h nights is about that
    let now = Date(timeIntervalSince1970: 1_793_340_000)
    func ms(_ f: () -> Void) -> Double { let t = Date(); f(); return Date().timeIntervalSince(t) * 1000 }
    let report = ms { _ = s.report("2026-10-29") }
    let journal = ms { _ = s.journal(MonthID(year: 2026, month: 9), selected: nil, now: now) }
    let trends = ms { _ = s.trends(days: 365) }
    let settings = ms { _ = s.settings }
    #expect(max(report, journal, trends, settings) < 100)   // measured 2026-11-16 on the Mac: 8-13 ms for 2 MB of state, so about 25-40 ms on an A13
  }
}
