import Testing
import Foundation
@testable import NightKit

// The nights and settings on the phone, and their sync with the server (POST /api/sync). The
// rules are the web app's own (sync.js, run in JavaScriptCore); here: that the app drives them
// right, against a stand-in server.
@Suite struct NightStoreTests {
  func store(_ json: String? = nil) throws -> NightStore { try NightStore(rules: Rules(source: Rules.bundleSource), json: json) }
  func object(_ s: String) throws -> [String: Any] { try #require(try JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any]) }
  let t0 = Date(timeIntervalSince1970: 1000)

  /// A server that answers with `reply` and remembers what it was sent.
  final class Server { var got: [[String: Any]] = []; var status = 200; var reply = #"{"rev":0,"changes":[]}"#
    func send(_ body: Data) async -> (status: Int, body: Data) {
      got.append((try? JSONSerialization.jsonObject(with: body) as? [String: Any]) ?? [:])
      return (status, Data(reply.utf8))
    }
  }

  @Test func startsEmptyWithDefaultSettings() throws {
    let o = try object(try store().json)
    #expect((o["nights"] as? [String: Any])?.isEmpty == true)
    #expect((o["settings"] as? [String: Any])?["wake"] as? String == "06:45")
    #expect(try store().dirtyCount == 0)
  }

  @Test func aSavedNightGoesUpAndIsCleanAfterwards() async throws {
    let s = try store(), server = Server()
    try s.saveNight(#"{"id":"2026-10-29","asleepMin":400}"#, now: t0)
    #expect(s.dirtyCount == 1)
    server.reply = #"{"rev":5,"changes":[]}"#
    #expect(await s.sync(now: t0, send: server.send) == .synced)
    let sent = try #require((server.got[0]["changes"] as? [[String: Any]])?.first)
    #expect(server.got[0]["since"] as? Int == 0)
    #expect(sent["kind"] as? String == "night" && sent["id"] as? String == "2026-10-29" && sent["ts"] as? Int == 1_000_000)
    #expect(s.dirtyCount == 0)
    #expect(try object(s.json)["rev"] as? Int == 5)
    // the next sync asks from where this one ended, and sends nothing
    _ = await s.sync(now: t0, send: server.send)
    #expect(server.got[1]["since"] as? Int == 5)
    #expect((server.got[1]["changes"] as? [Any])?.isEmpty == true)
  }

  @Test func nightsFromTheServerAreMergedAndANewerLocalEditStays() async throws {
    let s = try store(), server = Server()
    try s.saveNight(#"{"id":"a","q":3}"#, now: Date(timeIntervalSince1970: 200))
    server.reply = #"""
    {"rev":9,"changes":[{"kind":"night","id":"a","ts":100000,"data":{"id":"a","q":1}},
                        {"kind":"night","id":"b","ts":100,"data":{"id":"b","q":5}}]}
    """#
    _ = await s.sync(now: t0, send: server.send)
    let nights = try #require(try object(s.json)["nights"] as? [String: [String: Any]])
    #expect(nights["a"]?["q"] as? Int == 3)   // the local edit (ts 200000) is newer than the server's (100000)
    #expect(nights["b"]?["q"] as? Int == 5)
  }

  @Test func aDeletedNightGoesUpAsADeletion() async throws {
    let s = try store(), server = Server()
    try s.saveNight(#"{"id":"a"}"#, now: t0)
    try s.deleteNight("a", now: t0.addingTimeInterval(5))
    _ = await s.sync(now: t0, send: server.send)
    let sent = try #require((server.got[0]["changes"] as? [[String: Any]])?.first)
    #expect(sent["deleted"] as? Bool == true && sent["data"] == nil)
  }

  @Test func anEditMadeWhileTheSyncIsOutStaysToSend() async throws {
    let s = try store(), server = Server()
    try s.saveNight(#"{"id":"a","q":1}"#, now: t0)
    let r = await s.sync(now: t0) { body in
      try? s.saveNight(#"{"id":"a","q":2}"#, now: self.t0.addingTimeInterval(9))
      return await server.send(body)
    }
    #expect(r == .synced)
    #expect(s.dirtyCount == 1)
  }

  @Test func offlineAndRefusedKeepTheEditsAndSayWhy() async throws {
    let s = try store(), server = Server()
    try s.saveNight(#"{"id":"a"}"#, now: t0)
    server.status = 0
    #expect(await s.sync(now: t0, send: server.send) == .offline)
    server.status = 502
    #expect(await s.sync(now: t0, send: server.send) == .offline)    // nginx up, the API behind it not
    server.status = 401
    #expect(await s.sync(now: t0, send: server.send) == .unauthorized)
    server.status = 500
    #expect(await s.sync(now: t0, send: server.send) == .failed(500))
    #expect(s.dirtyCount == 1)
  }

  @Test func settingsAreMergedAndStamped() async throws {
    let s = try store(), server = Server()
    try s.saveSettings(#"{"wake":"07:00"}"#, now: t0)
    let o = try #require(try object(s.json)["settings"] as? [String: Any])
    #expect(o["wake"] as? String == "07:00" && o["bedtime"] as? String == "23:00" && o["ts"] as? Int == 1_000_000)
    _ = await s.sync(now: t0, send: server.send)
    #expect((server.got[0]["changes"] as? [[String: Any]])?.first?["kind"] as? String == "settings")
  }

  @Test func theStateSurvivesTheFileAndAHalfWrittenOneIsNeverLoaded() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("store-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: url) }
    let s = try store()
    try s.saveNight(#"{"id":"a","q":7}"#, now: t0)
    try s.write(to: url)
    let again = try store(try String(contentsOf: url, encoding: .utf8))
    #expect(again.dirtyCount == 1)
    #expect((try object(again.json)["nights"] as? [String: Any])?["a"] != nil)
    // not JSON: the store starts empty rather than failing the app
    #expect(try store("{ broken").dirtyCount == 0)
  }

  @Test func aFinishedLogBecomesTheNightOnceAndGoesUp() throws {
    let rules = try Rules(source: Rules.bundleSource)
    let fixture = try String(contentsOf: RulesTests.fixtures.appendingPathComponent("fixture.js"), encoding: .utf8)
    let log = try #require(try rules.evaluate(fixture + "\n;JSON.stringify(fixtureLog())"))
    let s = try NightStore(rules: rules)
    #expect(try s.takeIn(log: log, now: t0) == true)
    #expect(s.dirtyCount == 1)
    let n = try #require((try object(s.json)["nights"] as? [String: [String: Any]])?["2026-10-29"])
    #expect(n["source"] as? String == "native" && n["asleepMin"] as? Double == 165.5)
    #expect(try s.takeIn(log: log, now: t0) == false)   // the same log again: nothing new
    #expect(s.dirtyCount == 1)
    #expect(try s.takeIn(log: log.replacingOccurrences(of: "\"final\":true", with: "\"final\":false"), now: t0) == false)
  }

  @Test func timesCorrectedByHandAreCountedAndImpossibleOnesRefused() throws {
    let rules = try Rules(source: Rules.bundleSource)
    let fixture = try String(contentsOf: RulesTests.fixtures.appendingPathComponent("fixture.js"), encoding: .utf8)
    let s = try NightStore(rules: rules)
    try s.takeIn(log: try #require(try rules.evaluate(fixture + "\n;JSON.stringify(fixtureLog())")), now: t0)
    // falling asleep before going to bed: said, nothing saved
    #expect(try s.correct("2026-10-29", bed: "22:00", on: "21:00", wake: "00:45", now: t0) == "Falling asleep has to be between going to bed and waking up.")
    #expect(try s.correct("2026-10-29", bed: "", on: "", wake: "00:45", now: t0) != nil)
    // 22:20 to 00:45 is 145 min, none of it awake
    #expect(try s.correct("2026-10-29", bed: "22:00", on: "22:20", wake: "00:45", now: t0.addingTimeInterval(5)) == nil)
    let n = try #require((try object(s.json)["nights"] as? [String: [String: Any]])?["2026-10-29"])
    #expect(n["asleepMin"] as? Int == 145 && n["ts"] as? Int == 1_005_000)
    #expect(s.dirtyCount == 1)
  }

  @Test func aDeletedNightIsGoneFromTheScreens() throws {
    let rules = try Rules(source: Rules.bundleSource)
    let fixture = try String(contentsOf: RulesTests.fixtures.appendingPathComponent("fixture.js"), encoding: .utf8)
    let s = try NightStore(rules: rules)
    try s.takeIn(log: try #require(try rules.evaluate(fixture + "\n;JSON.stringify(fixtureLog())")), now: t0)
    #expect(s.report("2026-10-29") != nil)
    try s.deleteNight("2026-10-29", now: t0.addingTimeInterval(5))
    #expect(s.report("2026-10-29") == nil)
    #expect(s.journal(MonthID(year: 2026, month: 9), selected: nil, now: t0)?.selected == nil)
  }
}
