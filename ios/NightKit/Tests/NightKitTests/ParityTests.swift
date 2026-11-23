import Testing
import Foundation
@testable import NightKit

// TEMPORARY, while the rules move from JavaScript to Swift: the same logs and states through the
// JS bundle (ios/MySleepNight/rules.js) and through Swift, compared as typed values. Goes with the JS.
@Suite(.serialized) struct ParityTests {
  nonisolated(unsafe) static let rules = try! Rules(source: Rules.bundleSource)

  static func json(_ log: NightLog) -> String {
    func arr(_ a: [Double?]?) -> Any { (a ?? []).map { $0.map { $0 as Any } ?? NSNull() } }
    let s = log.samples
    let o: [String: Any] = ["night": log.night, "start": log.start, "final": log.final ?? false,
      "samples": ["start": s.start, "db": arr(s.db), "low": arr(s.low), "mid": arr(s.mid), "vr": arr(s.vr), "at": arr(s.at)],
      "events": log.events.map { e -> [Any] in
        let data = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(e.data))) ?? [:]
        return e.data.isEmpty ? [e.ms, e.type] : [e.ms, e.type, data]
      }]
    return String(decoding: try! JSONSerialization.data(withJSONObject: o), as: UTF8.self)
  }
  static func viaJS(_ log: NightLog) throws -> NightRecord {
    let out = try #require(try rules.evaluate("JSON.stringify(MySleepRules.nightFromLog(\(json(log))))"))
    return try JSONDecoder().decode(NightRecord.self, from: Data(out.utf8))
  }

  /// Nights of every kind: the fixtures, synthetic nights with sounds and wake-ups, the real hours.
  static func logs() throws -> [NightLog] {
    var out = [Fixtures.log(), Fixtures.shortLog(), Fixtures.log(night: "2026-10-24", start: at(24, 23, 30))]   // a DST night here
    var k = 0
    func synth(_ id: String, hours: Double, wobbly: Bool = false, _ edit: (inout Synth) -> Void) -> NightLog {
      var n = Synth(hours: hours, wobbly: wobbly); edit(&n); k += 1
      let start = Clock.atClock(id, "23:00") + Double(k) * 61_000
      let f = n.f
      return NightLog(night: id, start: start, final: true,
                      samples: .init(start: start, db: f.db.map { $0.isNaN ? nil : $0 }, low: f.low, mid: f.mid, vr: f.vr, at: f.at),
                      events: [.init(ms: 0, type: "start"), .init(ms: Double(f.db.count) * 1000 - 5000, type: "ring", data: ["early": .number(Double(k % 3) * 7)]),
                               .init(ms: Double(f.db.count) * 1000, type: "finish")])
    }
    out.append(synth("2026-10-20", hours: 8) { n in
      for s in stride(from: 0, to: 900, by: 20) { n.burst(s, 2) }
      for s in stride(from: 7200, to: 7500, by: 15) { n.burst(s, 3) }
      for s in stride(from: 3 * 3600, to: 3 * 3600 + 600, by: 4) { n.burst(s, 2, Synth.snore) }
      for s in stride(from: 4 * 3600, to: 8 * 3600, by: 600) { n.burst(s, 1) }
      n.burst(5 * 3600 + 30, 4, Synth.talk); n.burst(5 * 3600 + 36, 3, Synth.talk); n.burst(6 * 3600, 1, Synth.cough); n.burst(6 * 3600 + 2, 1, Synth.cough)
      n.burst(6 * 3600 + 900, 90, .init(db: 40, vr: 0.5))
    })
    out.append(synth("2026-10-21", hours: 4, wobbly: true) { n in for s in stride(from: 7200, to: 7500, by: 15) { n.burst(s, 3, .init(db: 45)) } })
    out.append(synth("2026-10-22", hours: 8) { n in for s in 3600..<7200 { n.f.db[s] = .nan } })
    out.append(synth("2026-10-23", hours: 6) { n in for s in stride(from: 3 * 3600, to: 6 * 3600, by: 900) { for t in stride(from: s, to: s + 180, by: 15) { n.burst(t, 1) } } })
    out.append(synth("2026-10-26", hours: 8) { n in for s in 0..<(8 * 3600) where s % 3 == 0 { n.f.db[s] = .nan } })   // mostly gaps
    out.append(synth("2026-10-27", hours: 0.2) { _ in })   // too short for sleep
    for (i, k) in ["night", "morning"].enumerated() {
      let r = try AnalysisTests.real(k), start = Clock.atClock("2026-10-1\(i)", "01:00")
      out.append(NightLog(night: "2026-10-1\(i)", start: start, final: true, samples: .init(start: start, db: r.db.map { $0.isNaN ? nil : $0 }, low: r.low, mid: r.mid, vr: r.vr, at: r.at),
                          events: [.init(ms: 0, type: "start"), .init(ms: 100, type: "audio"), .init(ms: 200, type: "locked"), .init(ms: Double(r.db.count) * 1000, type: "finish")]))
    }
    return out
  }

  @Test func theNightsMadeOfLogsAreTheSame() throws {
    for log in try Self.logs() {
      #expect(NightRecord(log: log) == (try Self.viaJS(log)), "\(log.night)")
    }
  }

  @Test func theScreensAreTheSame() throws {
    var state = NightState()
    for log in try Self.logs() { state.save(NightRecord(log: log), ts: 1) }
    // a year of nights, the fixture's under other dates, some typed in, one deleted
    let base = NightRecord(log: Fixtures.shortLog())
    for i in 0..<400 {
      let id = Clock.id(of: Clock.date(at(9, 12, 0) - Double(i) * 864e5))
      guard state.nights[id] == nil else { continue }
      var n = base; n.id = id; n.bed = Clock.atClock(id, "22:\(Clock.pad(i % 60))"); n.wake = Clock.atClock(id, "0\(5 + i % 4):10")
      n.on = i % 9 == 0 ? nil : n.bed! + Double(i % 40) * 60e3; n.asleepMin = Double(200 + (i * 37) % 300); n.wakes = i % 4
      if i % 11 == 0 { n.timeline = nil; n.events = nil }
      if i % 13 == 0 { n.snoreMin = 0 }
      state.save(n, ts: Double(i))
    }
    state.delete("2026-10-25", ts: 5)
    state.settings.bedtime = "22:30"; state.settings.wake = "06:30"
    let js = try NightStore(rules: Self.rules, json: String(decoding: JSONEncoder().encode(state), as: UTF8.self))
    let now = Clock.date(at(10, 8, 0, month: 11))
    for id in state.nights.keys.sorted() { #expect(state.reportView(id) == js.report(id), "\(id)") }
    #expect(state.startMonth(now: now) == js.startMonth(now: now))
    for m in [MonthID(year: 2026, month: 10), MonthID(year: 2026, month: 9), MonthID(year: 2026, month: 2), MonthID(year: 2025, month: 9)] {
      for sel in [nil, "2026-10-20", "2026-10-26", "2030-01-01"] as [String?] {
        #expect(state.journalView(m, selected: sel, now: now) == js.journal(m, selected: sel, now: now), "\(m) \(sel ?? "-")")
      }
    }
    for d in [7, 30, 365] { #expect(state.trendsView(days: d) == js.trends(days: d), "\(d)") }
    var few = NightState(); few.save(base, ts: 1)
    let jsFew = try NightStore(rules: Self.rules, json: String(decoding: JSONEncoder().encode(few), as: UTF8.self))
    #expect(few.trendsView(days: 7) == jsFew.trends(days: 7))
    #expect(NightState().trendsView(days: 7) == (try NightStore(rules: Self.rules)).trends(days: 7))
  }

  @Test func correctionsAreTheSame() throws {
    let n = NightRecord(log: Fixtures.log())
    let nJSON = String(decoding: try JSONEncoder().encode(n), as: UTF8.self)
    for (b, o, w) in [("22:00", "22:20", "00:45"), ("23:00", "", "07:00"), ("", "1", "2"), ("23:00", "22:00", "07:00"), ("23:30", "01:10", "12:30"), ("21:00", "21:00", "21:00")] {
      let out = try #require(try Self.rules.evaluate("JSON.stringify(MySleepRules.corrected(\(nJSON),{bed:'\(b)',on:'\(o)',wake:'\(w)'}))"))
      struct R: Decodable { let error: String?; let night: NightRecord? }
      let r = try JSONDecoder().decode(R.self, from: Data(out.utf8))
      let want: NightRecord.Corrected = r.error.map { .refused($0) } ?? .night(r.night!)
      #expect(n.corrected(bed: b, on: o, wake: w) == want, "\(b) \(o) \(w)")
    }
  }
}
