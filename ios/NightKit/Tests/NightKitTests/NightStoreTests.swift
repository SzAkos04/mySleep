import Testing
import Foundation
@testable import NightKit

// The nights and settings on the phone, and their sync with the server (POST /api/sync): that
// the store drives the sync's rules right, against a stand-in server.
@Suite struct NightStoreTests {
  let t0 = Date(timeIntervalSince1970: 1000)
  func night(_ id: String, q: Double? = nil, asleep: Double? = nil) -> NightRecord {
    var n = NightRecord(id: id); n.asleepMin = asleep; if let q { n.extra["q"] = .number(q) }; return n
  }

  /// A server that answers with `reply` and remembers what it was sent.
  final class Server: @unchecked Sendable { var got: [[String: Any]] = []; var status = 200; var reply = #"{"rev":0,"changes":[]}"#
    func send(_ body: Data) async -> (status: Int, body: Data) {
      got.append((try? JSONSerialization.jsonObject(with: body) as? [String: Any]) ?? [:])
      return (status, Data(reply.utf8))
    }
    var changes: [[String: Any]] { got.last?["changes"] as? [[String: Any]] ?? [] }
  }

  @Test func startsEmptyWithDefaultSettings() {
    let s = NightStore()
    #expect(s.state.nights.isEmpty && s.settings.wake == "06:45" && s.dirtyCount == 0)
  }

  @Test func aSavedNightGoesUpAndIsCleanAfterwards() async throws {
    let s = NightStore(), server = Server()
    s.saveNight(night("2026-10-29", asleep: 400), now: t0)
    #expect(s.dirtyCount == 1)
    server.reply = #"{"rev":5,"changes":[]}"#
    #expect(await s.sync(now: t0, send: server.send) == .synced)
    let sent = try #require(server.changes.first)
    #expect(server.got[0]["since"] as? Int == 0)
    #expect(sent["kind"] as? String == "night" && sent["id"] as? String == "2026-10-29" && sent["ts"] as? Int == 1_000_000)
    #expect((sent["data"] as? [String: Any])?["asleepMin"] as? Int == 400)
    #expect(s.dirtyCount == 0 && s.state.rev == 5)
    // the next sync asks from where this one ended, and sends nothing
    _ = await s.sync(now: t0, send: server.send)
    #expect(server.got[1]["since"] as? Int == 5 && server.changes.isEmpty)
  }

  @Test func nightsFromTheServerAreMergedAndANewerLocalEditStays() async {
    let s = NightStore(), server = Server()
    s.saveNight(night("a", q: 3), now: Date(timeIntervalSince1970: 200))
    server.reply = #"""
    {"rev":9,"changes":[{"kind":"night","id":"a","ts":100000,"rev":8,"deleted":false,"data":{"id":"a","q":1}},
                        {"kind":"night","id":"b","ts":100,"rev":9,"deleted":false,"data":{"id":"b","q":5}}]}
    """#
    _ = await s.sync(now: t0, send: server.send)
    #expect(s.state.nights["a"]?.extra["q"] == .number(3))   // the local edit (ts 200000) is newer than the server's (100000)
    #expect(s.state.nights["b"]?.extra["q"] == .number(5))
  }

  @Test func aDeletedNightGoesUpAsADeletionAndIsGoneFromTheScreens() async throws {
    let s = NightStore(), server = Server()
    s.saveNight(NightRecord(log: Fixtures.shortLog()), now: t0)
    #expect(s.report("2026-10-29") != nil)
    s.deleteNight("2026-10-29", now: t0.addingTimeInterval(5))
    #expect(s.report("2026-10-29") == nil)
    #expect(s.journal(MonthID(year: 2026, month: 9), selected: nil, now: t0)?.selected == nil)
    _ = await s.sync(now: t0, send: server.send)
    let sent = try #require(server.changes.first)
    #expect(sent["deleted"] as? Bool == true && sent["data"] == nil)
  }

  @Test func anEditMadeWhileTheSyncIsOutStaysToSend() async {
    let s = NightStore(), server = Server()
    s.saveNight(night("a", q: 1), now: t0)
    let r = await s.sync(now: t0) { body in
      s.saveNight(self.night("a", q: 2), now: self.t0.addingTimeInterval(9))
      return await server.send(body)
    }
    #expect(r == .synced && s.dirtyCount == 1)
  }

  @Test func offlineRefusedAndUnreadableKeepTheEditsAndSayWhy() async {
    let s = NightStore(), server = Server()
    s.saveNight(night("a"), now: t0)
    server.status = 0
    #expect(await s.sync(now: t0, send: server.send) == .offline)
    server.status = 502
    #expect(await s.sync(now: t0, send: server.send) == .offline)    // Tailscale up, the API behind it not
    server.status = 401
    #expect(await s.sync(now: t0, send: server.send) == .unauthorized)
    server.status = 500
    #expect(await s.sync(now: t0, send: server.send) == .failed(500))
    server.status = 200; server.reply = "<html>a proxy's page</html>"
    #expect(await s.sync(now: t0, send: server.send) == .failed(-1))
    #expect(s.dirtyCount == 1)
  }

  @Test func settingsAreMergedStampedAndGoUp() async {
    let s = NightStore(), server = Server()
    s.change(now: t0) { $0.wake = "07:00" }
    #expect(s.settings.wake == "07:00" && s.settings.bedtime == "23:00" && s.settings.ts == 1_000_000)
    _ = await s.sync(now: t0, send: server.send)
    #expect(server.changes.first?["kind"] as? String == "settings")
    #expect((server.changes.first?["data"] as? [String: Any])?["wake"] as? String == "07:00")
  }

  // The phone and the server's revision (the fixes of 2026-11-22/23 as tests).
  @Test func aServerBehindThePhoneRestoredFromABackupGetsEveryNightAgain() async {
    let s = NightStore(), server = Server()
    s.saveNight(night("a"), now: t0); s.saveNight(night("b"), now: t0)
    server.reply = #"{"rev":40,"changes":[]}"#
    _ = await s.sync(now: t0, send: server.send)
    #expect(s.dirtyCount == 0)
    // data/ put back from a backup: the server is at 12 and has neither night
    server.reply = #"{"rev":12,"changes":[]}"#
    _ = await s.sync(now: t0, send: server.send)
    #expect(s.state.rev == 12 && s.dirtyCount == 2)
    server.reply = #"{"rev":14,"changes":[]}"#
    _ = await s.sync(now: t0, send: server.send)
    #expect(Set(server.changes.compactMap { $0["id"] as? String }) == ["a", "b"])
    #expect(s.dirtyCount == 0)
  }

  @Test func aPhoneBehindTheServerTakesWhatItHasNotSeen() async {
    let s = NightStore(), server = Server()
    server.reply = #"{"rev":30,"changes":[{"kind":"night","id":"x","ts":5,"rev":30,"deleted":false,"data":{"id":"x","asleepMin":300}},{"kind":"night","id":"y","ts":6,"rev":29,"deleted":true,"data":null}]}"#
    _ = await s.sync(now: t0, send: server.send)
    #expect(server.got[0]["since"] as? Int == 0)
    #expect(s.state.nights["x"]?.asleepMin == 300 && s.state.nights["y"]?.deleted == true)
    #expect(s.state.rev == 30 && s.dirtyCount == 0)
    #expect(s.report("y") == nil && s.report("x") != nil)
  }

  /// Two writes racing: the same night edited here while the server sends an older and a newer edit of it.
  @Test func racingWritesTheNewerEditWinsOnBothSides() async {
    let s = NightStore(), server = Server()
    s.saveNight(night("a", q: 1), now: Date(timeIntervalSince1970: 100))
    server.reply = #"{"rev":3,"changes":[{"kind":"night","id":"a","ts":150000,"rev":3,"deleted":false,"data":{"id":"a","q":9}}]}"#
    _ = await s.sync(now: t0) { body in
      s.saveNight(self.night("a", q: 2), now: Date(timeIntervalSince1970: 200))   // edited again while the request is out
      return await server.send(body)
    }
    #expect(s.state.nights["a"]?.extra["q"] == .number(2) && s.dirtyCount == 1)   // the server's 150000 is older than 200000
    server.reply = #"{"rev":4,"changes":[{"kind":"night","id":"a","ts":300000,"rev":4,"deleted":false,"data":{"id":"a","q":7}}]}"#
    _ = await s.sync(now: t0, send: server.send)
    #expect(s.state.nights["a"]?.extra["q"] == .number(7))   // a newer edit from elsewhere wins here
  }

  @Test func theStateSurvivesTheFileAndAnUnreadableOneIsMovedAsideNotWrittenOver() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("store-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let url = dir.appendingPathComponent("nights.json")
    #expect(NightStore.load(from: url).state == NightState())   // no file: empty
    let s = NightStore()
    s.saveNight(NightRecord(log: Fixtures.shortLog()), now: t0)
    try s.write(to: url)
    let again = NightStore.load(from: url)
    #expect(again.state == s.state && again.dirtyCount == 1)
    try Data("{ broken".utf8).write(to: url)
    let broken = NightStore.load(from: url, now: t0)
    #expect(broken.dirtyCount == 0)
    #expect(!FileManager.default.fileExists(atPath: url.path))
    #expect(try String(contentsOf: dir.appendingPathComponent("nights.unreadable-1000000.json"), encoding: .utf8) == "{ broken")
  }

  /// The state file the JavaScript store wrote (user, the nights with nulls): read as it is.
  @Test func aStateFileWrittenByTheJavaScriptStoreIsRead() throws {
    let old = #"{"user":null,"nights":{"2026-10-29":{"id":"2026-10-29","bed":1793311200000,"on":null,"wake":1793322000000,"asleepMin":0,"ts":5,"source":"native","timeline":{"start":1793311200000,"states":"ww","events":"..","db":[30,null]}},"2026-10-28":{"id":"2026-10-28","deleted":true,"ts":4}},"settings":{"bedtime":"23:00","wake":"06:45","alarm":true,"smart":false,"remind":true,"tz":"Europe/Budapest","ts":3},"rev":7,"dirty":{"night:2026-10-29":true},"lastSynced":99}"#
    let s = try JSONDecoder().decode(NightState.self, from: Data(old.utf8))
    #expect(s.nights.count == 2 && s.nights["2026-10-29"]?.on == nil && s.nights["2026-10-29"]?.timeline?.db == [30, nil])
    #expect(s.nights["2026-10-28"]?.deleted == true && s.settings.smart == false && s.settings.ts == 3)
    #expect(s.rev == 7 && s.dirty == ["night:2026-10-29": true] && s.lastSynced == 99)
  }

  @Test func aFinishedLogBecomesTheNightOnceAndGoesUp() throws {
    let s = NightStore()
    let log = try logData(Fixtures.shortLog())
    #expect(s.takeIn(log: log, now: t0))
    #expect(s.dirtyCount == 1)
    let n = try #require(s.state.nights["2026-10-29"])
    #expect(n.source == "native" && n.asleepMin == 165.5)
    #expect(!s.takeIn(log: log, now: t0))   // the same log again: nothing new
    var unfinished = Fixtures.shortLog(); unfinished.final = false
    #expect(!s.takeIn(log: try logData(unfinished), now: t0))
    #expect(!s.takeIn(log: Data("not json".utf8), now: t0))
    #expect(s.dirtyCount == 1)
  }

  /// A log as Night.json writes it (the app's own format), from a NightLog.
  func logData(_ l: NightLog) throws -> Data {
    let n = Night(start: Int64(l.start), night: l.night, env: ["app": "native"])
    for i in l.samples.db.indices { n.append(db: l.samples.db[i] ?? .nan, low: l.samples.low?[i] ?? 0, mid: l.samples.mid?[i] ?? 0, vr: l.samples.vr?[i] ?? 0, at: l.samples.at?[i] ?? 0) }
    for e in l.events { n.log(e.type, e.data.mapValues { v -> Any in v.number ?? v.string ?? 0 }, at: Int64(l.start + e.ms)) }
    return try n.json(final: l.final ?? false)
  }

  @Test func timesCorrectedByHandAreCountedAndImpossibleOnesRefused() throws {
    let s = NightStore()
    s.saveNight(NightRecord(log: Fixtures.shortLog()), now: t0)
    // falling asleep before going to bed: said, nothing saved
    #expect(s.correct("2026-10-29", bed: "22:00", on: "21:00", wake: "00:45", now: t0) == "Falling asleep has to be between going to bed and waking up.")
    #expect(s.correct("2026-10-29", bed: "", on: "", wake: "00:45", now: t0) != nil)
    #expect(s.correct("2030-01-01", bed: "22:00", on: "", wake: "06:00", now: t0) == "This night is gone.")
    // 22:20 to 00:45 is 145 min, none of it awake
    #expect(s.correct("2026-10-29", bed: "22:00", on: "22:20", wake: "00:45", now: t0.addingTimeInterval(5)) == nil)
    let n = try #require(s.state.nights["2026-10-29"])
    #expect(n.asleepMin == 145 && n.ts == 1_005_000)
    #expect(s.dirtyCount == 1)
  }
}
