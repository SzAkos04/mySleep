import Testing
import Foundation
@testable import NightKit

// The app runs the web app's night rules as one bundled script (shared/lib/rules.js, built
// into ios/MySleepNight/rules.js) in JavaScriptCore. A fixed night goes through it here and must
// come out as node made it (golden.json, shared/scripts/golden.mjs), letter for letter, in any time
// zone (the fixture makes local time UTC): scores,
// the night record, the sentences about it.
@Suite struct RulesTests {
  static let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")

  @Test func theFixedNightComesOutAsNodeMadeIt() throws {
    let rules = try Rules(source: Rules.bundleSource)
    let fixture = try String(contentsOf: Self.fixtures.appendingPathComponent("fixture.js"), encoding: .utf8)
    let mine = try #require(try rules.evaluate(fixture + "\n;JSON.stringify(goldenOutputs())")?.data(using: .utf8))
    let golden = try Data(contentsOf: Self.fixtures.appendingPathComponent("golden.json"))
    let a = try #require(try JSONSerialization.jsonObject(with: mine) as? [String: String])
    let b = try #require(try JSONSerialization.jsonObject(with: golden) as? [String: String])
    #expect(Set(a.keys) == Set(b.keys))
    for (k, v) in b { #expect(a[k] == v, "\(k)") }
  }

  /// A night is named after its evening: starting before noon belongs to the day before (the user chose noon).
  @Test func aNightIsNamedAfterItsEvening() throws {
    let rules = try Rules(source: Rules.bundleSource)
    func id(_ day: Int, _ h: Int, _ m: Int) throws -> String {
      let date = try #require(Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: day, hour: h, minute: m)))
      return rules.nightId(Int64(date.timeIntervalSince1970 * 1000))
    }
    #expect(try id(30, 4, 55) == "2026-10-29")    // after midnight: the evening before
    #expect(try id(30, 11, 59) == "2026-10-29")
    #expect(try id(30, 12, 0) == "2026-10-30")    // noon on
    #expect(try id(30, 23, 30) == "2026-10-30")
    #expect(try id(1, 3, 0) == "2026-09-30")      // across a month
  }

  @Test func ASyntaxErrorOrAThrowingScriptIsReported() throws {
    let rules = try Rules(source: Rules.bundleSource)
    #expect(throws: (any Error).self) { try rules.evaluate("MySleepRules.nothingHere()") }
    #expect(try rules.evaluate("MySleepRules.dur(125)") == "2h 05m")
  }
}

extension Rules {
  /// ios/MySleepNight/rules.js, the file the app carries.
  static let bundleSource = try! String(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../../../MySleepNight/rules.js").standardized, encoding: .utf8)
}
