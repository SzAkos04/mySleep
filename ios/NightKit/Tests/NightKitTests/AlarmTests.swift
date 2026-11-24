import Testing
import Foundation
@testable import NightKit

// The alarm's decisions: when it rings, the smart window, moving it, what it did in the morning.
let cal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Budapest")!; return c }()
func at(_ h: Int, _ m: Int, day: Int = 28) -> Date { cal.date(from: DateComponents(year: 2026, month: 10, day: day, hour: h, minute: m))! }

@Suite struct Plans {
  let smart = AlarmSettings(on: true, smart: true, hour: 6, minute: 45)

  @Test func ringsAtTheNextWakeTimeAndSmartOpensHalfAnHourBefore() {
    #expect(AlarmPlan.make(AlarmSettings(on: true, smart: false, hour: 6, minute: 45), from: at(23, 0), calendar: cal) == AlarmPlan(from: at(6, 45, day: 29), at: at(6, 45, day: 29)))
    #expect(AlarmPlan.make(smart, from: at(23, 0), calendar: cal) == AlarmPlan(from: at(6, 15, day: 29), at: at(6, 45, day: 29)))
  }

  @Test func afterMidnightStillThisMorningAfterTheWakeTimeTomorrow() {
    #expect(AlarmPlan.make(smart, from: at(1, 0, day: 29), calendar: cal)?.at == at(6, 45, day: 29))
    #expect(AlarmPlan.make(smart, from: at(6, 50, day: 29), calendar: cal)?.at == at(6, 45, day: 30))
  }

  @Test func insideTheWindowAlreadyTheWindowStartsNow() {
    let p = AlarmPlan.make(smart, from: at(6, 30, day: 29), calendar: cal)
    #expect(p == AlarmPlan(from: at(6, 30, day: 29), at: at(6, 45, day: 29)))
  }

  @Test func nothingWithTheAlarmOff() {
    #expect(AlarmPlan.make(AlarmSettings(on: false, smart: true, hour: 6, minute: 45), from: at(23, 0), calendar: cal) == nil)
  }

  // The system alarm is set for the wake time and rings then by itself; the app only brings it
  // forward, in the smart window, when the sleeper stirs.
  @Test func ringsEarlyOnlyInTheSmartWindowWhenStirringAndOnlyLooksInsideIt() {
    let p = AlarmPlan(from: at(6, 15, day: 29), at: at(6, 45, day: 29))
    var asked = 0
    let stirring = { asked += 1; return true }
    #expect(p.ringsEarly(at: at(5, 0, day: 29), smart: true, isStirring: stirring) == false)
    #expect(asked == 0)   // checked every few seconds: no analysis outside the window
    #expect(p.ringsEarly(at: at(6, 20, day: 29), smart: true, isStirring: stirring) == true)
    #expect(p.ringsEarly(at: at(6, 20, day: 29), smart: true, isStirring: { false }) == false)
    #expect(p.ringsEarly(at: at(6, 20, day: 29), smart: false, isStirring: stirring) == false)
    asked = 0
    #expect(p.ringsEarly(at: at(6, 45, day: 29), smart: true, isStirring: stirring) == false)   // the wake time: the system alarm's own
    #expect(asked == 0)
  }

  @Test func saysTheWindowAndHowLongIsLeft() {
    let p = AlarmPlan(from: at(6, 15, day: 29), at: at(6, 45, day: 29))
    #expect(p.label(calendar: cal) == "06:15 – 06:45")
    #expect(AlarmPlan(from: at(6, 45, day: 29), at: at(6, 45, day: 29)).label(calendar: cal) == "06:45")
    #expect(AlarmSettings(on: true, smart: true, hour: 7, minute: 5).time == "07:05")
  }
}

/// Moving the alarm (the smart window brings it forward): AlarmKit's alarm is cancelled and set
/// again; when setting it fails, the one it had is put back, never none.
@Suite struct Moving {
  struct Refused: Error {}
  @Test func aMoveThatWorksIsTheNewTime() async {
    var set: [Date] = []
    let r = await AlarmMove.run(from: at(6, 45, day: 29), to: at(6, 20, day: 29), now: at(6, 19, day: 29)) { set.append($0) }
    #expect(set == [at(6, 20, day: 29)] && r.at == at(6, 20, day: 29) && r.error == nil)
  }

  @Test func aMoveThatFailsPutsTheAlarmBackWhereItWas() async {
    var set: [Date] = []
    let r = await AlarmMove.run(from: at(6, 45, day: 29), to: at(6, 20, day: 29), now: at(6, 19, day: 29)) { d in
      set.append(d); if d == at(6, 20, day: 29) { throw Refused() }
    }
    #expect(set == [at(6, 20, day: 29), at(6, 45, day: 29)])
    #expect(r.at == at(6, 45, day: 29) && r.error != nil)
  }

  @Test func nothingIsPutBackThatIsPastOrWasNotThere() async {
    var set: [Date] = []
    let past = await AlarmMove.run(from: at(6, 45, day: 29), to: at(6, 50, day: 29), now: at(6, 48, day: 29)) { set.append($0); throw Refused() }
    let none = await AlarmMove.run(from: nil, to: at(6, 50, day: 29), now: at(6, 48, day: 29)) { set.append($0); throw Refused() }
    #expect(set == [at(6, 50, day: 29), at(6, 50, day: 29)] && past.at == nil && none.at == nil)
  }
}

/// What the alarm did in the morning, from AlarmKit's states: when it first rang, each snooze, and
/// that it was stopped (the night is over). 24 November: only the app's own piano's snoozes were
/// counted, so the morning said "No snooze" after the system alarm was snoozed.
@Suite struct Waking {
  @Test func countsTheSystemAlarmsSnoozesAndEndsWhenItIsStopped() {
    var t = WakeTally()
    let steps: [(AlarmPhase, AlarmPhase, Int)] = [
      (.none, .set, 0), (.set, .none, 0), (.none, .set, 0),   // moved by the smart window: not stopped
      (.set, .ringing, 12), (.ringing, .snoozed, 0), (.snoozed, .ringing, 0), (.ringing, .snoozed, 0),
      (.snoozed, .none, 0)                                    // stopped while snoozed
    ]
    let ended = steps.map { t.step(from: $0.0, to: $0.1, early: $0.2) }
    #expect(ended == [false, false, false, false, false, false, false, true])
    #expect(t.early == 12 && t.snoozes == 2)                  // the first ring's, not a snooze's
  }

  @Test func stoppedWhileRingingAndNothingWhenItNeverRang() {
    var t = WakeTally()
    #expect(t.early == nil && t.snoozes == 0)
    _ = t.step(from: .set, to: .ringing, early: 0)
    let ended = t.step(from: .ringing, to: .none, early: 0)
    #expect(ended && t.early == 0)
  }
}

import AVFoundation

/// The system alarm (AlarmKit) plays a sound file at full volume from its first instant, and the app
/// cannot rise it (3 and 4 November it started at once, loud). So the rise is in the file
/// (scripts/make-alarm-rise.py): near silence, easing to full in 25 s, and the alarm repeats it.
/// AlarmKit takes at most 30 s.
@Suite struct AlarmRiseSound {
  /// Peak level in dBFS of each second of the file.
  static func peaks() throws -> [Double] {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().appendingPathComponent("MySleepNight/alarm-rise.wav")
    let f = try AVAudioFile(forReading: url)
    let rate = Int(f.processingFormat.sampleRate)
    let buf = AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: AVAudioFrameCount(f.length))!
    try f.read(into: buf)
    let ch = buf.floatChannelData![0]
    return stride(from: 0, to: Int(buf.frameLength) - rate + 1, by: rate).map { s in
      20 * log10(Double((0..<rate).map { abs(ch[s + $0]) }.max() ?? 0) + 1e-9)
    }
  }

  @Test func isUnderThirtySecondsAndLongEnoughToRise() throws {
    let n = try Self.peaks().count
    #expect(n >= 25 && n <= 30)
  }

  @Test func startsNearSilence() throws {
    #expect(try Self.peaks()[0] < -35)
  }

  @Test func risesAsTheCurveDoes() throws {
    let p = try Self.peaks()
    // the piano peaks near -1 dBFS; at the middle of the rise the curve is about 10 dB down
    #expect((-16 ... -6).contains(p[12]))
    for k in 1..<20 { #expect(p[k] >= p[k - 1] - 1) }
  }

  @Test func holdsFullAtTheEnd() throws {
    #expect(try Self.peaks().last! > -3)
  }
}

/// Settings › Alarm test said nothing while it ran, and nothing when the system refused it
/// (4 November): every state of it is in words.
@Suite struct AlarmTestWords {
  @Test func nothingToSayWhenIdle() { #expect(AlarmTest.idle.text == nil) }

  @Test func countsDownAndTellsWhatToDo() {
    #expect(AlarmTest.waiting(20).text == "Rings in 20 s. Lock the phone and listen.")
    #expect(AlarmTest.waiting(1).text == "Rings in 1 s. Lock the phone and listen.")
  }

  @Test func saysItIsRingingAndWhenItWas() {
    #expect(AlarmTest.ringing.text == "It is ringing: Stop or Snooze ends the test.")
    #expect(AlarmTest.heard.text == "It rang and the test is over.")
  }

  @Test func saysWhyItDidNotRing() {
    #expect(AlarmTest.denied.text == "Alarms are not allowed: turn them on for mySleep in iOS Settings.")
    #expect(AlarmTest.failed("no sound").text == "The alarm did not ring: no sound")
  }

  @Test func isBusyWhileItWaitsOrRings() {
    #expect(AlarmTest.waiting(5).busy && AlarmTest.ringing.busy)
    #expect(![AlarmTest.idle, .heard, .denied, .failed("x")].contains { $0.busy })
  }
}
