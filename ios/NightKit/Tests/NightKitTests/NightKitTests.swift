import Testing
import Foundation
@testable import NightKit

// What the microphone's frames become: dB = 20·log10(rms) + 100, the share of power under
// 500 Hz and between 500 and 3000 Hz, one value per second, NaN where nothing was heard.

let rate = 48000.0
func sine(_ hz: Double, rms: Double, n: Int = 2048) -> [Float] {
  (0..<n).map { Float(rms * 2.0.squareRoot() * sin(2 * .pi * hz * Double($0) / rate)) }
}

@Suite struct Readings {
  @Test func loudnessOnTheTrackerScale() throws {
    let r = try #require(Features.read(sine(440, rms: 0.01), sampleRate: rate))
    #expect(abs(r.db - 60) < 0.2)
    let loud = try #require(Features.read(sine(440, rms: 0.1), sampleRate: rate))
    #expect(abs(loud.db - 80) < 0.2)
  }

  @Test func lowAndMidShares() throws {
    let hum = try #require(Features.read(sine(200, rms: 0.01), sampleRate: rate))
    #expect(hum.low > 0.9)
    let voice = try #require(Features.read(sine(1000, rms: 0.01), sampleRate: rate))
    #expect(voice.mid > 0.9)
    #expect(voice.low < 0.1)
  }

  @Test func exactZerosAreNotAReading() {
    #expect(Features.read([Float](repeating: 0, count: 2048), sampleRate: rate) == nil)
  }
}

@Suite struct Seconds {
  // reads every 100 ms
  func feed(_ n: Night, from: Int64, to: Int64, rms: Double) {
    var t = from
    while t <= to { n.add(rms == 0 ? [Float](repeating: 0, count: 2048) : sine(440, rms: rms), sampleRate: rate, at: t); t += 100 }
  }

  @Test func oneValuePerSecond() {
    let n = Night(start: 0)
    feed(n, from: 100, to: 3000, rms: 0.01)
    #expect(n.db.count == 3)
    #expect(n.db.allSatisfy { abs($0 - 60) < 0.2 })
    #expect(n.low.allSatisfy { $0 > 0.9 })   // 440 Hz is under 500 Hz
  }

  @Test func secondsWithoutReadsAreGaps() {
    let n = Night(start: 0)
    feed(n, from: 100, to: 2000, rms: 0.01)
    n.tick(at: 12_500)   // nothing ran for 10 s
    #expect(n.db.count == 12)
    #expect(n.db[2...].filter { $0.isNaN }.count >= 9)
    #expect(n.events.contains { $0.type == "stall" })
  }

  @Test func zerosAreGapsToo() {
    let n = Night(start: 0)
    feed(n, from: 100, to: 3000, rms: 0)
    #expect(n.db.count == 3)
    #expect(n.db.allSatisfy { $0.isNaN })
  }

  @Test func spreadAndJump() {
    let n = Night(start: 0)
    feed(n, from: 100, to: 1000, rms: 0.01)   // second 0: quiet
    for (i, t) in stride(from: 1100, through: 2000, by: 100).enumerated() { n.add(sine(440, rms: i % 2 == 0 ? 0.01 : 0.1), sampleRate: rate, at: Int64(t)) }
    n.tick(at: 2000)
    #expect(abs(n.vr[1] - 10) < 0.3)   // 60 and 80 in turn: spread 10 dB
    #expect(abs(n.at[1] - 20) < 0.3)   // the largest jump: 20 dB
    #expect(abs(n.db[1] - 80) < 0.2)   // the loudest
  }
}

@Suite struct Silence {
  @Test func tenSecondsOfZerosIsNotHearingAndItIsLogged() {
    let n = Night(start: 0)
    var t: Int64 = 100
    while t <= 3000 { n.add(sine(440, rms: 0.01), sampleRate: rate, at: t); t += 100 }
    while t <= 12_000 { n.add([Float](repeating: 0, count: 2048), sampleRate: rate, at: t); t += 100 }
    #expect(n.hearing == true)
    while t <= 14_000 { n.add([Float](repeating: 0, count: 2048), sampleRate: rate, at: t); t += 100 }
    #expect(n.hearing == false)
    #expect(n.events.filter { $0.type == "mic-silent" }.count == 1)
    n.add(sine(440, rms: 0.01), sampleRate: rate, at: t)
    #expect(n.hearing == true)
    #expect(n.events.last?.type == "recovered")
  }
}

@Suite struct Log {
  @Test func heartbeatSaysWhatArrivedThisMinute() {
    let n = Night(start: 0)
    var t: Int64 = 100
    while t <= 30_000 { n.add(sine(440, rms: 0.01), sampleRate: rate, at: t); t += 100 }
    while t <= 60_000 { n.add([Float](repeating: 0, count: 2048), sampleRate: rate, at: t); t += 100 }
    n.heartbeat(at: 60_000, extra: ["locked": true])
    let beat = n.events.last!
    #expect(beat.type == "beat")
    #expect(beat.data["reads"] as? Int == 600)
    #expect(beat.data["zeros"] as? Int == 300)
    #expect(beat.data["peak"] as? Int == -40)
    #expect(beat.data["missing60"] as? Int == 29)   // the read at 30.0 s belongs to second 30
    #expect(beat.data["locked"] as? Bool == true)
    n.heartbeat(at: 61_000)
    #expect(n.events.last!.data["reads"] as? Int == 0)   // counted afresh each minute
  }

  @Test func bodyMovementIsTheLargestJerkOfEachSecond() throws {
    let n = Night(start: 1_793_270_000_000)
    n.motion(0.002, at: n.start + 100); n.motion(0.05, at: n.start + 400); n.motion(0.01, at: n.start + 800)   // second 0
    n.motion(0.004, at: n.start + 1200)                                                                         // second 1
    n.tick(at: n.start + 4000)                                                                                  // seconds 2, 3: nothing
    #expect(n.mv.count == 4)
    #expect(n.mv[0] == 50 && n.mv[1] == 4)                                      // milli-g
    #expect(n.mv[2].isNaN && n.mv[3].isNaN)                                      // no reading is not stillness
    let json = try #require(try JSONSerialization.jsonObject(with: n.json(final: true)) as? [String: Any])
    let mv = try #require((json["samples"] as? [String: Any])?["mv"] as? [Any])
    #expect(mv.count == 4 && mv[0] as? Double == 50 && mv[3] is NSNull)
  }

  @Test func jerkIsHowFarTheAccelerationMovedSinceTheLastReading() {
    var j = Jerk()
    #expect(j.step(0, 0, -1) == nil)                                   // the first reading has nothing to compare with
    #expect(abs(j.step(0, 0, -1.05)! - 0.05) < 1e-9)                   // one axis
    #expect(abs(j.step(0.03, 0.04, -1.05)! - 0.05) < 1e-9)             // three axes: a 3-4-5 step
    #expect(j.step(0.03, 0.04, -1.05) == 0)                            // lying still
    j.reset()
    #expect(j.step(5, 5, 5) == nil)                                    // after a restart: nothing to compare with again
  }

  @Test func savedInTheWebAppsLogFormat() throws {
    let n = Night(start: 1_793_270_000_000, night: "2026-10-29", env: ["app": "native"])
    var t = n.start + 100
    while t <= n.start + 2000 { n.add(sine(440, rms: 0.01), sampleRate: rate, at: t); t += 100 }
    n.tick(at: n.start + 4000)
    n.log("wake", ["early": 3])
    let json = try #require(try JSONSerialization.jsonObject(with: n.json(final: true)) as? [String: Any])
    #expect(json["night"] as? String == "2026-10-29")
    #expect(json["final"] as? Bool == true)
    #expect((json["env"] as? [String: Any])?["app"] as? String == "native")
    let samples = try #require(json["samples"] as? [String: Any])
    let db = try #require(samples["db"] as? [Any])
    #expect(db.count == 4)
    #expect(db[0] as? Double == 60)                 // rounded to 0.1, as diag.js does
    #expect(db[3] is NSNull)                        // a gap
    let events = try #require(json["events"] as? [[Any]])
    #expect(events.last?[1] as? String == "wake")   // [ms since start, type, data]
  }
}

// iOS may end the app in the night: its log stays unfinished, and only finished
// logs become nights. The next launch finishes it where the readings stop.
@Suite struct Recovery {
  @Test func aNightCutShortIsFinishedAtItsLastSecond() throws {
    let n = Night(start: 1_000_000, night: "2026-10-29")
    n.log("start", at: 1_000_000)
    for _ in 0..<90 { n.append(db: 40, low: 0.3, mid: 0.3, vr: 1, at: 1) }
    let fixed = try #require(Night.recovered(try n.json(final: false)))
    let o = try #require(try JSONSerialization.jsonObject(with: fixed) as? [String: Any])
    #expect(o["final"] as? Bool == true)
    let last = try #require((o["events"] as? [[Any]])?.last)
    #expect(last[0] as? Int == 90_000)
    #expect(last[1] as? String == "finish")
    #expect((last[2] as? [String: Any])?["recovered"] as? Bool == true)
    #expect(((o["samples"] as? [String: Any])?["db"] as? [Any])?.count == 90)
  }
  @Test func aFinishedNightOrSomethingElseIsLeftAlone() throws {
    let n = Night(start: 1, night: "2026-10-29")
    #expect(Night.recovered(try n.json(final: true)) == nil)
    #expect(Night.recovered(Data("not a log".utf8)) == nil)
  }
}
