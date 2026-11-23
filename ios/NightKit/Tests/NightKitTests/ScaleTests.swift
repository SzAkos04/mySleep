import Testing
import Foundation
@testable import NightKit

// A year of nights (2 MB of state) must answer a screen quickly. With the rules in JavaScript the
// whole state crossed into JavaScriptCore on every call: 6-13 ms a screen on the Mac (2026-11-23,
// Debug), and an app's JavaScriptCore on the iPhone has no JIT. In Swift it is a lookup and a sort.
@Suite struct ScaleTests {
  /// `count` nights, each the fixture night under another date.
  static func year(_ count: Int) -> NightStore {
    let n = NightRecord(log: Fixtures.shortLog()), s = NightStore()
    for i in 0..<count {
      var m = n; m.id = Clock.id(of: Date(timeIntervalSince1970: 1_793_275_200 - Double(i) * 86400))
      s.state.nights[m.id] = m; s.state.nights[m.id]?.ts = Double(1 + i)
    }
    return s
  }

  @Test func aYearOfNightsAnswersAScreenQuickly() throws {
    let s = Self.year(1100)   // 1100 short nights are 2 MB: a year of 8 h nights is about that
    let now = Date(timeIntervalSince1970: 1_793_340_000)
    func ms(_ f: () throws -> Void) rethrows -> Double { let t = Date(); try f(); return Date().timeIntervalSince(t) * 1000 }
    let report = ms { _ = s.report("2026-10-29") }
    let journal = ms { _ = s.journal(s.startMonth(now: now), selected: nil, now: now) }
    let trends = ms { _ = s.trends(days: 365) }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("scale-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: url) }
    let save = try ms { try s.write(to: url) }
    let load = ms { _ = NightStore.load(from: url) }
    print("ScaleTests ms: report \(report) journal \(journal) trends \(trends) save \(save) load \(load)")
    #expect(max(report, journal) < 20)   // Debug, on the Mac
    #expect(trends < 100)
    #expect(max(save, load) < 1000)
  }
}
