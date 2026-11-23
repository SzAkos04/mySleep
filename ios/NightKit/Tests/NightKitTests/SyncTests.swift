import Testing
import Foundation
@testable import NightKit

// The sync's rules as plain functions of the state: the edits stamp what changed and mark it to
// send; a sync's end merges what came, keeps the server's revision, and cleans what was pushed.
@Suite struct SyncTests {
  func night(_ id: String, q: Double, ts: Double) -> NightRecord { var n = NightRecord(id: id); n.extra["q"] = .number(q); n.ts = ts; return n }
  var state: NightState {
    var s = NightState()
    s.nights = ["a": night("a", q: 3, ts: 200), "b": { var b = NightRecord(id: "b"); b.deleted = true; b.ts = 300; return b }()]
    s.dirty = ["night:a": true, "night:b": true]
    return s
  }

  @Test func sendsEditedNightsAndDeletions() {
    #expect(state.pendingChanges() == [Change(kind: "night", id: "a", ts: 200, night: night("a", q: 3, ts: 200)), Change(kind: "night", id: "b", ts: 300, deleted: true)])
  }

  @Test func aDirtyMarkWithNothingBehindItIsNotSentAndDoesNotStopTheRest() {
    var s = state; s.dirty = ["night:gone": true, "night:a": true]
    #expect(s.pendingChanges().map(\.id) == ["a"])
  }

  @Test func keepsTheNewerSidePerEntry() {
    var s = state
    var older = NightRecord(id: "a"); older.extra["q"] = .number(1)
    var other = NightRecord(id: "c"); other.extra["q"] = .number(5)
    var server = AppSettings(); server.bedtime = "22:30"
    s.merge([Change(kind: "night", id: "a", ts: 100, night: older),   // older than local: ignored
             Change(kind: "night", id: "c", ts: 100, night: other),   // a night from elsewhere
             Change(kind: "settings", id: "main", ts: 50, settings: server)])   // the server's settings beat the defaults
    #expect(s.nights["a"]?.extra["q"] == .number(3))
    #expect(s.nights["c"] == night("c", q: 5, ts: 100))
    #expect(s.settings.bedtime == "22:30" && s.settings.ts == 50)
  }

  @Test func anEntryEditedAgainDuringThePushStaysDirty() {
    var s = state
    let pushed = s.pendingChanges()
    s.nights["a"]?.ts = 250
    #expect(s.stillDirty(after: pushed) == ["night:a": true])
  }

  @Test func savingStampsAndMarksDeletingLeavesAStampedTombstoneSettingsMergeTheChange() {
    var s = NightState()
    s.save(NightRecord(id: "a"), ts: 500)
    #expect(s.nights["a"]?.ts == 500 && s.dirty == ["night:a": true])
    s.dirty = [:]; s.delete("a", ts: 600)
    #expect(s.nights["a"]?.deleted == true && s.nights["a"]?.ts == 600 && s.dirty == ["night:a": true])
    s.dirty = [:]; s.editSettings(ts: 700) { $0.wake = "07:00" }
    #expect(s.settings.wake == "07:00" && s.settings.bedtime == "23:00" && s.settings.ts == 700 && s.dirty == ["settings:main": true])
  }

  @Test func theEndOfASyncMergesKeepsTheRevisionAndCleansWhatWasPushed() {
    var s = state; s.rev = 3
    let pushed = s.pendingChanges()
    s.afterSync(rev: 9, changes: [Change(kind: "night", id: "c", ts: 100, night: night("c", q: 5, ts: 0))], pushed: pushed, now: 999)
    #expect(s.rev == 9 && s.lastSynced == 999)
    #expect(s.nights["c"] == night("c", q: 5, ts: 100))
    #expect(s.dirty.isEmpty)
  }

  // data/ put back from an older backup: the server's revision is behind this phone's, and the nights it
  // lost are clean here, so nothing would ever send them again. All of them go up once more.
  @Test func aServerBehindThisPhoneGetsEveryNightHereOnceMore() {
    var s = NightState()
    s.nights = ["a": night("a", q: 1, ts: 5), "b": { var b = NightRecord(id: "b"); b.deleted = true; b.ts = 6; return b }()]
    s.settings.wake = "07:00"; s.settings.ts = 7; s.rev = 40
    var r = s; r.afterSync(rev: 12, changes: [], pushed: [], now: 999)
    #expect(r.rev == 12 && r.dirty == ["night:a": true, "night:b": true, "settings:main": true])
    var untouched = s; untouched.settings.ts = 0
    untouched.afterSync(rev: 12, changes: [], pushed: [], now: 999)
    #expect(untouched.dirty == ["night:a": true, "night:b": true])   // defaults never edited: nothing to send
    var ahead = s; ahead.afterSync(rev: 41, changes: [], pushed: [], now: 999)
    #expect(ahead.dirty.isEmpty)
  }

  @Test func whatGoesOnTheWire() throws {
    let req = try JSONSerialization.jsonObject(with: JSONEncoder().encode(SyncBody(since: 4, changes: state.pendingChanges()))) as? [String: Any]
    let changes = try #require(req?["changes"] as? [[String: Any]])
    #expect(req?["since"] as? Int == 4)
    #expect((changes[0]["data"] as? [String: Any])?["q"] as? Int == 3 && changes[0]["ts"] as? Int == 200)
    #expect(changes[1]["deleted"] as? Bool == true && changes[1]["data"] == nil)
    // the server's reply: deleted false with data, or true with null
    let reply = try JSONDecoder().decode(SyncAnswer.self, from: Data(#"{"rev":7,"changes":[{"kind":"night","id":"x","ts":1,"rev":7,"deleted":false,"data":{"id":"x"}},{"kind":"night","id":"y","ts":2,"rev":6,"deleted":true,"data":null}]}"#.utf8))
    #expect(reply.rev == 7 && reply.changes[0].night?.id == "x" && reply.changes[1].deleted)
  }
}
